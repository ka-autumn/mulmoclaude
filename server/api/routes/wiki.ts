import { Router, Request, Response } from "express";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { readTextSafeSync, readTextSafe } from "../../utils/files/safe.js";
import { writeWikiPage } from "../../workspace/wiki-pages/io.js";
import { getPageIndex } from "./wiki/pageIndex.js";
import { parseFrontmatterTags } from "./wiki/frontmatter.js";
import { badRequest, notFound } from "../../utils/httpError.js";
import { getOptionalStringQuery } from "../../utils/request.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
// Aliased because `buildPageResponseData` below declares a local
// string named `errorMessage`; importing the errors util under a
// different name avoids the no-shadow clash without renaming the
// long-standing local.
import { errorMessage as formatError } from "../../utils/errors.js";
// All wiki-text helpers (slug rules, index parsing, lint rules)
// live in `src/lib/wiki-page/` as pure modules so the frontend can
// share them without pulling in server-only deps. This route is
// just the HTTP shell on top of those.
import { parseWikiLink } from "../../../src/lib/wiki-page/link.js";
import { wikiSlugify } from "../../../src/lib/wiki-page/slug.js";
import { type WikiPageEntry, parseIndexEntries } from "../../../src/lib/wiki-page/index-parse.js";
import { findBrokenLinksInPage, findMissingFiles, findOrphanPages, findTagDrift, formatLintReport } from "../../../src/lib/wiki-page/lint.js";
import { buildWikiGraph, type WikiGraph } from "../../../src/lib/wiki-page/graph.js";

const router = Router();

const pagesDir = () => WORKSPACE_PATHS.wikiPages;
const indexFile = () => WORKSPACE_PATHS.wikiIndex;
const logFile = () => WORKSPACE_PATHS.wikiLog;

function readFileOrEmpty(absPath: string): string {
  return readTextSafeSync(absPath) ?? "";
}

// Wiki-text helpers (slugify, index parsing, lint rules) now live
// under `src/lib/wiki-page/` as pure modules — see imports above.
// Re-exports kept here for legacy callers that import via this
// route module (e.g. tests in `test/routes/test_wikiHelpers.ts`).
export { wikiSlugify } from "../../../src/lib/wiki-page/slug.js";
export type { WikiPageEntry } from "../../../src/lib/wiki-page/index-parse.js";
export { buildTableColumnMap, extractHashTags, extractSlugFromBulletHref, parseIndexEntries, parseTagsCell } from "../../../src/lib/wiki-page/index-parse.js";
export { findBrokenLinksInPage, findMissingFiles, findOrphanPages, findTagDrift, formatLintReport } from "../../../src/lib/wiki-page/lint.js";

// Resolve a page name to an absolute `.md` path using the in-memory
// page index (see ./wiki/pageIndex.ts). Index is kept fresh via
// pagesDir mtime, so zero readdir cost on cache hit.
//
// `pageName` may carry the `[[target|display]]` form on legacy
// codepaths (e.g. an old chat-history entry that pre-dates the
// renderer fix). `parseWikiLink` strips the display half so the
// lookup uses just the target — same parser the renderer + lint
// agree on, which is the whole point of the #1297 refactor.
// Below this length the fuzzy `includes` step skips altogether.
// CJK / emoji-only / very-short page names get slugified down to a
// short noise tail (e.g. "日本語タイトル-chromium-{nonce}" →
// "-chromium-{nonce}"), and that noise will partial-match almost
// any page that happens to share the suffix. Skipping fuzzy for
// these slugs avoids silent miss-resolves; the index.md title-match
// fallback below still handles the legitimate non-ASCII case (#1194).
const MIN_FUZZY_SLUG_LEN = 6;

