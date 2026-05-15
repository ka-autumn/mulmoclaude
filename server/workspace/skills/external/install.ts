// Install / uninstall of an external-skill repo into the catalog
// (#1383 / #1335 PR-C).
//
// Pipeline for install:
//   1. validate URL → derive repoId
//   2. clone (or refresh) the scratch dir via `cloneOrUpdate`
//   3. discover SKILL.md files inside the (optionally subpath-
//      scoped) tree
//   4. copy each discovered skill folder into
//      `<workspace>/data/skills/catalog/external/<repoId>/`
//   5. write `.source.json` recording url / subpath / ref / sha / time
//
// Uninstall is the inverse: blow away the catalog dir for `repoId`
// and the corresponding scratch clone. Active copies (anything the
// user already Starred into `.claude/skills/`) are NOT touched —
// star = fork, so users keep what they activated even after the
// upstream repo is removed.

import { copyFile, lstat, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { workspacePath } from "../../workspace.js";
import { WORKSPACE_DIRS } from "../../paths.js";
import { parseSkillFrontmatter } from "../parser.js";
import { log } from "../../../system/logger/index.js";
import { errorMessage } from "../../../utils/errors.js";
import { writeFileAtomic } from "../../../utils/files/index.js";
import { cloneOrUpdate, defaultCacheRoot, type CloneDeps, type CloneResult } from "./clone.js";
import { canonicalRepoUrl, deriveRepoId, safeRepoId, safeSkillFolder, sanitiseSubpath, urlCacheKey } from "./id.js";

const SOURCE_METADATA_FILE = ".source.json";

export interface InstallRepoOptions {
  url: string;
  subpath?: string;
  ref?: string;
}

export interface InstallResult {
  repoId: string;
  url: string;
  subpath?: string;
  ref?: string;
  sha: string;
  installedAt: string;
  /** Number of SKILL.md files discovered + copied into the catalog
   *  dir. Zero is technically valid (an empty repo) but suspicious;
   *  callers may surface it as a warning. */
  skillCount: number;
}

export interface ExternalInstallOptions extends CloneDeps {
  /** Override the workspace root. Default: live `workspacePath`. */
  workspaceRoot?: string;
}

interface DiscoveredSkill {
  /** Folder name as it appears in the catalog dir. `"."` indicates
   *  the SKILL.md lives at the repo root (single-skill repo). */
  folder: string;
  /** Absolute source path of the skill dir inside the scratch
   *  clone. */
  sourceDir: string;
}

async function isDirectory(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isDirectory();
  } catch {
    return false;
  }
}

