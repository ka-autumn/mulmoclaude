// Read + star side of the external-skill catalog (#1383 / #1335 PR-C).
//
// Companion to `install.ts` (the writer). This module exposes:
//   - `listExternalCatalogEntries`: enumerate every skill across every
//     installed repo for the catalog listing endpoint.
//   - `readExternalCatalogDetail`: load one entry's description + body
//     for the Preview modal + Run-once action.
//   - `starExternalCatalogEntry`: copy a skill into `.claude/skills/`
//     under its derived `activeId`. Star = fork; the active copy
//     survives later uninstall of the source repo.
//
// All filesystem reads are gated through the same `path.basename`
// round-trip sanitiser the rest of the catalog uses, so CodeQL's
// `js/path-injection` rule recognises the joined paths as safe.

import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { workspacePath } from "../../workspace.js";
import { WORKSPACE_DIRS } from "../../paths.js";
import { parseSkillFrontmatter } from "../parser.js";
import { log } from "../../../system/logger/index.js";
import { deriveActiveId, isSafeRepoId, safeSkillFolder } from "./id.js";
import { listInstalledRepos, type InstalledRepo } from "./install.js";

const SOURCE_METADATA_FILE = ".source.json";

// Folder-name validation is shared with install discovery via
// `safeSkillFolder` (id.ts) so an accepted install is always
// listable / star-able — see the comment on that function.
const safeFolderName = safeSkillFolder;

function externalRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.skillsCatalog, "external");
}

function activeDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.claudeSkills);
}

async function isDirectory(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isFile();
  } catch {
    return false;
  }
}

export interface ExternalCatalogEntry {
  repoId: string;
  /** `"."` indicates the skill lives at the repo root (single-skill
   *  repo); otherwise this is the subdirectory under
   *  `data/skills/catalog/external/<repoId>/`. */
  skillFolder: string;
  /** The slug the entry takes once Starred (`<owner>-<skillFolder>`
   *  or `<owner>-<repo>` for single-skill-at-root). Also used as the
   *  display id in the UI listing. */
  activeId: string;
  description: string;
  alreadyActive: boolean;
  /** Repo URL from `.source.json`. Surfaced so the UI can show the
   *  origin without an extra round-trip. */
  repoUrl: string;
}

interface ScanContext {
  workspaceRoot: string;
  /** Cached active dir to avoid repeated lookups during a single
   *  listing call. */
  activeRoot: string;
}

async function readEntryDescription(skillMd: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(skillMd, "utf-8");
  } catch {
    return null;
  }
  const parsed = parseSkillFrontmatter(raw);
  return parsed?.description ?? null;
}

async function buildEntry(repo: InstalledRepo, skillFolder: string, sourceDir: string, ctx: ScanContext): Promise<ExternalCatalogEntry | null> {
  const skillMd = path.join(sourceDir, "SKILL.md");
  if (!(await isFile(skillMd))) return null;
  const description = await readEntryDescription(skillMd);
  if (description === null) return null;
  const activeId = deriveActiveId(repo.url, skillFolder === "." ? null : skillFolder);
  if (!activeId) return null;
  const alreadyActive = await isDirectory(path.join(ctx.activeRoot, activeId));
  return {
    repoId: repo.repoId,
    skillFolder,
    activeId,
    description,
    alreadyActive,
    repoUrl: repo.url,
  };
}

async function scanRepoEntries(repo: InstalledRepo, ctx: ScanContext): Promise<ExternalCatalogEntry[]> {
  const repoDir = path.join(externalRoot(ctx.workspaceRoot), repo.repoId);
  if (!(await isDirectory(repoDir))) return [];
  if (await isFile(path.join(repoDir, "SKILL.md"))) {
    const entry = await buildEntry(repo, ".", repoDir, ctx);
    return entry ? [entry] : [];
  }
  let names: string[];
  try {
    names = await readdir(repoDir);
  } catch {
    return [];
  }
  const out: ExternalCatalogEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") || name === SOURCE_METADATA_FILE) continue;
    const safe = safeFolderName(name);
    if (safe === null) continue;
    const sub = path.join(repoDir, safe);
    if (!(await isDirectory(sub))) continue;
    const entry = await buildEntry(repo, safe, sub, ctx);
    if (entry) out.push(entry);
  }
  out.sort((left, right) => left.skillFolder.localeCompare(right.skillFolder));
  return out;
}

export interface ExternalCatalogOptions {
  workspaceRoot?: string;
}

export async function listExternalCatalogEntries(opts: ExternalCatalogOptions = {}): Promise<ExternalCatalogEntry[]> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const repos = await listInstalledRepos({ workspaceRoot });
  const ctx: ScanContext = { workspaceRoot, activeRoot: activeDir(workspaceRoot) };
  const out: ExternalCatalogEntry[] = [];
  for (const repo of repos) {
    const entries = await scanRepoEntries(repo, ctx);
    out.push(...entries);
  }
  return out;
}

export interface ExternalCatalogDetail {
  repoId: string;
  skillFolder: string;
  activeId: string;
  description: string;
  body: string;
}

export type ExternalCatalogDetailResult =
  | { kind: "ok"; detail: ExternalCatalogDetail }
  | { kind: "invalid-id" }
  | { kind: "not-found"; repoId: string; skillFolder: string };

