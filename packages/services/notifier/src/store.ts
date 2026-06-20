// Low-level file I/O for the notifier. Reads use node:fs directly;
// writes go through an injected atomic-JSON writer (the host owns the
// rename-based atomic write so it stays single-sourced with its other
// writers). Kept separate from `engine.ts` so the path can be
// overridden in tests without monkey-patching.

import { promises as fsPromises } from "node:fs";
import type { NotifierFile, NotifierHistoryFile } from "./types.js";

/** Injected atomic JSON writer — the host's `writeJsonAtomic`. */
export type WriteJson = (filePath: string, data: unknown) => Promise<void>;

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/** Read the active-entries file. Returns an empty store when the file
 *  doesn't exist yet (first ever call on a fresh workspace). Any other
 *  read or parse failure throws — the caller has to decide whether to
 *  surface or recover, since silently treating "malformed file" as
 *  "no entries" would lose data. */
export async function loadActive(filePath: string): Promise<NotifierFile> {
  let text: string;
  try {
    text = await fsPromises.readFile(filePath, "utf-8");
  } catch (err) {
    if (isNotFoundError(err)) return { entries: {} };
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  // `typeof null === "object"` and `Array.isArray([])` is also true,
  // so a naive `typeof entries !== "object"` check would let
  // `{ entries: null }` and `{ entries: [] }` through, which then
  // crash downstream `engine.get` / `list*` mutations. Reject both
  // shapes here at load time so the failure surfaces as a clear
  // "malformed file" error.
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed)) {
    throw new Error(`notifier: malformed active.json at ${filePath}`);
  }
  const { entries } = parsed as { entries: unknown };
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new Error(`notifier: malformed active.json at ${filePath}`);
  }
  return parsed as NotifierFile;
}

/** Write the active-entries file via the injected atomic writer so a
 *  half-written file is never visible to readers. The caller serialises
 *  writes (engine.ts queues mutations) — this function makes no
 *  concurrency guarantees of its own. */
export async function saveActive(writeJson: WriteJson, filePath: string, state: NotifierFile): Promise<void> {
  await writeJson(filePath, state);
}

/** Read the history file. Empty array on first run. Same parse-error
 *  policy as `loadActive`. */
export async function loadHistory(filePath: string): Promise<NotifierHistoryFile> {
  let text: string;
  try {
    text = await fsPromises.readFile(filePath, "utf-8");
  } catch (err) {
    if (isNotFoundError(err)) return { entries: [] };
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed) || !Array.isArray((parsed as { entries: unknown }).entries)) {
    throw new Error(`notifier: malformed history.json at ${filePath}`);
  }
  return parsed as NotifierHistoryFile;
}

export async function saveHistory(writeJson: WriteJson, filePath: string, state: NotifierHistoryFile): Promise<void> {
  await writeJson(filePath, state);
}
