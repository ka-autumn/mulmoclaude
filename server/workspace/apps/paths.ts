// Path helpers + safe-slug guard for the apps module. Mirrors the
// pattern used by `server/workspace/skills/catalog.ts` so CodeQL's
// `js/path-injection` sanitiser recognises our taint-launder.

import path from "node:path";
import { workspacePath } from "../workspace.js";

export const SCHEMA_FILE = "schema.json";

// Same regex as `server/workspace/skills/catalog.ts#SAFE_SLUG_PATTERN`
// — keep them in sync. Bounded character classes, no nested
// quantifiers; ReDoS-safe.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping character classes, no catastrophic backtracking
const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

/** Sanitise a user-supplied slug into a safe directory-name leaf.
 *  Returns null for anything that fails the slug whitelist OR isn't a
 *  basename (i.e. survives `path.basename` round-trip unchanged).
 *  The basename round-trip is the pattern CodeQL recognises as a
 *  `js/path-injection` sanitiser. */
export function safeSlugName(slug: string): string | null {
  if (typeof slug !== "string") return null;
  if (!SAFE_SLUG_PATTERN.test(slug)) return null;
  const basename = path.basename(slug);
  if (basename !== slug) return null;
  return basename;
}

/** Resolve a schema-declared dataPath against the workspace root,
 *  refusing anything that escapes (absolute paths, `..`-segments,
 *  empty string). Returns the absolute path on success, null on
 *  refusal. Does NOT require the directory to exist — the caller may
 *  create it on first write. */
export function resolveDataDir(dataPath: string): string | null {
  if (typeof dataPath !== "string" || dataPath.length === 0) return null;
  if (path.isAbsolute(dataPath)) return null;
  const normalized = path.normalize(dataPath);
  if (normalized.startsWith("..") || normalized.includes(`${path.sep}..${path.sep}`)) return null;
  const resolved = path.resolve(workspacePath, normalized);
  if (resolved !== workspacePath && !resolved.startsWith(workspacePath + path.sep)) return null;
  return resolved;
}

/** Compose the absolute path to a single record file. Both arguments
 *  must have been passed through `safeSlugName` / `resolveDataDir`
 *  before reaching here so the join can't escape. */
export function itemFilePath(dataDir: string, itemId: string): string {
  return path.join(dataDir, `${itemId}.json`);
}