interface ResolvedSource {
  repoId: string;
  skillFolder: string;
  sourceDir: string;
  url: string;
}

async function readRepoMetadata(repoDir: string): Promise<{ url: string } | null> {
  try {
    const raw = await readFile(path.join(repoDir, SOURCE_METADATA_FILE), "utf-8");
    const parsed = JSON.parse(raw) as { url?: unknown };
    if (typeof parsed.url !== "string") return null;
    return { url: parsed.url };
  } catch {
    return null;
  }
}

async function resolveSource(repoIdRaw: string, skillFolderRaw: string, workspaceRoot: string): Promise<ResolvedSource | null> {
  if (!isSafeRepoId(repoIdRaw)) return null;
  const repoId = path.basename(repoIdRaw);
  if (repoId !== repoIdRaw) return null;
  const repoDir = path.join(externalRoot(workspaceRoot), repoId);
  if (!(await isDirectory(repoDir))) return null;
  const meta = await readRepoMetadata(repoDir);
  if (!meta) return null;
  if (skillFolderRaw === ".") {
    if (!(await isFile(path.join(repoDir, "SKILL.md")))) return null;
    return { repoId, skillFolder: ".", sourceDir: repoDir, url: meta.url };
  }
  const skillFolder = safeFolderName(skillFolderRaw);
  if (skillFolder === null) return null;
  const sourceDir = path.join(repoDir, skillFolder);
  if (!(await isDirectory(sourceDir))) return null;
  return { repoId, skillFolder, sourceDir, url: meta.url };
}

export async function readExternalCatalogDetail(
  repoIdRaw: string,
  skillFolderRaw: string,
  opts: ExternalCatalogOptions = {},
): Promise<ExternalCatalogDetailResult> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const resolved = await resolveSource(repoIdRaw, skillFolderRaw, workspaceRoot);
  if (!resolved) {
    // Distinguish bad shape (rejected upstream) from missing-on-disk.
    if (!isSafeRepoId(repoIdRaw)) return { kind: "invalid-id" };
    if (skillFolderRaw !== "." && safeFolderName(skillFolderRaw) === null) return { kind: "invalid-id" };
    return { kind: "not-found", repoId: repoIdRaw, skillFolder: skillFolderRaw };
  }
  const skillMd = path.join(resolved.sourceDir, "SKILL.md");
  let raw: string;
  try {
    raw = await readFile(skillMd, "utf-8");
  } catch {
    return { kind: "not-found", repoId: resolved.repoId, skillFolder: resolved.skillFolder };
  }
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed) return { kind: "not-found", repoId: resolved.repoId, skillFolder: resolved.skillFolder };
  const activeId = deriveActiveId(resolved.url, resolved.skillFolder === "." ? null : resolved.skillFolder);
  if (!activeId) return { kind: "not-found", repoId: resolved.repoId, skillFolder: resolved.skillFolder };
  return {
    kind: "ok",
    detail: {
      repoId: resolved.repoId,
      skillFolder: resolved.skillFolder,
      activeId,
      description: parsed.description,
      body: parsed.body,
    },
  };
}

async function copyDirTree(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip the metadata sentinel and any hidden / dot-prefixed entry
    // (`.git/`, `.DS_Store`, etc.) — never relevant to the active copy.
    if (entry.name === SOURCE_METADATA_FILE) continue;
    if (entry.name.startsWith(".")) continue;
    // `readdir` returns leaf names only (no separator inside), but
    // round-trip through `path.basename` as defence-in-depth so
    // CodeQL recognises the joined paths as sanitised.
    const safe = path.basename(entry.name);
    if (safe !== entry.name) continue;
    const srcPath = path.join(srcDir, safe);
    const destPath = path.join(destDir, safe);
    if (entry.isDirectory()) {
      await copyDirTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

export type ExternalStarResult =
  | { kind: "starred"; activeId: string }
  | { kind: "already-active"; activeId: string }
  | { kind: "not-found"; repoId: string; skillFolder: string }
  | { kind: "invalid-id" };

export async function starExternalCatalogEntry(repoIdRaw: string, skillFolderRaw: string, opts: ExternalCatalogOptions = {}): Promise<ExternalStarResult> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const resolved = await resolveSource(repoIdRaw, skillFolderRaw, workspaceRoot);
  if (!resolved) {
    if (!isSafeRepoId(repoIdRaw)) return { kind: "invalid-id" };
    if (skillFolderRaw !== "." && safeFolderName(skillFolderRaw) === null) return { kind: "invalid-id" };
    return { kind: "not-found", repoId: repoIdRaw, skillFolder: skillFolderRaw };
  }
  const activeId = deriveActiveId(resolved.url, resolved.skillFolder === "." ? null : resolved.skillFolder);
  if (!activeId) return { kind: "invalid-id" };
  const activeSlugDir = path.join(activeDir(workspaceRoot), activeId);
  if (await isDirectory(activeSlugDir)) return { kind: "already-active", activeId };
  await copyDirTree(resolved.sourceDir, activeSlugDir);
  log.info("skills-external", "starred entry", { repoId: resolved.repoId, skillFolder: resolved.skillFolder, activeId });
  return { kind: "starred", activeId };
}