// `lstat`-based checks for the UNTRUSTED scratch-clone tree. A
// malicious external repo can ship symlinks (`SKILL.md` →
// `/etc/passwd`, a skill dir → `/`); `stat` follows them, so
// discovery/copy would read or duplicate host files. These reject
// symlinks (and anything that isn't a plain dir / plain file). Our
// own catalog dirs still use the `stat`-based helpers above.
async function isRealDirectory(absPath: string): Promise<boolean> {
  try {
    return (await lstat(absPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isRealFile(absPath: string): Promise<boolean> {
  try {
    return (await lstat(absPath)).isFile();
  } catch {
    return false;
  }
}

async function hasParseableSkill(skillDir: string): Promise<boolean> {
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!(await isRealFile(skillMd))) return false;
  try {
    const raw = await readFile(skillMd, "utf-8");
    return parseSkillFrontmatter(raw) !== null;
  } catch {
    return false;
  }
}

/** Discovery rules:
 *   - `subpath` given → glob `<scratch>/<subpath>/&zwj;*&zwj;/SKILL.md`,
 *     one level deep.
 *   - Else → first try `<scratch>/SKILL.md` (single-skill-at-root).
 *           If absent, glob `<scratch>/&zwj;*&zwj;/SKILL.md` (multi-skill
 *           without a `subpath` declaration). */
async function discoverSkills(cacheDir: string, subpath: string | undefined): Promise<DiscoveredSkill[]> {
  if (subpath) {
    const scanRoot = path.join(cacheDir, subpath);
    if (!(await isRealDirectory(scanRoot))) return [];
    return await scanOneLevel(scanRoot);
  }
  if (await hasParseableSkill(cacheDir)) {
    return [{ folder: ".", sourceDir: cacheDir }];
  }
  return await scanOneLevel(cacheDir);
}

async function scanOneLevel(scanRoot: string): Promise<DiscoveredSkill[]> {
  let entries: string[];
  try {
    entries = await readdir(scanRoot);
  } catch {
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    // Same folder-name rule the read/star side uses (`safeSkillFolder`)
    // so anything we accept here stays listable + addressable. Skips
    // hidden / `.` / `..` / separator-bearing names too.
    const folder = safeSkillFolder(entry);
    if (folder === null) continue;
    const candidate = path.join(scanRoot, folder);
    if (!(await isRealDirectory(candidate))) continue;
    if (!(await hasParseableSkill(candidate))) continue;
    out.push({ folder, sourceDir: candidate });
  }
  // Stable order for deterministic test output.
  out.sort((left, right) => left.folder.localeCompare(right.folder));
  return out;
}

function catalogExternalRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.skillsCatalog, "external");
}

interface ExtRepoPaths {
  repoDir: string;
  metadataPath: string;
}

function pathsForRepo(workspaceRoot: string, repoId: string): ExtRepoPaths {
  const repoDir = path.join(catalogExternalRoot(workspaceRoot), repoId);
  return { repoDir, metadataPath: path.join(repoDir, SOURCE_METADATA_FILE) };
}

async function writeMetadata(metadataPath: string, payload: Omit<InstallResult, "repoId" | "skillCount">): Promise<void> {
  await writeFileAtomic(metadataPath, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Copy the discovered skill folder into the catalog under
 *  `<external>/<repoId>/<targetFolder>/`. For single-skill-at-root
 *  installs (`folder === "."`), the SKILL.md + siblings are copied
 *  directly under the repo dir; nothing nests. */
async function copyIntoCatalog(skill: DiscoveredSkill, repoDir: string): Promise<void> {
  if (skill.folder === ".") {
    await copyTreeNoSymlinks(skill.sourceDir, repoDir, [".git", SOURCE_METADATA_FILE]);
    return;
  }
  await copyTreeNoSymlinks(skill.sourceDir, path.join(repoDir, skill.folder), [".git", SOURCE_METADATA_FILE]);
}

/** Recursively copy `srcDir` → `destDir`, copying ONLY plain dirs and
 *  plain files. `Dirent` predicates use `lstat` semantics, so a
 *  symlink entry is neither `isDirectory()` nor `isFile()` and is
 *  silently skipped — an external repo can't smuggle a `SKILL.md` →
 *  `/etc/passwd` (or a dir symlink) into the catalog / active layer.
 *  `node:fs cp` with `recursive` would dereference such links. */
async function copyTreeNoSymlinks(srcDir: string, destDir: string, skip: readonly string[]): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue;
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeNoSymlinks(src, dst, skip);
    } else if (entry.isFile()) {
      await copyFile(src, dst);
    }
    // Symlinks / sockets / FIFOs intentionally skipped.
  }
}

export type InstallExternalRepoResult =
  | { kind: "installed"; detail: InstallResult }
  | { kind: "invalid-url"; url: string }
  | { kind: "invalid-subpath"; subpath: string }
  | { kind: "no-skills"; repoId: string; sha: string }
  | { kind: "id-collision"; repoId: string; existingUrl: string }
  | { kind: "error"; reason: string };

/** When `repoDir` already holds an install, return its recorded
 *  canonical URL. `repoId` is a lossy punctuation-normalised slug, so
 *  two different repos (`foo/a.b`, `foo/a-b`) can map to the same dir;
 *  the canonical URL in `.source.json` is what actually identifies
 *  the occupant. */
