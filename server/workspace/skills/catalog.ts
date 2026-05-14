// Skill catalog reader + star (copy-to-active) helper. The other
// half of the catalog/active split established by #1335 PR-A — the
// preset-sync writer in `server/workspace/skills-preset.ts`
// populates `data/skills/catalog/preset/`, and this module is what
// the UI reads from + writes through when the user ★ Stars an entry
// to bring it into `.claude/skills/`.
//
// Why a separate module from `discovery.ts`: catalog entries are
// not yet in Claude Code's discovery scope (that's the whole point
// — they're not in `.claude/skills/`). Treating them as a different
// shape (CatalogEntry vs Skill) keeps the type system honest about
// which entries are prompt-active. The two converge once an entry
// is starred: it gets copied into `.claude/skills/<slug>/`, after
// which `discoverSkills()` picks it up as a normal project-scope
// skill on the next listing.

import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { workspacePath } from "../workspace.js";
// WORKSPACE_DIRS — relative segments (e.g. "data/skills/catalog/preset").
// We deliberately do NOT use WORKSPACE_PATHS here: those are absolute
// paths rooted at the live `workspacePath`, so joining one with a
// caller-supplied `workspaceRoot` would silently discard `workspaceRoot`
// (Node `path.join` drops everything before an absolute argument).
import { WORKSPACE_DIRS } from "../paths.js";
import { parseSkillFrontmatter } from "./parser.js";
import { log } from "../../system/logger/index.js";

// Catalog sources. PR-B ships only `preset` (the `mc-*` skills
// shipped with the launcher). PR-C will add `anthropic` (sparse
// git checkout of anthropics/skills) and possibly `community`
// (URL-installed third-party). The string-union keeps the API
// surface ready for that extension.
export type CatalogSource = "preset";

export const CATALOG_SOURCES: readonly CatalogSource[] = ["preset"] as const;

export function isCatalogSource(value: unknown): value is CatalogSource {
  return typeof value === "string" && (CATALOG_SOURCES as readonly string[]).includes(value);
}

export interface CatalogEntry {
  slug: string;
  /** The slug doubles as the displayed name today — frontmatter has
   *  no separate `name` field. */
  name: string;
  description: string;
  source: CatalogSource;
  /** `<workspace>/.claude/skills/<slug>/` exists. UI uses this to
   *  render "★ Starred" instead of "★ Star" and to disable the
   *  star button on already-active entries. */
  alreadyActive: boolean;
}

// `preset` is the only catalog source today. PR-C will add
// `anthropic` and possibly `community` — at that point this will
// switch on the source string. For now an if-else keeps the lint
// rule (sonarjs/no-small-switch) happy without losing the
// exhaustiveness narrowing.
function catalogDirForSource(source: CatalogSource, workspaceRoot: string): string {
  if (source === "preset") {
    return path.join(workspaceRoot, WORKSPACE_DIRS.skillsCatalogPreset);
  }
  const exhaustive: never = source;
  throw new Error(`unknown catalog source: ${exhaustive as string}`);
}

function activeDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.claudeSkills);
}

export interface CatalogOptions {
  /** Override the workspace root. Default: live `workspacePath`
   *  (`~/mulmoclaude`). Tests point this at a `mkdtempSync` tree so
   *  they don't touch the user's real home dir. */
  workspaceRoot?: string;
}

