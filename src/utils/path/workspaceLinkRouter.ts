// Classify a workspace-relative link from agent Markdown into a
// navigation target. Used by TextResponse's click handler to route
// internal links to the appropriate view (Wiki, Files, Session)
// instead of letting them fall through to the SPA router.
//
// Pure function — no DOM or Vue dependencies, fully unit-testable.

import { PAGE_ROUTES } from "../../router/pageRoutes";
import { isExternalHref, extractSessionIdFromPath } from "./relativeLink";

export type WorkspaceLinkTarget =
  | { kind: "wiki"; slug: string }
  | { kind: "file"; path: string }
  | { kind: "session"; sessionId: string }
  /** A top-level SPA route like `/collections/mc-clients`,
   *  `/calendar`, `/todos/<id>`. `path` includes the leading slash
   *  so callers can pass it directly to `router.push(string)`. */
  | { kind: "spa-route"; path: string };

// Match `data/wiki/pages/<slug>.md` or `wiki/pages/<slug>.md`.
const WIKI_PAGE_PATTERN = /(?:data\/)?wiki\/pages\/([^/]+)\.md$/;

// Match `conversations/chat/<id>.jsonl` (delegates to extractSessionIdFromPath).
const CHAT_LOG_PREFIX = "conversations/";

// Top-level SPA route names whose leading-segment match should
// short-circuit the files-view fallback. Without this set, an
// agent-emitted link like `[Microsoft](/collections/mc-clients)` or
// `[my calendar](/calendar)` falls into the `kind: "file"` default
// and gets routed to `/files/collections/mc-clients`, which 404s
// because that path doesn't exist on disk.
//
// `chat` and `files` are intentionally OMITTED:
//   - `chat`: agent-emitted chat links go through the
//     `conversations/chat/<id>.jsonl` convention above so the
//     session-load handler (mark-read, start-chat) runs. A bare
//     `/chat/<id>` would skip that flow.
//   - `files`: a bare `/files/<path>` from agent text is already
//     a file-view URL — letting it stay in the file fallback
//     keeps the per-segment URL encoding the catch-all route does
//     (see App.vue navigateToWorkspacePath#file).
const SPA_ROUTE_NAMES: ReadonlySet<string> = new Set(Object.values(PAGE_ROUTES).filter((name) => name !== PAGE_ROUTES.chat && name !== PAGE_ROUTES.files));

/**
 * Given a raw href attribute from agent Markdown, return a typed
 * navigation target, or null if the link is external, anchor-only,
 * or unresolvable.
 *
 * Agent links are typically workspace-root-relative (e.g.
 * `data/wiki/pages/foo.md`). Relative paths with `../` that escape
 * the workspace root return null.
 */
export function classifyWorkspacePath(href: string): WorkspaceLinkTarget | null {
  if (!href || isExternalHref(href)) return null;
  if (href.startsWith("#")) return null;

  // Strip fragment and query
  const cleaned = stripFragmentAndQuery(href);
  if (cleaned.length === 0) return null;

  // marked.parse() percent-encodes multibyte chars and spaces in
  // <a href> output. `safeDecode` decodes those per segment so the
  // downstream router doesn't double-encode (turning `%E4%BD%9C` into
  // `%25E4%25BD%259C`, breaking the file API lookup). Segments that
  // contain `%2F` are preserved opaque because the plugin convention
  // stores npm-scoped packages as one literal on-disk directory
  // (data/plugins/%40<scope>%2F<name>/...) — decoding `%2F` to `/`
  // there would split that one segment into two and break server
  // file resolution (#1473).
  const decoded = safeDecode(cleaned);

  // Normalize path (collapse ./ and ../, reject root-escape)
  const normalized = normalizePath(decoded);
  if (!normalized) return null;

  // Wiki page: data/wiki/pages/<slug>.md
  const wikiMatch = normalized.match(WIKI_PAGE_PATTERN);
  if (wikiMatch) {
    return { kind: "wiki", slug: wikiMatch[1] };
  }

  // Chat session log: conversations/chat/<id>.jsonl
  if (normalized.startsWith(CHAT_LOG_PREFIX)) {
    const chatPath = normalized.slice(CHAT_LOG_PREFIX.length);
    const sessionId = extractSessionIdFromPath(chatPath);
    if (sessionId) {
      return { kind: "session", sessionId };
    }
  }

  // Top-level SPA route: leading segment names one of the host's
  // pages (collections, calendar, todos, automations, skills, …).
  // Without this branch, those links would be routed to the Files
  // view (with `files/` prepended) and 404 — the trigger for this
  // generalization was `[X](/collections/mc-clients)` from the
  // mc-clients SKILL.md ending up at `/files/collections/mc-clients`.
  //
  // Caveat: a workspace file path that happens to share a leading
  // segment with a SPA route (`skills/guide.md`, `news/archive.json`,
  // etc.) must NOT get reclassified as SPA — the router defines
  // `/skills` as an exact match and `skills/guide.md` would resolve
  // away from the file view, hiding the file. Heuristic: if any
  // non-leading segment looks like it has a file extension, the
  // path is treated as a file, not a route. Slugs don't normally
  // carry dots; file extensions almost always do.
  const [firstSegment, ...restSegments] = normalized.split("/");
  if (SPA_ROUTE_NAMES.has(firstSegment) && !restSegments.some(looksLikeFileSegment)) {
    // Preserve the query string (e.g. `?selected=<id>`) so deep
    // links like `/collections/mc-invoice?selected=INV-2026-0001`
    // reach the target view's query handler — `router.push(string)`
    // parses it into `route.query`. Kept for spa-route ONLY; wiki /
    // file / session targets route by their own identifiers and
    // take no query. Fragments stay dropped (no SPA route reads one
    // today). The query is sliced from the raw href, so any
    // percent-encoding marked emitted survives for vue-router to
    // decode.
    return { kind: "spa-route", path: `/${normalized}${extractQuery(href)}` };
  }

  // Everything else: open in Files view
  return { kind: "file", path: normalized };
}