async function resolvePagePath(pageName: string): Promise<string | null> {
  const dir = pagesDir();
  const { slugs } = await getPageIndex(dir);
  if (slugs.size === 0) return null;

  const { target } = parseWikiLink(pageName);
  const slug = wikiSlugify(target);

  if (slug.length > 0) {
    const exact = slugs.get(slug);
    if (exact) return path.join(dir, exact);

    const fuzzy = pickFuzzyMatch(slug, slugs);
    if (fuzzy) return path.join(dir, fuzzy);
  }

  // Non-ASCII page names (e.g. Japanese [[wiki links]]) produce empty
  // slugs after slugification. Fall back to matching by title in the
  // wiki index so the link resolves to its page file.
  const indexContent = readFileOrEmpty(indexFile());
  const entries = parseIndexEntries(indexContent);
  const titleMatch = entries.find((entry) => entry.title === target);
  if (titleMatch) {
    const file = slugs.get(titleMatch.slug);
    if (file) return path.join(dir, file);
  }

  return null;
}

// Walk every indexed slug looking for an `includes`-style match.
// Returns the single best candidate, or null when the slug is too
// short to be meaningful OR multiple candidates tie at the top score
// (ambiguous — leave the resolution to the caller's title-match
// fallback rather than silently picking iteration-order-first).
//
// Score = min(slug.length, key.length) / max(slug.length, key.length).
// A perfect match where both strings are identical scores 1.0 (but
// that path is taken by the exact `slugs.get` above, never reaches
// here). Otherwise the highest-scoring partial match wins, and the
// score is decoupled from Map iteration order (= filesystem readdir
// order) so the resolver is deterministic across hosts.
export function pickFuzzyMatch(slug: string, slugs: ReadonlyMap<string, string>): string | null {
  if (slug.length < MIN_FUZZY_SLUG_LEN) return null;
  let bestFile: string | null = null;
  let bestScore = 0;
  let bestIsTied = false;
  for (const [key, file] of slugs) {
    if (!slug.includes(key) && !key.includes(slug)) continue;
    const shorter = Math.min(slug.length, key.length);
    const longer = Math.max(slug.length, key.length);
    const score = shorter / longer;
    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
      bestIsTied = false;
    } else if (score === bestScore) {
      bestIsTied = true;
    }
  }
  return bestIsTied ? null : bestFile;
}

router.get(API_ROUTES.wiki.base, async (req: Request, res: Response<WikiResponse | ErrorResponse>) => {
  const slug = getOptionalStringQuery(req, "slug");
  if (slug) {
    log.info("wiki", "GET page: start", { slugPreview: previewSnippet(slug) });
    try {
      const response = await buildPageResponse("page", slug);
      if (!response.data.pageExists) {
        log.warn("wiki", "GET page: not found", { slugPreview: previewSnippet(slug) });
      } else {
        log.info("wiki", "GET page: ok", { slugPreview: previewSnippet(slug), bytes: response.data.content.length });
      }
      res.json(response);
    } catch (err) {
      log.error("wiki", "GET page: threw", { slugPreview: previewSnippet(slug), error: formatError(err) });
      throw err;
    }
    return;
  }
  log.info("wiki", "GET index: start");
  const content = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(content);
  log.info("wiki", "GET index: ok", { pages: pageEntries.length, bytes: content.length });
  res.json({
    data: { action: "index", title: "Wiki Index", content, pageEntries },
    message: content ? `Wiki index — ${pageEntries.length} page(s)` : "Wiki index is empty.",
    title: "Wiki Index",
    instructions: "The wiki index is now displayed on the canvas.",
    updating: true,
  });
});

interface WikiBody {
  action: string;
  pageName?: string;
  // `save` action only: full new file contents (frontmatter + body).
  content?: string;
}

interface WikiData {
  action: string;
  title: string;
  content: string;
  pageEntries?: WikiPageEntry[];
  pageName?: string;
  pageExists?: boolean;
  error?: string;
  graph?: WikiGraph;
}

interface WikiResponse {
  data: WikiData;
  message: string;
  title: string;
  instructions: string;
  updating: boolean;
}

interface ErrorResponse {
  error: string;
}

function buildIndexResponse(action: string): WikiResponse {
  const content = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(content);
  return {
    data: { action, title: "Wiki Index", content, pageEntries },
    message: content ? `Wiki index — ${pageEntries.length} page(s)` : "Wiki index is empty.",
    title: "Wiki Index",
    instructions: "The wiki index is now displayed on the canvas.",
    updating: true,
  };
}