async function isDirectory(absPath: string): Promise<boolean> {
  try {
    const info = await stat(absPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function readCatalogEntry(slugDir: string, safeName: string, source: CatalogSource, workspaceRoot: string): Promise<CatalogEntry | null> {
  // `slugDir` was built from a `safeSlugName`-laundered name, so
  // joining a fixed `"SKILL.md"` keeps the path inside the catalog
  // tree and stays clear of CodeQL's path-injection trace.
  const skillMdPath = path.join(slugDir, "SKILL.md");
  let raw: string;
  try {
    raw = await readFile(skillMdPath, "utf-8");
  } catch {
    return null;
  }
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed) return null;
  const activeSlugDir = joinUnderRoot(activeDir(workspaceRoot), safeName);
  const alreadyActive = await isDirectory(activeSlugDir);
  return { slug: safeName, name: safeName, description: parsed.description, source, alreadyActive };
}

async function scanCatalogSource(source: CatalogSource, workspaceRoot: string): Promise<CatalogEntry[]> {
  const dir = catalogDirForSource(source, workspaceRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // ENOENT is normal — workspace may be freshly created and the
    // catalog dir hasn't been populated yet (the preset sync runs
    // first, but defensive). Return [].
    return [];
  }
  const results: CatalogEntry[] = [];
  for (const slug of entries) {
    if (slug.startsWith(".")) continue;
    // Slugs come from `readdir`, which CodeQL flags as tainted even
    // though the directory is launcher-managed. `safeSlugName`
    // applies the slug whitelist + a `path.basename` round-trip —
    // CodeQL's recognised path-injection sanitiser. A catalog entry
    // with an unexpected name is skipped rather than crashing the
    // listing.
    const safeName = safeSlugName(slug);
    if (safeName === null) continue;
    const slugDir = joinUnderRoot(dir, safeName);
    if (!(await isDirectory(slugDir))) continue;
    const entry = await readCatalogEntry(slugDir, safeName, source, workspaceRoot);
    if (entry) results.push(entry);
  }
  results.sort((left, right) => left.slug.localeCompare(right.slug));
  return results;
}

export async function listCatalogEntries(opts: CatalogOptions = {}): Promise<CatalogEntry[]> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const out: CatalogEntry[] = [];
  for (const source of CATALOG_SOURCES) {
    const entries = await scanCatalogSource(source, workspaceRoot);
    out.push(...entries);
  }
  return out;
}

// Slug whitelist matches the convention used by user-authored
// skills + preset slugs. The slug becomes a directory name under
// `.claude/skills/`, so we forbid anything that could escape (`..`,
// path separators, leading dots) or be interpreted as a special
// shell character. The two `[a-zA-Z0-9_-]` segments around a
// required leading + trailing alphanumeric look like nested
// quantifiers to the security/detect-unsafe-regex rule, but each
// segment can only consume from a single bounded character class
// (no overlap), so worst-case backtracking is linear — annotate
// rather than rewrite for clarity.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping character classes, no catastrophic backtracking
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

/** Sanitise a user-supplied slug into a safe directory-name leaf.
 *  Returns `null` for anything that fails the slug whitelist OR is
 *  not a basename (i.e. survives `path.basename` round-trip
 *  unchanged). Returning a `path.basename` result is the pattern
 *  CodeQL recognises as a `js/path-injection` sanitiser — once a
 *  slug has been passed through `path.basename`, downstream
 *  `path.join` / `stat` / `readFile` calls are no longer flagged.
 *
 *  Belt-and-suspenders on top of `SAFE_SLUG_PATTERN`: the regex
 *  already rejects every problematic shape, but the basename
 *  round-trip catches edge cases the regex might miss on platforms
 *  with different separators (Windows `\\`) and lets the type
 *  system express "this value has been laundered". */
function safeSlugName(slug: string): string | null {
  if (!SAFE_SLUG_PATTERN.test(slug)) return null;
  // `path.basename` strips anything that looks like a directory
  // component and is CodeQL's recognised sanitiser for
  // `js/path-injection`. On a slug that already passed the regex
  // this is an identity transform.
  const basename = path.basename(slug);
  if (basename !== slug) return null;
  return basename;
}

/** Compose a path inside `rootDir` using a `safeSlugName`-laundered
 *  slug. The taint flow ends at `safeSlugName`, so the joined path
 *  is no longer flagged. */
function joinUnderRoot(rootDir: string, safeName: string): string {
  return path.join(rootDir, safeName);
}

export type StarResult =
  | { kind: "starred"; slug: string }
  | { kind: "not-found"; source: CatalogSource; slug: string }
  | { kind: "already-active"; slug: string }
  | { kind: "invalid-slug"; slug: string };

async function copyDirTree(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
    // Symlinks / sockets / FIFOs are intentionally skipped — the
    // catalog is launcher-managed and shouldn't contain them.
  }
}

/** Copy `data/skills/catalog/<source>/<slug>/` → `.claude/skills/<slug>/`.
 *  Returns a discriminated result so the route can map to clean
 *  HTTP status codes. Slug is laundered via `safeSlugName` (regex
 *  whitelist + `path.basename` round-trip) before any `path.join`,
 *  which is CodeQL's recognised pattern for clearing
 *  `js/path-injection` taint. A separator-bearing or escaping slug
 *  yields `invalid-slug` and never reaches the filesystem. */
export async function starCatalogEntry(source: CatalogSource, slug: string, opts: CatalogOptions = {}): Promise<StarResult> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return { kind: "invalid-slug", slug };
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const catalogSlugDir = joinUnderRoot(catalogDirForSource(source, workspaceRoot), safeName);
  const activeSlugDir = joinUnderRoot(activeDir(workspaceRoot), safeName);
  if (!(await isDirectory(catalogSlugDir))) return { kind: "not-found", source, slug: safeName };
  if (await isDirectory(activeSlugDir)) return { kind: "already-active", slug: safeName };
  await copyDirTree(catalogSlugDir, activeSlugDir);
  log.info("skills", "starred catalog entry", { source, slug: safeName });
  return { kind: "starred", slug: safeName };
}
