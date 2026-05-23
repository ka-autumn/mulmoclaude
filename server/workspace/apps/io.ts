// Read / write item files for schema-driven apps. Records live at
// `<dataDir>/<itemId>.json`, one JSON object per file. Writes are
// atomic; deletes are idempotent enough to expose a clear 404 when
// the file is missing.

import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { log } from "../../system/logger/index.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { itemFilePath, safeSlugName } from "./paths.js";
import type { AppItem } from "./types.js";

/** Read every record under `dataDir`. Returns [] if the dir doesn't
 *  exist yet (legitimate first-use state). Malformed JSON files are
 *  logged and skipped so one bad record can't take down the listing. */
export async function listItems(dataDir: string): Promise<AppItem[]> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
  const results: AppItem[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    if (name.startsWith(".")) continue;
    const filePath = `${dataDir}/${name}`;
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        results.push(parsed as AppItem);
      }
    } catch (err) {
      log.warn("apps", "failed to read item, skipping", { path: filePath, error: String(err) });
    }
  }
  return results;
}

/** Read one record by id. Returns null when the file is missing. */
export async function readItem(dataDir: string, itemId: string): Promise<AppItem | null> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return null;
  const filePath = itemFilePath(dataDir, safeId);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AppItem;
    }
    return null;
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return null;
    throw err;
  }
}

export interface WriteItemOptions {
  /** When true (POST/create), refuse to overwrite an existing file
   *  and return `kind: "conflict"`. Update flow (PUT) leaves it false. */
  refuseOverwrite?: boolean;
}

export type WriteItemResult = { kind: "ok"; itemId: string; item: AppItem } | { kind: "invalid-id"; itemId: string } | { kind: "conflict"; itemId: string };

/** Write a record. Ensures the directory exists, validates the id, and
 *  writes atomically. The caller is responsible for shaping `item` —
 *  v0 doesn't validate fields against the schema (the schema language
 *  has no type-enforced constraints yet beyond `required`, which the
 *  UI form enforces client-side). */
export async function writeItem(dataDir: string, itemId: string, item: AppItem, opts: WriteItemOptions = {}): Promise<WriteItemResult> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  const filePath = itemFilePath(dataDir, safeId);

  if (opts.refuseOverwrite) {
    try {
      await stat(filePath);
      return { kind: "conflict", itemId: safeId };
    } catch (err) {
      const error = err as { code?: string };
      if (error.code !== "ENOENT") throw err;
    }
  }

  await mkdir(dataDir, { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(item, null, 2)}\n`);
  return { kind: "ok", itemId: safeId, item };
}

export type DeleteItemResult = { kind: "ok"; itemId: string } | { kind: "invalid-id"; itemId: string } | { kind: "not-found"; itemId: string };

export async function deleteItem(dataDir: string, itemId: string): Promise<DeleteItemResult> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  const filePath = itemFilePath(dataDir, safeId);
  try {
    await unlink(filePath);
    return { kind: "ok", itemId: safeId };
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return { kind: "not-found", itemId: safeId };
    throw err;
  }
}

/** Generate a short random hex id. Used by POST when the form doesn't
 *  carry a primary-key value (UI shortcut — Claude normally derives a
 *  semantic id from the record's name). */
export function generateItemId(): string {
  return randomBytes(4).toString("hex");
}
