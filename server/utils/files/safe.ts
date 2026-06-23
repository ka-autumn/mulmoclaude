// Wrappers that swallow ENOENT/EACCES so callers branch on `result === null` instead of try/catch.
// resolveWithinRoot is the realpath-based traversal check used by every endpoint serving workspace files.

import { Dirent, Stats, promises, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { isErrorWithCode } from "../types.js";

export function isEnoent(err: unknown): boolean {
  return isErrorWithCode(err) && err.code === "ENOENT";
}

export function readBinarySafeSync(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

export async function readTextSafe(absPath: string): Promise<string | null> {
  try {
    return await promises.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

export function readTextSafeSync(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

export function statSafe(absPath: string): Stats | null {
  try {
    return statSync(absPath);
  } catch {
    return null;
  }
}

export async function statSafeAsync(absPath: string): Promise<Stats | null> {
  try {
    return await promises.stat(absPath);
  } catch {
    return null;
  }
}

export function readDirSafe(absPath: string): Dirent[] {
  try {
    return readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readDirSafeAsync(absPath: string): Promise<Dirent[]> {
  try {
    return await promises.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await promises.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

// True if any segment of `relPath` (split on either `/` or `\`)
// starts with a dot — the same policy `express.static({ dotfiles:
// "deny" })` applies. Splits on both separators because
// `decodeURIComponent` of `%5C` produces a literal `\`, and on
// Windows `path.normalize` (used downstream by `resolveWithinRoot`)
// treats `\` as a separator. Without the dual split, a request like
// `/dir%5C.hidden.html` decodes to `dir\.hidden.html` → splits on
// `/` as one segment `dir\.hidden.html` (no leading dot) → bypasses
// the guard on Windows even though `path.normalize` later resolves
// it to `dir/.hidden.html`. (Codex review on PR #1082.)
export function containsDotfileSegment(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((segment) => segment.startsWith("."));
}

// True if any segment is the literal `.` or `..` — i.e. a traversal
// move. Stricter sibling of `containsDotfileSegment`: dotfiles like
// `.git` are NOT flagged, only the two traversal tokens. Used by
// `isAttachmentPath` / `isImagePath` where dotfiles are legitimate
// (encoded shortIds can land near `.tmp` siblings during atomic
// writes) but `..`/`.` segments must never reach the on-disk path.
// Splits on `/` AND `\` for the same Windows-decode rationale as
// `containsDotfileSegment`.
export function hasTraversalSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment === ".." || segment === ".");
}

// `rootReal` MUST already be a realpath. Returns null on traversal or if either path doesn't exist on disk.
export function resolveWithinRoot(rootReal: string, relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(rootReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = realpathSync(resolved);
  } catch {
    return null;
  }
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(rootReal + path.sep)) {
    return null;
  }
  return resolvedReal;
}

// `C:foo`, `c:relative\path` — Windows drive-qualified RELATIVE paths.
// `path.isAbsolute` returns false (they're relative to the drive's CWD,
// not absolute), but `path.resolve(rootReal, "C:foo")` resolves onto
// drive C: instead of staying under `rootReal`. POSIX-only repros
// cannot trigger it, so it has to be caught at the string-validation
// stage explicitly.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

function parseWriteSegments(relPath: string): { parentSegments: string[]; leaf: string } | null {
  if (!relPath || relPath.includes("\0") || path.isAbsolute(relPath) || WINDOWS_DRIVE_RE.test(relPath)) return null;
  const segments = relPath.split(/[/\\]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return { parentSegments: segments.slice(0, -1), leaf: segments[segments.length - 1] };
}

// `path.relative(root, candidate)` returns a string starting with
// `..` if `candidate` escapes `root`. This is the canonical CodeQL
// `js/path-injection` sanitizer pattern; using it (rather than the
// equivalent `startsWith(root + sep)`) lets the data-flow analysis
// recognize the lexical containment check as a sanitizer.
function escapesRoot(rootReal: string, candidate: string): boolean {
  const relative = path.relative(rootReal, candidate);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

// Walk rootReal → parent, realpath-checking every existing ancestor.
// Returns false if any existing ancestor escapes root via symlink. The
// first non-existing ancestor marks the boundary: every directory
// below sits under verified-in-root soil and is safe to `mkdir -p`.
//
// The lexical `escapesRoot` check before `realpath` is redundant at
// runtime (parseWriteSegments rejects `..` / `.` / absolute /
// Windows-drive inputs, so `path.resolve(rootReal, segment)` cannot
// escape lexically) but is required so CodeQL's data-flow analysis
// recognizes the `path.relative` sanitizer pattern on every iteration
// before the realpath sink.
async function existingAncestorsStayInRoot(rootReal: string, parentSegments: string[]): Promise<boolean> {
  let cursor = rootReal;
  for (const segment of parentSegments) {
    const candidate = path.resolve(cursor, segment);
    if (escapesRoot(rootReal, candidate)) return false;
    let candidateReal: string;
    try {
      candidateReal = await promises.realpath(candidate);
    } catch (err) {
      if (isEnoent(err)) return true;
      throw err;
    }
    if (escapesRoot(rootReal, candidateReal)) return false;
    cursor = candidateReal;
  }
  return true;
}

// Write-time sibling of `resolveWithinRoot`. `resolveWithinRoot`
// runs `realpathSync` on the full path which throws `ENOENT` for a
// leaf that does not exist yet — fine for reads, but the swallowed
// ENOENT is indistinguishable from a traversal escape, so callers
// pre-validating a not-yet-written path get a false "rejected".
//
// Returns `null` ONLY when the input itself is unsafe (string
// validation failed or a verified ancestor escapes root). Filesystem
// errors that are NOT security-related (`EACCES`, `EROFS`, …) are
// propagated so the caller sees the real failure mode instead of a
// misleading "path traversal rejected".
export async function resolveWriteWithinRoot(rootReal: string, relPath: string): Promise<string | null> {
  const parsed = parseWriteSegments(relPath);
  if (!parsed) return null;
  if (!(await existingAncestorsStayInRoot(rootReal, parsed.parentSegments))) return null;
  const parentAbs = path.resolve(rootReal, parsed.parentSegments.join(path.sep));
  if (escapesRoot(rootReal, parentAbs)) return null;
  await promises.mkdir(parentAbs, { recursive: true });
  const parentReal = await promises.realpath(parentAbs);
  if (escapesRoot(rootReal, parentReal)) return null;
  return path.join(parentReal, parsed.leaf);
}
