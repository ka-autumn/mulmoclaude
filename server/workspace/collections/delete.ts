// Delete a user-authored collection, archiving a full restorable copy
// first. A collection spans three on-disk locations (see
// docs/collections-architecture.md "Deleting a collection"):
//
//   1. data/skills/<slug>/    staging — the canonical skill source
//   2. .claude/skills/<slug>/ active mirror — what discovery scans
//   3. <schema.dataPath>/     the records (one <id>.json per record)
//
// Locations 1 and 2 are a source→mirror pair maintained by the
// skill-bridge hook, but that hook only fires on the agent's own tool
// calls — a server-side delete must remove BOTH explicitly. Before
// anything is removed we write a single skill copy (from the canonical
// staging dir), the records, and an LLM-runnable RESTORE.md to
// `archive/<date>-<uuid>/`.
//
// Only project-scope, non-preset collections are deletable: user-scope
// skills (`~/.claude/skills/`) are read-only from MulmoClaude, and a
// preset (`mc-*`) re-seeds on next boot so deleting it is futile.

import { cp, mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { log } from "../../system/logger/index.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { workspacePath } from "../workspace.js";
import { isPresetSlug } from "../skills-preset.js";
import { isContainedInRoot } from "./paths.js";
import type { LoadedCollection } from "./discovery.js";

export type DeleteCollectionResult =
  | { kind: "ok"; slug: string; archivePath: string }
  | { kind: "user-scope"; slug: string }
  | { kind: "preset"; slug: string }
  | { kind: "unsafe-data-path"; slug: string }
  | { kind: "path-escape"; slug: string };

type DeleteRefusal = Exclude<DeleteCollectionResult, { kind: "ok" }>;

/** Human-readable reason for a non-`ok` delete result. Exported so the
 *  route maps `kind` → message without inlining the switch (keeps the
 *  handler short and the mapping unit-testable). The `Record` is
 *  exhaustive — a new refusal kind won't compile until it's added. */
export function deleteCollectionRefusalMessage(result: DeleteRefusal): string {
  const { slug } = result;
  const messages: Record<DeleteRefusal["kind"], string> = {
    "user-scope": `collection '${slug}' is user-scope (~/.claude/skills/) and is read-only from MulmoClaude`,
    preset: `collection '${slug}' is a preset (mc-*) and re-seeds on restart; unstar it from the catalog instead`,
    "unsafe-data-path": `collection '${slug}' declares a dataPath outside its own data/${slug}/ subtree; refusing to delete`,
    "path-escape": `a directory for collection '${slug}' escapes the workspace`,
  };
  return messages[result.kind];
}

export interface DeleteCollectionOptions {
  /** Override the workspace root for containment checks + archive
   *  placement. Default: the live `workspacePath`. Tests point this at
   *  a `mkdtempSync` tree (same pattern as the IO helpers). */
  workspaceRoot?: string;
  /** Override the `<date>` half of the archive folder name. Tests pass
   *  a fixed stamp so the asserted path is deterministic; production
   *  leaves it unset and the current UTC date (YYYY-MM-DD) is used. */
  dateStamp?: string;
}

/** The canonical staging dir for a slug: `data/skills/<slug>`. */
function stagingSkillDir(workspaceRoot: string, slug: string): string {
  return path.join(workspaceRoot, WORKSPACE_DIRS.skillsStaging, slug);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** UTC `YYYY-MM-DD` — keeps the archive folder human-sortable. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every directory the delete will touch must resolve under the
 *  workspace root — guards against a symlinked ancestor escaping it. */
function deleteTargets(collection: LoadedCollection, workspaceRoot: string): string[] {
  return [stagingSkillDir(workspaceRoot, collection.slug), collection.skillDir, collection.dataDir];
}

/** The records directory the delete recursively archives + removes
 *  (`collection.dataDir`) must live in this collection's OWN
 *  `data/<slug>/` subtree. `dataDir` is normally derived from
 *  `schema.dataPath`, but `deleteCollection` accepts a `LoadedCollection`
 *  whose fields could be inconsistent — so we validate the RESOLVED
 *  target the destructive ops actually touch, not the schema string.
 *  `resolveDataDir` only proves containment in the workspace; a shared
 *  root like `data` or `data/skills` would otherwise turn the recursive
 *  removal into a workspace-wide wipe whose archive captures only this
 *  collection. `path.resolve` collapses any `..` before the prefix test
 *  (symlink escapes are caught separately by the realpath containment
 *  check in `deleteTargets`). */
function isDataDirSafe(dataDir: string, slug: string, workspaceRoot: string): boolean {
  const expectedRoot = path.resolve(workspaceRoot, "data", slug);
  const resolved = path.resolve(dataDir);
  return resolved === expectedRoot || resolved.startsWith(expectedRoot + path.sep);
}

function buildRestoreDoc(collection: LoadedCollection): string {
  const { slug, schema } = collection;
  return `# Restore "${schema.title}" (collection \`${slug}\`)

This folder is an automatic backup made when the collection was deleted.
Follow these steps to restore it.

1. Recreate the skill files in \`data/skills/${slug}/\` using the **Write
   tool**: read each file under \`skill/\` and Write it to the matching
   path — \`SKILL.md\`, \`schema.json\`, and any \`templates/*\`.

   IMPORTANT — use the Write tool, NOT \`cp\` / \`mv\` / a shell redirect.
   The skill-bridge hook mirrors \`data/skills/${slug}/\` into
   \`.claude/skills/${slug}/\`, and that mirror is what actually registers
   the collection. The hook only fires on Write/Edit tool calls, so a
   \`cp\` would leave the files in staging with no \`.claude/skills/\`
   mirror — the collection would stay invisible. (Writing
   \`.claude/skills/\` directly is not an option either: that path is
   permission-gated.)

2. Copy the item data: \`cp\` every file under \`records/\` into
   \`${schema.dataPath}/\`. The records are part of the collection and
   must be restored. They are plain data files (NOT bridged), so use
   \`cp\` — the Write-tool rule in step 1 applies ONLY to the skill
   files, not to these records (there may be many; copy them, do not
   Write them one by one).

3. Confirm the collection reappears at \`/collections/${slug}\`.

- slug: \`${slug}\`
- title: ${schema.title}
- dataPath: \`${schema.dataPath}\`
`;
}

/** Copy one skill copy + the records + RESTORE.md into `archiveDir`. */
async function writeArchive(collection: LoadedCollection, archiveDir: string, workspaceRoot: string): Promise<void> {
  // Prefer the canonical staging dir; fall back to the active mirror
  // for a project collection that was created without the bridge.
  const staging = stagingSkillDir(workspaceRoot, collection.slug);
  const skillSrc = (await pathExists(staging)) ? staging : collection.skillDir;
  await cp(skillSrc, path.join(archiveDir, "skill"), { recursive: true });
  if (await pathExists(collection.dataDir)) {
    await cp(collection.dataDir, path.join(archiveDir, "records"), { recursive: true });
  }
  await writeFile(path.join(archiveDir, "RESTORE.md"), buildRestoreDoc(collection), "utf-8");
}

/** Remove all three locations. `rm -rf`-style (force) so a missing dir
 *  is a no-op; the now-empty data parent (`data/<slug>/` after its
 *  `items/` is gone) is swept too, but only when empty. */
async function removeLocations(collection: LoadedCollection, workspaceRoot: string): Promise<void> {
  await rm(stagingSkillDir(workspaceRoot, collection.slug), { recursive: true, force: true });
  await rm(collection.skillDir, { recursive: true, force: true });
  await rm(collection.dataDir, { recursive: true, force: true });
  await rmdir(path.dirname(collection.dataDir)).catch(() => undefined);
}

export async function deleteCollection(collection: LoadedCollection, opts: DeleteCollectionOptions = {}): Promise<DeleteCollectionResult> {
  const { slug } = collection;
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  if (collection.source === "user") return { kind: "user-scope", slug };
  if (isPresetSlug(slug)) return { kind: "preset", slug };
  if (!isDataDirSafe(collection.dataDir, slug, workspaceRoot)) {
    log.warn("collections", "deleteCollection refused: dataDir is not under the per-collection root", { slug, dataDir: collection.dataDir });
    return { kind: "unsafe-data-path", slug };
  }
  if (deleteTargets(collection, workspaceRoot).some((target) => !isContainedInRoot(target, workspaceRoot))) {
    log.warn("collections", "deleteCollection refused: a target escapes the workspace", { slug });
    return { kind: "path-escape", slug };
  }
  const archiveRel = path.join(WORKSPACE_DIRS.archive, `${opts.dateStamp ?? todayStamp()}-${randomUUID()}`);
  const archiveDir = path.join(workspaceRoot, archiveRel);
  await mkdir(archiveDir, { recursive: true });
  await writeArchive(collection, archiveDir, workspaceRoot);
  await removeLocations(collection, workspaceRoot);
  log.info("collections", "collection deleted + archived", { slug, archive: archiveRel });
  return { kind: "ok", slug, archivePath: archiveRel };
}