// Pure branching helper extracted from buildPageResponse so the three
// states (missing / empty / has-content) can be pinned by unit tests
// without requiring a real filesystem. The I/O wrapper below supplies
// `exists`, `content`, and `resolvedTitle` from disk; this function
// builds the response shape — including the error / message /
// instructions distinctions that the GET and POST handlers share.
export function buildPageResponseData(args: { action: string; pageName: string; resolvedTitle: string; content: string; exists: boolean }): WikiResponse {
  const { action, pageName, resolvedTitle, content, exists } = args;
  const hasContent = Boolean(content);
  // Three states:
  //   1. !exists              → page file is missing entirely.
  //   2. exists && !hasContent → page file exists but is empty (e.g.,
  //                              zero-byte placeholder waiting to be filled).
  //   3. exists && hasContent  → normal page with body text.
  // Previously every "no content" case collapsed into "Page not found",
  // which mis-reported empty-but-existing pages. error / message /
  // instructions now distinguish missing vs empty so the client and
  // the agent get consistent signals.
  const missing = !exists;
  const slug = wikiSlugify(pageName);
  const errorMessage = missing ? `Page not found: ${pageName}` : hasContent ? undefined : `Page is empty: ${pageName}`;
  const statusMessage = hasContent ? `Showing page: ${resolvedTitle}` : missing ? `Page not found: ${pageName}` : `Page exists but is empty: ${resolvedTitle}`;
  const statusInstructions = hasContent
    ? "The wiki page is now displayed on the canvas."
    : missing
      ? `Page not found: wiki/pages/${slug}.md does not exist. You can create it or check the slug in wiki/index.md.`
      : `Page exists but is empty: wiki/pages/${slug}.md has no content yet. Research the topic and write a comprehensive article, then save it to the same path.`;
  return {
    data: {
      action,
      title: resolvedTitle,
      content,
      pageName: resolvedTitle,
      pageExists: exists,
      error: errorMessage,
    },
    message: statusMessage,
    title: resolvedTitle,
    instructions: statusInstructions,
    updating: true,
  };
}

// Pure-ish seam between `resolvePagePath` + `readFileOrEmpty` (the
// filesystem I/O) and `buildPageResponseData` (the response shape).
// Exported so tests can exercise the `exists`/`resolvedTitle`
// computation without spinning up a real wiki directory — the
// original regression this PR fixed was precisely this layer
// conflating `content` with `exists`, so pinning it here is worth
// the extra indirection.
export function toPageResponse(args: { action: string; pageName: string; filePath: string | null; content: string }): WikiResponse {
  const { action, pageName, filePath, content } = args;
  const resolvedTitle = filePath ? path.basename(filePath, ".md") : pageName;
  return buildPageResponseData({
    action,
    pageName,
    resolvedTitle,
    content,
    exists: Boolean(filePath),
  });
}

async function buildPageResponse(action: string, pageName: string): Promise<WikiResponse> {
  const filePath = await resolvePagePath(pageName);
  const content = filePath ? readFileOrEmpty(filePath) : "";
  return toPageResponse({ action, pageName, filePath, content });
}

function buildLogResponse(action: string): WikiResponse {
  const content = readFileOrEmpty(logFile());
  return {
    data: { action, title: "Activity Log", content },
    message: content ? "Wiki activity log" : "Activity log is empty.",
    title: "Activity Log",
    instructions: "The wiki activity log is now displayed on the canvas.",
    updating: true,
  };
}

// Pure lint helpers (findOrphanPages, findMissingFiles,
// findBrokenLinksInPage, findTagDrift, formatLintReport) now live
// in `src/lib/wiki-page/lint.ts` and are re-exported above. The
// route below is the thin filesystem shell around them.