async function existingCanonicalUrl(metadataPath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf-8")) as { url?: unknown };
    return typeof parsed.url === "string" ? canonicalRepoUrl(parsed.url) : null;
  } catch {
    return null;
  }
}

/** Install an external skill repo into the catalog. */
export async function installExternalRepo(opts: InstallRepoOptions, deps: ExternalInstallOptions = {}): Promise<InstallExternalRepoResult> {
  const repoId = deriveRepoId(opts.url);
  if (!repoId) return { kind: "invalid-url", url: opts.url };

  // Sanitise the subpath BEFORE it reaches `path.join` / the git
  // sparse-checkout pattern. `path.join` collapses `..`, so an
  // un-validated subpath could escape the scratch cache dir.
  let subpath: string | undefined;
  if (opts.subpath !== undefined) {
    const clean = sanitiseSubpath(opts.subpath);
    if (clean === null) return { kind: "invalid-subpath", subpath: opts.subpath };
    subpath = clean;
  }

  const workspaceRoot = deps.workspaceRoot ?? workspacePath;
  let clone: CloneResult;
  try {
    clone = await cloneOrUpdate({ url: opts.url, subpath, ref: opts.ref }, deps);
  } catch (err) {
    log.warn("skills-external", "git clone failed", { url: opts.url, error: errorMessage(err) });
    return { kind: "error", reason: errorMessage(err, "git clone failed") };
  }

  const skills = await discoverSkills(clone.cacheDir, subpath);

  // Bail BEFORE touching the catalog. Wiping + recreating + writing
  // `.source.json` first meant a zero-skill fetch returned 422 while
  // `GET /external/repos` still listed the repo and the previous
  // catalog contents were already destroyed. Leaving a prior good
  // install intact on a transient empty fetch is the safer outcome.
  if (skills.length === 0) {
    log.warn("skills-external", "install found no skills; catalog left untouched", { repoId, url: opts.url, subpath });
    return { kind: "no-skills", repoId, sha: clone.sha };
  }

  const { repoDir, metadataPath } = pathsForRepo(workspaceRoot, repoId);

  // Collision guard: `repoId` is a lossy slug. If this dir is already
  // occupied by a DIFFERENT source repo (canonical URL mismatch),
  // wiping it would silently destroy that repo's catalog + metadata.
  // Refuse instead.
  const occupant = await existingCanonicalUrl(metadataPath);
  const incoming = canonicalRepoUrl(opts.url);
  if (occupant && incoming && occupant !== incoming) {
    log.warn("skills-external", "repoId collision; refusing to overwrite", { repoId, occupant, incoming });
    return { kind: "id-collision", repoId, existingUrl: occupant };
  }

  // Wipe the previous catalog tree for this repoId so a re-install
  // starts clean (removed skills don't linger). Cache dir is kept
  // because we still need the checked-out tree to copy from.
  await rm(repoDir, { recursive: true, force: true });
  await mkdir(repoDir, { recursive: true });

  for (const skill of skills) {
    await copyIntoCatalog(skill, repoDir);
  }

  const installedAt = new Date().toISOString();
  const detail: InstallResult = {
    repoId,
    url: opts.url,
    subpath,
    ref: opts.ref,
    sha: clone.sha,
    installedAt,
    skillCount: skills.length,
  };
  await writeMetadata(metadataPath, {
    url: opts.url,
    subpath,
    ref: opts.ref,
    sha: clone.sha,
    installedAt,
  });

  log.info("skills-external", "installed repo", { repoId, sha: clone.sha, skillCount: skills.length });
  return { kind: "installed", detail };
}

export type UninstallResult = { kind: "uninstalled"; repoId: string } | { kind: "not-found"; repoId: string } | { kind: "invalid-repo-id"; repoId: string };

/** Uninstall a repo: remove `data/skills/catalog/external/<repoId>/`
 *  and the matching scratch clone keyed by the recorded URL. Active
 *  copies under `.claude/skills/` are left in place. */
