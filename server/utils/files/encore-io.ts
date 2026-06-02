// Single fs gateway for the Encore plugin. All reads / writes
// against `data/plugins/encore/...` route through here so callers
// don't sprinkle raw fs / path joins around (CLAUDE.md rule). All
// writes use `writeFileAtomic` so partial writes can't corrupt the
// on-disk DSL or cycle state.
//
// Domain-agnostic helpers only (read text, write text, read dir,
// exists, unlink). Markdown frontmatter parsing / serialization
// lives next to the consumers in src/plugins/encore/.

import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { isEnoent } from "./safe.js";

/** Absolute path to the Encore plugin's data directory. Reads
 *  `WORKSPACE_PATHS.encore` so tests can override the absolute
 *  location via Object.defineProperty (same pattern bookmarks
 *  integration tests use for `pluginsData`). The optional
 *  `workspaceRoot` is a one-off override for callers that want to
 *  point at a custom directory without touching the global. */
export function encoreRoot(workspaceRoot?: string): string {
  if (workspaceRoot !== undefined) return path.join(workspaceRoot, WORKSPACE_DIRS.encore);
  return WORKSPACE_PATHS.encore;
}

/** Join a workspace-relative encore path (from paths.ts) to the
 *  absolute on-disk location. Validates that the resolved path is
 *  still inside the Encore root — `path.join` alone happily
 *  resolves `../../..` and escapes the plugin tree if a caller
 *  ever passes a traversal-laden segment. paths.ts validates
 *  segments at the source, but defense in depth is cheap. */
function abs(rel: string, workspaceRoot?: string): string {
  const root = encoreRoot(workspaceRoot);
  const resolved = path.resolve(root, rel);
  const normalisedRoot = path.resolve(root);
  if (resolved !== normalisedRoot && !resolved.startsWith(`${normalisedRoot}${path.sep}`)) {
    throw new Error(`encore: path ${JSON.stringify(rel)} escapes the plugin root`);
  }
  return resolved;
}

/** Read a text file under the Encore tree. Returns `null` if the
 *  file doesn't exist (vs. throwing on ENOENT) — callers usually
 *  want the missing-file case as "no such obligation" rather than
 *  an error. */
export async function readTextOrNull(rel: string, workspaceRoot?: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(abs(rel, workspaceRoot), "utf8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** Write text atomically; creates parent directories as needed. */
export async function writeText(rel: string, content: string, workspaceRoot?: string): Promise<void> {
  const target = abs(rel, workspaceRoot);
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, content);
}

/** True iff the path exists (file or dir). */
export async function exists(rel: string, workspaceRoot?: string): Promise<boolean> {
  try {
    await fsPromises.stat(abs(rel, workspaceRoot));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/** List directory entries (basenames only). Empty array if the
 *  directory doesn't exist — easier than threading ENOENT through
 *  every list call. */
export async function readDir(rel: string, workspaceRoot?: string): Promise<string[]> {
  try {
    return await fsPromises.readdir(abs(rel, workspaceRoot));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/** Like `readDir`, but returns only entries that are themselves
 *  directories. Used to enumerate obligation IDs without tripping
 *  over `.DS_Store` and other stray non-directory entries that
 *  macOS and editors drop into the tree. */
export async function readDirSubdirs(rel: string, workspaceRoot?: string): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(abs(rel, workspaceRoot), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/** Remove a file. No-op if it doesn't exist (matches the semantics
 *  callers want when sweeping orphan tickets). */
export async function unlink(rel: string, workspaceRoot?: string): Promise<void> {
  try {
    await fsPromises.unlink(abs(rel, workspaceRoot));
  } catch (err) {
    if (isEnoent(err)) return;
    throw err;
  }
}

/** Recursively remove a directory and its contents. No-op if it
 *  doesn't exist (`force: true`) — same tolerant semantics as
 *  `unlink`, so deleting an obligation that's already half-gone
 *  doesn't throw. The `abs` guard rejects any traversal segment, so
 *  this can only ever target a path inside the Encore plugin root. */
export async function removeDir(rel: string, workspaceRoot?: string): Promise<void> {
  await fsPromises.rm(abs(rel, workspaceRoot), { recursive: true, force: true });
}