async function collectLintIssues(): Promise<string[]> {
  const dir = pagesDir();
  const { slugs } = await getPageIndex(dir);
  if (slugs.size === 0) {
    return ["- Wiki `pages/` directory does not exist yet. Start ingesting sources."];
  }
  const indexContent = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(indexContent);
  const indexedSlugs = new Set(pageEntries.map((entry) => entry.slug));
  const pageFiles = [...slugs.values()];
  const fileSlugs = new Set(slugs.keys());

  const issues: string[] = [];
  issues.push(...findOrphanPages(fileSlugs, indexedSlugs));
  issues.push(...findMissingFiles(pageEntries, fileSlugs));
  // Parallel read: N small markdown files, ~50 KB each. Bounded by
  // the number of wiki pages, not by CPU.
  const contents = await Promise.all(
    pageFiles.map(async (fileName) => {
      const content = await readTextSafe(path.join(dir, fileName));
      return content ?? "";
    }),
  );
  const frontmatterTagsBySlug = new Map<string, string[]>();
  for (let i = 0; i < pageFiles.length; i++) {
    issues.push(...findBrokenLinksInPage(pageFiles[i], contents[i], fileSlugs));
    // Lowercase the map key so a `MyPage.md` filename still matches
    // an `entry.slug` of `mypage` produced by `wikiSlugify` on the
    // wiki-link parser path. `findTagDrift` lowercases the lookup
    // side to match.
    const slug = pageFiles[i].replace(/\.md$/i, "").toLowerCase();
    frontmatterTagsBySlug.set(slug, parseFrontmatterTags(contents[i]));
  }
  issues.push(...findTagDrift(pageEntries, frontmatterTagsBySlug));
  return issues;
}

// Read every page + the index and build the page→page link graph
// (#wiki-backlinks-graph). Same parallel-read shape as
// `collectLintIssues` — the link resolution is shared with lint via
// the pure `buildWikiGraph` helper. No cache: the `graph` action is
// explicit (user opens the Graph tab / a page's backlinks), and a
// page-content edit doesn't advance the pagesDir mtime that the page
// index caches on, so a content-keyed cache would go stale silently.
async function loadWikiGraph(): Promise<WikiGraph> {
  const dir = pagesDir();
  const { slugs } = await getPageIndex(dir);
  const fileEntries = [...slugs.entries()];
  const contents = await Promise.all(fileEntries.map(async ([, fileName]) => (await readTextSafe(path.join(dir, fileName))) ?? ""));
  const pages = fileEntries.map(([slug], i) => ({ slug, content: contents[i] }));
  const indexEntries = parseIndexEntries(readFileOrEmpty(indexFile()));
  return buildWikiGraph(pages, indexEntries);
}

async function buildGraphResponse(action: string): Promise<WikiResponse> {
  const graph = await loadWikiGraph();
  log.info("wiki", "POST graph: ok", { nodes: graph.nodes.length, edges: graph.edges.length });
  return {
    data: { action, title: "Wiki Graph", content: "", graph },
    message: `Wiki graph — ${graph.nodes.length} page(s), ${graph.edges.length} link(s)`,
    title: "Wiki Graph",
    instructions: "The wiki link graph is now displayed on the canvas.",
    updating: true,
  };
}

// Result of a save attempt — null on lookup miss so the route can
// return 404 distinctly from a 400 / 500.
type SaveOutcome = { ok: true; absPath: string } | { ok: false; reason: "not-found" };

async function saveExistingPage(pageName: string, content: string): Promise<SaveOutcome> {
  const absPath = await resolvePagePath(pageName);
  if (!absPath) return { ok: false, reason: "not-found" };
  // Funnel through the wiki-page write helper. Atomic write is
  // guaranteed inside; the helper also routes the (old, new) pair
  // to the snapshot pipeline (#763 PR 2 — currently a no-op stub).
  // Editor identity defaults to "user" here because the route is
  // hit by both LLM (`manageWiki` MCP) and frontend saves; PR 2
  // disambiguates them via a request-side flag.
  const slug = path.basename(absPath, ".md");
  await writeWikiPage(slug, content, { editor: "user" });
  return { ok: true, absPath };
}