/**
 * Resolve a potentially-relative href against a workspace base directory.
 * Relative paths (`./`, `../`) are prepended with `baseDir` so that
 * `classifyWorkspacePath` can normalize the `../` segments.
 * Bare filenames (no `/`) are also treated as relative to `baseDir`.
 *
 * Example: resolveWikiHref("../sources/foo.md", "data/wiki/pages")
 *        → "data/wiki/pages/../sources/foo.md"
 *        → (after normalization by classifyWorkspacePath) "data/wiki/sources/foo.md"
 */
export function resolveWikiHref(href: string, baseDir: string): string {
  if (isExternalHref(href)) return href;
  if (href.startsWith("./") || href.startsWith("../") || !href.includes("/")) {
    return `${baseDir}/${href}`;
  }
  return href;
}

// Decode a percent-encoded path *per segment*. Each `/`-separated
// segment is decoded independently — except segments that contain
// `%2F`, which are kept opaque because the plugin naming convention
// stores npm-scoped packages as a SINGLE on-disk directory whose
// literal name carries `%40` and `%2F` characters
// (data/plugins/%40<scope>%2F<name>/...). Decoding `%2F` to `/` there
// would collapse one directory into two segments and break server
// file resolution (#1473).
//
// Everything else round-trips via `decodeURIComponent`: multibyte
// (UTF-8) sequences emitted by marked.parse, transport-encoded spaces
// (`%20`), and encoded `..` (`%2E%2E`) — the last one decodes to the
// literal `..` token that `normalizePath` then catches as a
// workspace-root escape. Malformed sequences (truncated UTF-8, lone
// `%`) fall back to the raw bytes so a bad link still routes — Files
// view surfaces its own 404 if the path is unreachable.
function safeDecode(str: string): string {
  return str.split("/").map(decodeSegment).join("/");
}

function decodeSegment(seg: string): string {
  if (/%2[fF]/.test(seg)) return seg;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

// Matches a trailing `.ext` (1-8 alphanumeric chars) on a path
// segment. Slugs are kebab-case alphanumeric without dots, so a
// segment ending in a `.ext`-shape is almost certainly a file
// (`.md`, `.json`, `.png`, `.jsonl`, …). Bounded length avoids
// false positives on slugs with a single trailing dot.
//
// Used by the SPA-route classifier to decline reclassifying file
// paths that share a leading segment with a SPA route (e.g.
// `skills/guide.md`). Standalone helper so the test file can
// exercise edge cases (`mc-clients` vs `mc-clients.v2` vs
// `notes.txt`) directly.
function looksLikeFileSegment(segment: string): boolean {
  return /\.[a-zA-Z0-9]{1,8}$/.test(segment);
}

// Extract the raw query string (including the leading "?") from an
// href, or "" when there's none. Only a "?" that precedes any "#"
// counts as a query delimiter — a "?" sitting inside the fragment
// is part of the fragment, not a query. Sliced from the raw href so
// percent-encoding is preserved for vue-router to decode.
function extractQuery(href: string): string {
  const queryIdx = href.indexOf("?");
  if (queryIdx === -1) return "";
  const hashIdx = href.indexOf("#");
  if (hashIdx !== -1 && hashIdx < queryIdx) return "";
  const end = hashIdx !== -1 ? hashIdx : href.length;
  return href.slice(queryIdx, end);
}

function stripFragmentAndQuery(str: string): string {
  const hashIdx = str.indexOf("#");
  const queryIdx = str.indexOf("?");
  let end = str.length;
  if (hashIdx !== -1 && hashIdx < end) end = hashIdx;
  if (queryIdx !== -1 && queryIdx < end) end = queryIdx;
  return str.slice(0, end);
}

function normalizePath(raw: string): string | null {
  if (raw.length === 0) return null;
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? null : stack.join("/");
}
