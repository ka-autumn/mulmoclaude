// Preset skills bundled with mulmoclaude.
//
// History: introduced in #1210 to ship launcher-managed "factory"
// skills like `mc-library`. Originally synced straight into
// `<workspaceRoot>/.claude/skills/<slug>/`, which made every preset
// auto-active and inflated the Claude system prompt as new presets
// landed.
//
// #1335 PR-A flipped the destination to the catalog
// (`<workspaceRoot>/data/skills/catalog/preset/<slug>/`). Catalog
// entries are visible to UI / tooling but NOT discovered by Claude
// Code's slash-command resolver — they don't enter the system
// prompt unless the user (or a later UI in PR-B) explicitly copies
// one into `.claude/skills/`.
//
// The launcher overwrites catalog entries unconditionally on every
// boot — they're factory defaults, not user state. Anything in
// `.claude/skills/` (active layer) is left untouched.
//
// `syncPresetSkills(...)` is exported as a pure-ish helper (takes
// paths + a logger sink, returns a summary) so tests can drive it
// against tmpdirs without touching a real workspace.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { errorMessage } from "../utils/errors.js";

// Recursively mirror `srcDir` into `destDir`. Used by the preset
// sync so a preset skill that ships sibling assets (e.g.
// `schema.json` for schema-driven apps, `templates/*.html`) gets
// copied alongside `SKILL.md` rather than silently dropped. Only
// regular files and directories are followed — symlinks / FIFOs /
// sockets are skipped because the preset tree is launcher-managed
// and shouldn't contain them.
function copyDirTreeSync(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirTreeSync(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

const PRESET_SLUG_PREFIX = "mc-";
const SKILL_FILENAME = "SKILL.md";

export interface SyncPresetSkillsOptions {
  /** Source directory: `<launcher>/server/workspace/skills-preset/`. */
  sourceDir: string;
  /** Destination directory:
   *  `<workspaceRoot>/data/skills/catalog/preset/`. The catalog
   *  half of the catalog-vs-active split — entries here are visible
   *  to UI but NOT to Claude Code's prompt-time skill resolver. */
  destDir: string;
  /** Logger callbacks — kept injectable so tests don't need to
   *  spin up the structured logger. The boot-side wrapper threads
   *  these through to `log.info` / `log.warn`. */
  onInfo?: (message: string, data?: Record<string, unknown>) => void;
  onWarn?: (message: string, data?: Record<string, unknown>) => void;
}

export interface SyncPresetSkillsResult {
  /** Slugs successfully copied (or refreshed) from source to dest. */
  copied: string[];
  /** Slugs removed from dest because they no longer exist in source.
   *  Bounded to `mc-*` entries — user-authored slugs are never
   *  considered for removal. */
  removed: string[];
  /** Source entries that failed validation (wrong prefix, missing
   *  SKILL.md, etc.) and were skipped. Each entry is human-readable. */
  skipped: string[];
}

/** Validate that a slug starts with the launcher's preset namespace.
 *  Exported for tests; the boot-time guard relies on this. */
export function isPresetSlug(slug: string): boolean {
  return slug.startsWith(PRESET_SLUG_PREFIX) && slug.length > PRESET_SLUG_PREFIX.length;
}

// Classification of one source entry. `silent` distinguishes
// structural skips (hidden files, non-directory entries — not the
// dev's fault) from misconfigurations (bad slug, missing or
// non-regular SKILL.md — the dev WANTS to know). The boolean lives
// on the verdict so the caller never has to string-match `reason`,
// which would silently drop warnings if reason wording changed
// (CodeRabbit review).
type Verdict = { ok: true } | { ok: false; reason: string; silent: boolean };

function classifySourceEntry(sourceDir: string, entry: string): Verdict {
  if (entry.startsWith(".")) return { ok: false, reason: "hidden", silent: true };
  const slugDir = path.join(sourceDir, entry);
  let dirInfo;
  try {
    dirInfo = statSync(slugDir);
  } catch {
    return { ok: false, reason: "stat failed", silent: true };
  }
  if (!dirInfo.isDirectory()) return { ok: false, reason: "not a directory", silent: true };
  if (!isPresetSlug(entry)) return { ok: false, reason: `slug must start with "${PRESET_SLUG_PREFIX}"`, silent: false };
  // Validate SKILL.md is a regular file — `existsSync` alone
  // accepts a directory at that path, which would then crash
  // copyFileSync. Codex review caught this edge case.
  const skillPath = path.join(slugDir, SKILL_FILENAME);
  let skillInfo;
  try {
    skillInfo = statSync(skillPath);
  } catch {
    return { ok: false, reason: `missing ${SKILL_FILENAME}`, silent: false };
  }
  if (!skillInfo.isFile()) return { ok: false, reason: `${SKILL_FILENAME} must be a regular file`, silent: false };
  return { ok: true };
}

/** Prepare the destination slug dir. Returns false if the slot is
 *  occupied by a regular file (local corruption / hand edits) — the
 *  caller logs + skips so one bad entry can't crash the whole boot
 *  (Codex review iter-1). */
function ensureDestSlugDir(destSlugDir: string): boolean {
  let info;
  try {
    info = statSync(destSlugDir);
  } catch {
    mkdirSync(destSlugDir, { recursive: true });
    return true;
  }
  return info.isDirectory();
}

function copySourcesIntoDest(sourceDir: string, destDir: string, opts: SyncPresetSkillsOptions, result: SyncPresetSkillsResult): Set<string> {
  const synced = new Set<string>();
  for (const entry of readdirSync(sourceDir)) {
    const verdict = classifySourceEntry(sourceDir, entry);
    if (!verdict.ok) {
      if (!verdict.silent) {
        result.skipped.push(`${entry}: ${verdict.reason}`);
        opts.onWarn?.("preset entry skipped", { slug: entry, reason: verdict.reason });
      }
      continue;
    }
    const destSlugDir = path.join(destDir, entry);
    if (!ensureDestSlugDir(destSlugDir)) {
      const reason = "destination slot occupied by a non-directory; skipping";
      result.skipped.push(`${entry}: ${reason}`);
      opts.onWarn?.("preset entry skipped", { slug: entry, reason, destSlugDir });
      continue;
    }
    // Wipe-and-replace so stale sibling assets (e.g. a schema.json
    // dropped between releases) don't linger. The catalog preset
    // slot is launcher-owned per the file header; user edits here
    // are not preserved across boots. SKILL.md alone would survive
    // the legacy single-file copy, but schema-driven apps and
    // template-bearing skills need the full tree to be authoritative.
    rmSync(destSlugDir, { recursive: true, force: true });
    copyDirTreeSync(path.join(sourceDir, entry), destSlugDir);
    synced.add(entry);
    result.copied.push(entry);
  }
  return synced;
}

function removeRetiredPresets(destDir: string, synced: ReadonlySet<string>, opts: SyncPresetSkillsOptions, result: SyncPresetSkillsResult): void {
  for (const entry of readdirSync(destDir)) {
    if (!isPresetSlug(entry)) continue;
    if (synced.has(entry)) continue;
    const stalePath = path.join(destDir, entry);
    try {
      if (!statSync(stalePath).isDirectory()) continue;
    } catch {
      continue;
    }
    rmSync(stalePath, { recursive: true, force: true });
    result.removed.push(entry);
    opts.onInfo?.("removed retired preset skill", { slug: entry });
  }
}

/** Copy every preset slug from `sourceDir` into `destDir` (the
 *  preset slot under the catalog root), then remove any `mc-*`
 *  entries in `destDir` that no longer have a source. The catalog
 *  preset subdir is fully launcher-owned, so the `mc-*` prefix
 *  check at destination is defence-in-depth: a stray non-preset
 *  slug landing in `catalog/preset/` is unexpected, and we'd
 *  rather skip it than silently delete a directory we don't
 *  recognise. */
export function syncPresetSkills(opts: SyncPresetSkillsOptions): SyncPresetSkillsResult {
  const result: SyncPresetSkillsResult = { copied: [], removed: [], skipped: [] };
  if (!existsSync(opts.sourceDir)) {
    // No preset directory in the launcher tarball — nothing to do.
    // This is the legitimate "no presets shipped yet" state.
    return result;
  }
  // Source-side validation: the launcher's preset path COULD exist
  // as a regular file (a packaging bug, a corrupted install). Without
  // this guard, `readdirSync(sourceDir)` would throw ENOTDIR and
  // crash boot. Codex review iter-3.
  let sourceInfo;
  try {
    sourceInfo = statSync(opts.sourceDir);
  } catch (err) {
    const reason = `source path stat failed: ${errorMessage(err)}`;
    result.skipped.push(`${opts.sourceDir}: ${reason}`);
    opts.onWarn?.("preset sync aborted", { sourceDir: opts.sourceDir, reason });
    return result;
  }
  if (!sourceInfo.isDirectory()) {
    const reason = "source path exists as a non-directory; preset sync skipped";
    result.skipped.push(`${opts.sourceDir}: ${reason}`);
    opts.onWarn?.("preset sync aborted", { sourceDir: opts.sourceDir, reason });
    return result;
  }
  // The root dest itself can be corrupted into a regular file by a
  // user / external tool; mkdirSync would throw EEXIST and crash
  // boot. Treat it as a recoverable "skip the entire sync" state
  // — log a clear warning so the user sees what to fix.
  // (Codex review iter-2.)
  if (!ensureDestSlugDir(opts.destDir)) {
    const reason = "root dest exists as a non-directory; preset sync skipped";
    result.skipped.push(`${opts.destDir}: ${reason}`);
    opts.onWarn?.("preset sync aborted", { destDir: opts.destDir, reason });
    return result;
  }
  const synced = copySourcesIntoDest(opts.sourceDir, opts.destDir, opts, result);
  removeRetiredPresets(opts.destDir, synced, opts, result);
  if (result.copied.length > 0 || result.removed.length > 0) {
    opts.onInfo?.("preset skills synced", {
      copied: result.copied.length,
      removed: result.removed.length,
      skipped: result.skipped.length,
    });
  }
  return result;
}
