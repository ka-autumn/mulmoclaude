// Atomic file write, ported from the host's server/utils/files/atomic.ts so
// the package server engine carries no dependency on host utils. rename(2) is
// atomic on POSIX; the Windows retry loop survives AV / Search-Indexer handle
// contention. Readers always see either the old file or the new — never a
// half-written one. (The engine only needs the async, default-tmp variant.)

import { promises } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const RENAME_RETRY_DELAYS_MS = [30, 100, 300] as const;

function hasErrnoCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";
}

// Gate the retry to Windows: on POSIX, EPERM means a real permission problem
// (read-only fs, cross-device) and retrying just delays the inevitable throw.
function isTransientRenameError(err: unknown): boolean {
  if (!IS_WINDOWS || !hasErrnoCode(err)) return false;
  return err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
}

async function renameWithWindowsRetry(fromPath: string, toPath: string): Promise<void> {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      await promises.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Final attempt — let any error propagate.
  await promises.rename(fromPath, toPath);
}

// Forcing utf-8 on a Uint8Array would re-encode the bytes — wrong for binary blobs.
function writeOptionsFor(content: string | Uint8Array): { encoding?: "utf-8" } {
  return typeof content === "string" ? { encoding: "utf-8" } : {};
}

export async function writeFileAtomic(filePath: string, content: string | Uint8Array): Promise<void> {
  // Unique tmp suffix so two concurrent writes to the same target don't clobber
  // each other's temp file (which would cause a rename failure or lost update).
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await promises.writeFile(tmp, content, writeOptionsFor(content));
    await renameWithWindowsRetry(tmp, filePath);
  } catch (err) {
    await promises.unlink(tmp).catch(() => {});
    throw err;
  }
}