// Extracted from the POST switch to keep the route handler under
// the project's cognitive-complexity limit. Returns true if the
// response was sent (success or any handled error), false to fall
// through to the next case (currently unused — every code path
// terminates).
async function handleSaveAction(
  req: Request<object, unknown, WikiBody>,
  res: Response<WikiResponse | ErrorResponse>,
  pageName: string | undefined,
): Promise<void> {
  if (!pageName) {
    log.warn("wiki", "POST save: missing pageName");
    badRequest(res, "pageName required for save action");
    return;
  }
  const { content } = req.body;
  if (typeof content !== "string") {
    log.warn("wiki", "POST save: missing content", { pageNamePreview: previewSnippet(pageName) });
    badRequest(res, "content (string) required for save action");
    return;
  }
  const outcome = await saveExistingPage(pageName, content);
  if (!outcome.ok) {
    log.warn("wiki", "POST save: page not found", { pageNamePreview: previewSnippet(pageName) });
    notFound(res, `Page not found: ${pageName}`);
    return;
  }
  log.info("wiki", "POST save: ok", { pageNamePreview: previewSnippet(pageName), bytes: content.length });
  // Re-read so the response carries the canonical post-write state.
  const response = await buildPageResponse("page", pageName);
  res.json(response);
}

async function buildLintReportResponse(action: string): Promise<WikiResponse> {
  const issues = await collectLintIssues();
  const report = formatLintReport(issues);
  const healthy = issues.length === 0;
  return {
    data: { action, title: "Wiki Lint Report", content: report },
    message: healthy ? "Wiki is healthy" : `${issues.length} issue(s) found`,
    title: "Wiki Lint Report",
    instructions: healthy ? "Wiki is healthy — no issues found." : `${issues.length} issue(s) found that need fixing:\n${issues.join("\n")}`,
    updating: true,
  };
}

router.post(API_ROUTES.wiki.base, async (req: Request<object, unknown, WikiBody>, res: Response<WikiResponse | ErrorResponse>) => {
  const { action, pageName } = req.body;
  log.info("wiki", "POST: start", { action, pageNamePreview: pageName ? previewSnippet(pageName) : undefined });
  try {
    switch (action) {
      case "index": {
        const response = buildIndexResponse(action);
        log.info("wiki", "POST index: ok", { pages: response.data.pageEntries?.length ?? 0 });
        res.json(response);
        return;
      }
      case "page": {
        if (!pageName) {
          log.warn("wiki", "POST page: missing pageName");
          badRequest(res, "pageName required for page action");
          return;
        }
        const response = await buildPageResponse(action, pageName);
        if (!response.data.pageExists) {
          log.warn("wiki", "POST page: not found", { pageNamePreview: previewSnippet(pageName) });
        } else {
          log.info("wiki", "POST page: ok", { pageNamePreview: previewSnippet(pageName), bytes: response.data.content.length });
        }
        res.json(response);
        return;
      }
      case "log": {
        const response = buildLogResponse(action);
        log.info("wiki", "POST log: ok", { bytes: response.data.content.length });
        res.json(response);
        return;
      }
      case "graph": {
        res.json(await buildGraphResponse(action));
        return;
      }
      case "lint_report": {
        const response = await buildLintReportResponse(action);
        // `summary` not `issues`: the field is the human-readable
        // result string ("Wiki is healthy" / "N issue(s) found"),
        // not a count. Aggregators that group by `issues` would
        // otherwise treat the same string as a numeric facet.
        log.info("wiki", "POST lint_report: ok", { summary: response.message });
        res.json(response);
        return;
      }
      case "save": {
        // Used by the wiki page View when the user toggles a GFM
        // task checkbox in the rendered body (#775). Overwrites the
        // existing page file atomically; refuses to create new pages
        // — that flow lives elsewhere (LLM via Write, manageWiki).
        await handleSaveAction(req, res, pageName);
        return;
      }
      default:
        log.warn("wiki", "POST: unknown action", { action });
        badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    log.error("wiki", "POST: threw", { action, pageNamePreview: pageName ? previewSnippet(pageName) : undefined, error: formatError(err) });
    throw err;
  }
});

export default router;
