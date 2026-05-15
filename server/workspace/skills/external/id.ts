// ID derivation for the external-skill catalog (#1383 / #1335 PR-C).
//
// Inputs: a GitHub HTTPS URL + optional subpath. Outputs:
//
//   - `repoId`     — the directory name under `data/skills/catalog/external/`.
//                     Built from `<owner>-<repo>` so the same repo always
//                     resolves to the same folder regardless of which
//                     subpath the user picked (subpath determines what
//                     ends up INSIDE the dir, not its name).
//   - `activeId`   — the directory name under `.claude/skills/`. Built
//                     from `<owner>-<skillFolder>` to keep the slash-
//                     command flat and reasonably short. When the repo
//                     ships a single SKILL.md at root (no skillFolder),
//                     the activeId equals the repoId.
//
// Both ids run through the same `safeSlug` filter the rest of the
// catalog uses (regex whitelist + `path.basename` round-trip — CodeQL's
// recognised path-injection sanitiser, established in PR-B).

import { createHash } from "node:crypto";
import path from "node:path";

// Slug whitelist: lowercase alnum + `-`, must start and end with alnum,
// at least one character. Matches the convention used by `catalog.ts`'s
// `safeSlugName` but lower-cases the input first since URLs / repo
// names are case-insensitive on GitHub.
//
// The two `[a-z0-9-]` segments around the required leading + trailing
// alnum look like nested quantifiers to the security/detect-unsafe-regex
// rule, but each segment can only consume from a single bounded
// character class — worst-case backtracking is linear.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping classes
const SAFE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function sanitise(raw: string): string | null {
  // Fail-closed denylist FIRST: anything that smells like a path
  // operator is rejected outright. Doing the normalise step below
  // first would silently collapse `..` → `-` and let suspicious
  // input through as benign-looking strings (`../etc` → `etc`).
  if (raw.includes("..") || raw.includes("/") || raw.includes("\\") || raw.includes("\0")) return null;
  // Normalise punctuation to hyphens then trim leading + trailing
  // separators via slice (avoids `/-+$/` which sonar flags as
  // potentially slow even though it's bounded by `$`).
  let lowered = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  while (lowered.startsWith("-")) lowered = lowered.slice(1);
  while (lowered.endsWith("-")) lowered = lowered.slice(0, -1);
  if (!SAFE_SLUG_PATTERN.test(lowered)) return null;
  // `path.basename` round-trip — same launder used elsewhere so CodeQL
  // recognises the result as sanitised when it flows into `path.join`.
  const basename = path.basename(lowered);
  return basename === lowered ? basename : null;
}

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
}

const GITHUB_HTTPS_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:\.git)?\/?$/;

/** Parse a GitHub HTTPS URL into owner/repo. v1 only accepts
 *  `https://github.com/<owner>/<repo>` (optional `.git` suffix,
 *  optional trailing slash). gitlab / SSH / private hosts are out of
 *  scope. Returns `null` on any rejection. */
export function parseGitHubHttpsUrl(url: string): ParsedGitHubUrl | null {
  const match = GITHUB_HTTPS_RE.exec(url);
  if (!match) return null;
  const [, owner, repoRaw] = match;
  // Strip a trailing `.git` if the regex's optional group missed it
  // (it's already handled in the regex, but be defensive).
  const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -".git".length) : repoRaw;
  return { owner, repo };
}

/** Derive the repo-level catalog directory name from URL.
 *  `<owner>-<repo>`. Returns `null` if the URL fails parsing or the
 *  resulting slug isn't safe (e.g. owner / repo contains only
 *  punctuation). */
export function deriveRepoId(url: string): string | null {
  const parsed = parseGitHubHttpsUrl(url);
  if (!parsed) return null;
  return sanitise(`${parsed.owner}-${parsed.repo}`);
}

/** Derive the active-layer directory name from a URL + skillFolder.
 *  When `skillFolder` is `null`, the skill is at repo root and the
 *  active id equals the repoId. */
export function deriveActiveId(url: string, skillFolder: string | null): string | null {
  const parsed = parseGitHubHttpsUrl(url);
  if (!parsed) return null;
  if (skillFolder === null) {
    return sanitise(`${parsed.owner}-${parsed.repo}`);
  }
  // Validate skillFolder itself first so a path-traversal-shaped
  // input ("..", "foo/bar") fails closed before composition.
  const folderSafe = sanitise(skillFolder);
  if (folderSafe === null) return null;
  return sanitise(`${parsed.owner}-${folderSafe}`);
}

