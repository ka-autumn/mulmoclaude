// Validate a collection's record files and report problems back to the
// authoring LLM. The host SILENTLY skips unparseable records at read time
// (see `listItems`), so without this a single malformed file looks like
// "records vanished." `presentCollection` — which the LLM is told to call
// after every write — runs this and surfaces the problems in its result,
// closing the loop so the model fixes the file instead of a human noticing
// missing rows much later.

import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../workspace.js";
import { isContainedInRoot } from "./paths.js";
import type { LoadedCollection } from "./discovery.js";
import type { CollectionItem, CollectionSchema } from "./types.js";

export interface RecordIssue {
  /** Record filename, e.g. `lesson-003.json`. */
  file: string;
  /** Human-readable problem, written to be actionable by the LLM. */
  problem: string;
}

// Don't flood the result; the first batch is enough to act on.
const MAX_ISSUES = 25;
// derived/embed/toggle are host-computed or projected — never written to
// the record JSON, so required / value checks must not apply to them.
const COMPUTED_TYPES = new Set(["derived", "embed", "toggle"]);

/** Read every `<id>.json` under the collection's dataDir and report the
 *  ones that won't load or violate the schema. An empty list means every
 *  record is fine. */
/** List entries under the data dir, guarding realpath containment (against a
 *  symlinked dir swapped in after discovery, like `listItems`) and treating a
 *  missing dir as empty while surfacing real I/O faults. */
async function listRecordFilenames(dataDir: string, workspaceRoot: string): Promise<string[]> {
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "validate refused: dataDir escapes workspace via symlink", { dataDir });
    return [];
  }
  try {
    return await readdir(dataDir);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return []; // no dir yet = no records
    throw err; // surface permission / I/O faults instead of silently passing
  }
}

export async function validateCollectionRecords(collection: LoadedCollection, opts: { workspaceRoot?: string } = {}): Promise<RecordIssue[]> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const entries = await listRecordFilenames(collection.dataDir, workspaceRoot);
  const issues: RecordIssue[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    if (issues.length >= MAX_ISSUES) break;
    const issue = await inspectRecord(path.join(collection.dataDir, name), name, collection.schema);
    if (issue) issues.push(issue);
  }
  return issues;
}

// Read a record file's text, or classify why it can't be read (missing /
// symlink / unreadable). Split out to keep `inspectRecord` under the line limit.
async function readRecordText(fullPath: string, name: string): Promise<{ raw: string } | RecordIssue> {
  try {
    const stat = await lstat(fullPath);
    if (!stat.isFile()) return { file: name, problem: "not a regular file (symlink?) — skipped, won't appear" };
    return { raw: await readFile(fullPath, "utf-8") };
  } catch {
    return { file: name, problem: "could not be read — skipped, won't appear" };
  }
}

/** Classify a single record file: unreadable / unparseable / non-object /
 *  schema violation, or null when it's fine. */
async function inspectRecord(fullPath: string, name: string, schema: CollectionSchema): Promise<RecordIssue | null> {
  const read = await readRecordText(fullPath, name);
  if ("problem" in read) return read;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      file: name,
      problem: `invalid JSON (${reason}) — SKIPPED, won't appear. Usual cause: an unescaped " inside a string value; use 「」/『』 or write \\" instead.`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { file: name, problem: "not a JSON object — skipped, won't appear" };
  }
  return schemaViolation(parsed as CollectionItem, name, schema);
}

/** First schema problem on a parseable record (id↔filename, missing
 *  required, bad enum value), or null. One issue per record keeps the
 *  report short and the fix obvious. */
function schemaViolation(record: CollectionItem, name: string, schema: CollectionSchema): RecordIssue | null {
  const stem = name.replace(/\.json$/, "");
  const idValue = record[schema.primaryKey];
  if (typeof idValue !== "string" || idValue !== stem) {
    return {
      file: name,
      problem: `'${schema.primaryKey}' is '${String(idValue ?? "")}' but must equal the filename ('${stem}'), or the record can't be opened`,
    };
  }
  for (const [field, spec] of Object.entries(schema.fields)) {
    if (COMPUTED_TYPES.has(spec.type)) continue;
    const value = record[field];
    const empty = value === undefined || value === null || value === "";
    if (spec.required && empty) return { file: name, problem: `missing required field '${field}'` };
    if (!empty && spec.type === "enum" && spec.values && !spec.values.includes(String(value))) {
      return { file: name, problem: `'${field}' = '${String(value)}' is not one of [${spec.values.join(", ")}]` };
    }
  }
  return null;
}