export async function uninstallExternalRepo(repoIdRaw: string, deps: ExternalInstallOptions = {}): Promise<UninstallResult> {
  // `repoIdRaw` is user-controlled (DELETE /external/repos/:repoId).
  // Launder via the `path.basename` round-trip BEFORE composing any
  // path — CodeQL only clears `js/path-injection` taint through that
  // sanitiser, not a bare regex `.test()`.
  const repoId = safeRepoId(repoIdRaw);
  if (repoId === null) return { kind: "invalid-repo-id", repoId: repoIdRaw };
  const workspaceRoot = deps.workspaceRoot ?? workspacePath;
  const { repoDir, metadataPath } = pathsForRepo(workspaceRoot, repoId);
  if (!(await isDirectory(repoDir))) return { kind: "not-found", repoId };

  // Read URL from metadata BEFORE removing so we can also drop the
  // scratch clone. Missing metadata isn't fatal — uninstall the
  // catalog dir regardless.
  let url: string | null = null;
  try {
    const raw = await readFile(metadataPath, "utf-8");
    const parsed = JSON.parse(raw) as { url?: unknown };
    const { url: parsedUrl } = parsed;
    if (typeof parsedUrl === "string") url = parsedUrl;
  } catch {
    /* missing or corrupt metadata — proceed with catalog cleanup */
  }

  await rm(repoDir, { recursive: true, force: true });
  if (url) {
    const cacheRoot = deps.cacheRoot ?? defaultCacheRoot();
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    await rm(cacheDir, { recursive: true, force: true }).catch((err) => {
      log.warn("skills-external", "scratch clone cleanup failed", { repoId, cacheDir, error: errorMessage(err) });
    });
  }
  log.info("skills-external", "uninstalled repo", { repoId });
  return { kind: "uninstalled", repoId };
}

export interface InstalledRepo {
  repoId: string;
  url: string;
  subpath?: string;
  ref?: string;
  sha: string;
  installedAt: string;
}

interface RepoMetadataShape {
  url: string;
  subpath?: string;
  ref?: string;
  sha: string;
  installedAt: string;
}

function isRepoMetadata(value: unknown): value is RepoMetadataShape {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string") return false;
  if (typeof record.sha !== "string") return false;
  if (typeof record.installedAt !== "string") return false;
  if (record.subpath !== undefined && typeof record.subpath !== "string") return false;
  if (record.ref !== undefined && typeof record.ref !== "string") return false;
  return true;
}

/** Enumerate installed external repos by reading each `.source.json`
 *  under `data/skills/catalog/external/`. Repos whose metadata fails
 *  shape validation are skipped with a `log.warn`. */
export async function listInstalledRepos(deps: ExternalInstallOptions = {}): Promise<InstalledRepo[]> {
  const workspaceRoot = deps.workspaceRoot ?? workspacePath;
  const root = catalogExternalRoot(workspaceRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: InstalledRepo[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    // `entry` is `readdir`-sourced (tainted). Launder through the
    // `path.basename` round-trip before any join.
    const repoId = safeRepoId(entry);
    if (repoId === null) continue;
    const repoDir = path.join(root, repoId);
    if (!(await isDirectory(repoDir))) continue;
    const metadataPath = path.join(repoDir, SOURCE_METADATA_FILE);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(metadataPath, "utf-8"));
    } catch {
      log.warn("skills-external", "metadata missing or unreadable; skipping repo", { repoId });
      continue;
    }
    if (!isRepoMetadata(parsed)) {
      log.warn("skills-external", "metadata failed shape check; skipping repo", { repoId });
      continue;
    }
    out.push({
      repoId,
      url: parsed.url,
      subpath: parsed.subpath,
      ref: parsed.ref,
      sha: parsed.sha,
      installedAt: parsed.installedAt,
    });
  }
  out.sort((left, right) => left.repoId.localeCompare(right.repoId));
  return out;
}