/** Canonical `https://github.com/<owner>/<repo>` (lowercased, no
 *  `.git`/trailing slash) — the identity two URLs share iff they
 *  point at the same GitHub repo. `null` if the URL doesn't parse.
 *  Used both for cache keying and the install-time collision guard
 *  (distinct repos whose `repoId` punctuation-collides must be told
 *  apart by their canonical URL, not their lossy id). */
export function canonicalRepoUrl(url: string): string | null {
  const parsed = parseGitHubHttpsUrl(url);
  return parsed ? `https://github.com/${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}` : null;
}

/** Stable opaque hash of a URL for keying the scratch-clone cache.
 *  Canonicalises first so the accepted variants of the same repo
 *  (`/o/r`, `/o/r/`, `/o/r.git`, case differences) map to ONE cache
 *  dir — otherwise a re-install via a different form would spawn a
 *  duplicate clone and uninstall would only drop the last-recorded
 *  variant. */
export function urlCacheKey(url: string): string {
  return createHash("sha256")
    .update(canonicalRepoUrl(url) ?? url)
    .digest("hex")
    .slice(0, 16);
}

// Shape of a `deriveRepoId` output (`<owner>-<repo>` lowercased). The
// two `[a-z0-9-]` segments around the required leading + trailing
// alnum look like nested quantifiers but each reads from a single
// bounded class — worst-case backtracking is linear. Exported as the
// single source of truth so the catalog reader + installer agree by
// construction instead of duplicating the literal.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping classes
const SAFE_REPO_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** True when `value` has the shape `deriveRepoId` produces. */
export function isSafeRepoId(value: string): boolean {
  return SAFE_REPO_ID_RE.test(value);
}

/** Launder a (possibly user-supplied) repo id into a safe directory
 *  leaf, or `null` if it fails the shape check or isn't a basename.
 *  The `path.basename` round-trip is CodeQL's recognised
 *  `js/path-injection` sanitiser — callers MUST compose paths from
 *  the returned value (not the raw input) so the taint flow ends
 *  here. A regex `.test()` alone is NOT recognised as a sanitiser. */
export function safeRepoId(raw: string): string | null {
  if (!SAFE_REPO_ID_RE.test(raw)) return null;
  const basename = path.basename(raw);
  return basename === raw ? basename : null;
}

/** Launder a skill-folder leaf name (the directory directly under a
 *  repo / subpath that contains `SKILL.md`). This is the SINGLE rule
 *  shared by install-time discovery AND read/star addressing — if the
 *  two diverged (as they did: install accepted `v1.2` but the read
 *  side's stricter regex dropped it), an install could succeed yet be
 *  invisible/unaddressable in list/preview/star.
 *
 *  Permissive by design (mirrors what install discovery accepts: any
 *  non-hidden one-level dir) but still traversal-safe: rejects empty,
 *  `.`/`..`, leading-dot (hidden), separators, NUL, and anything that
 *  isn't its own `path.basename` (CodeQL `js/path-injection`
 *  sanitiser). Dots elsewhere (`v1.2`) are allowed. */
export function safeSkillFolder(raw: string): string | null {
  if (raw.length === 0 || raw === "." || raw === "..") return null;
  if (raw.startsWith(".")) return null;
  if (raw.includes("/") || raw.includes("\\") || raw.includes("\0")) return null;
  const basename = path.basename(raw);
  return basename === raw ? basename : null;
}

// A single safe path segment: alnum plus `.`, `-`, `_`. `..` is
// rejected explicitly by the caller before this is consulted, so the
// dot allowance can't yield a traversal token.
const SUBPATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Sanitise a caller-supplied repo subpath (`POST /external/repos`
 *  body). The raw value flows into `path.join(cacheDir, subpath)` and
 *  into the git sparse-checkout pattern, so an un-validated `../../etc`
 *  / `\0` / newline would escape the scratch dir or inject extra
 *  sparse patterns. Returns a normalised `a/b/c` string (no leading or
 *  trailing slash, no `.`/`..`/empty segments) or `null` on rejection. */
export function sanitiseSubpath(raw: string): string | null {
  if (raw.length === 0) return null;
  if (raw.includes("\0") || raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) return null;
  if (raw.startsWith("/")) return null;
  const safe: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || !SUBPATH_SEGMENT_PATTERN.test(segment)) return null;
    safe.push(segment);
  }
  if (safe.length === 0) return null;
  return safe.join("/");
}
