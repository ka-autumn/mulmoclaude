// Self-contained file-I/O primitives for the accounting backend.
//
// Reimplemented inside the package (rather than injected) because they
// are small and generic — owning them keeps the host-injection surface
// down to the truly host-specific bits (workspace root, pub/sub,
// logger). Mirrors the host's server/utils/files/{atomic,json,safe}.ts:
// atomic write = tmp file alongside destination + rename (readers never
// see a half-written file).

import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface WriteAtomicOptions {
  /** Use a per-write unique tmp filename. Defaults to `true` so two
   *  concurrent writers targeting the same destination never race on a
   *  shared `${filePath}.tmp` (one renaming/unlinking the other's tmp).
   *  Pass `false` only when a stable tmp name is required. */
  uniqueTmp?: boolean;
}

/** True for a `not found` filesystem error. */
export function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "ENOENT";
}

// On Windows, AV / Search Indexer / Defender briefly hold handles and
// rename trips EPERM/EBUSY/EACCES. The retry loop is gated to Windows
// because on POSIX those codes mean a real permission problem and
// retrying just adds latency before the inevitable throw. Mirrors the
// host's server/utils/files/atomic.ts.
const IS_WINDOWS = process.platform === "win32";
const RENAME_RETRY_DELAYS_MS = [30, 100, 300] as const;

function hasErrnoCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";
}

function isTransientRenameError(err: unknown): boolean {
  if (!IS_WINDOWS || !hasErrnoCode(err)) return false;
  return err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
}

async function renameWithWindowsRetry(fromPath: string, toPath: string): Promise<void> {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      await fsPromises.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Final attempt — let any error propagate.
  await fsPromises.rename(fromPath, toPath);
}

/** Atomic write: unique tmp alongside destination, then rename. */
export async function writeFileAtomic(filePath: string, content: string, opts: WriteAtomicOptions = {}): Promise<void> {
  const uniqueTmp = opts.uniqueTmp ?? true;
  const tmp = uniqueTmp ? `${filePath}.${randomUUID()}.tmp` : `${filePath}.tmp`;
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fsPromises.writeFile(tmp, content, { encoding: "utf-8" });
    await renameWithWindowsRetry(tmp, filePath);
  } catch (err) {
    await fsPromises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Atomic JSON write (2-space indent), the only serialization shape the
 *  accounting io layer needs. */
export async function writeJsonAtomic(filePath: string, data: unknown, opts: WriteAtomicOptions = {}): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), opts);
}
