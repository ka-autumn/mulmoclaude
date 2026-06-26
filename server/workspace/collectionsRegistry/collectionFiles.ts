// Fetch individual files of a registry collection (schema.json, meta.json, …)
// from the registry repo's raw content. The collection's repo-relative dir comes
// from a trusted index entry (never raw user input), so the host can only fetch
// files of collections that actually appear in the published index.
//
// The index itself is served from GitHub Pages (see client.ts); per-collection
// files are served from raw.githubusercontent. Both are overridable for tests /
// self-hosting.

import { fetchWithTimeout } from "../../utils/fetch.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { fetchRegistryIndex } from "./client.js";
import type { RegistryCollectionEntry } from "./registryIndex.js";

const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/receptron/mulmoclaude-collections/main";
const FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;
const STATUS_NOT_FOUND = 404;

export function rawBaseUrl(): string {
  return process.env.COLLECTIONS_REGISTRY_RAW_BASE ?? DEFAULT_RAW_BASE;
}

/** Compose the raw URL for `<dirPath>/<relFile>`. `dirPath` is an index entry's
 *  repo-relative collection dir (e.g. `collections/isamu/movies`). Empty and
 *  traversal (`.`/`..`) segments are dropped so the URL can never escape the base,
 *  even if an upstream check is bypassed (the index parser already rejects such
 *  identifiers — this is defense-in-depth). */
export function collectionFileUrl(dirPath: string, relFile: string): string {
  const segments = dirPath.split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return `${rawBaseUrl()}/${segments.join("/")}/${relFile}`;
}

export type FileResult = { ok: true; text: string } | { ok: false; status: number; error: string };

export async function fetchCollectionFile(dirPath: string, relFile: string): Promise<FileResult> {
  const url = collectionFileUrl(dirPath, relFile);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, status: STATUS_UNAVAILABLE, error: `fetch failed: ${errorMessage(err)}` };
  }
  if (!res.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: `${relFile} responded ${res.status}` };
  return { ok: true, text: await res.text() };
}

export type JsonObjectResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function parseJsonObject(text: string, label: string): JsonObjectResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `${label} is not valid JSON` };
  }
  if (!isRecord(parsed)) return { ok: false, error: `${label} is not an object` };
  return { ok: true, value: parsed };
}

async function fetchJsonObject(
  dirPath: string,
  relFile: string,
  label: string,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const file = await fetchCollectionFile(dirPath, relFile);
  if (!file.ok) return { ok: false, status: file.status, error: `${label}: ${file.error}` };
  const parsed = parseJsonObject(file.text, label);
  if (!parsed.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: parsed.error };
  return { ok: true, value: parsed.value };
}

export type PreviewResult =
  | { ok: true; entry: RegistryCollectionEntry; schema: Record<string, unknown>; meta: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Preview a registry collection: confirm it's in the published index, then fetch
 *  and parse its schema.json + meta.json so the Discover tab can show fields/views
 *  before import. Read-only; full structural re-validation happens at import. */
export async function previewCollection(author: string, slug: string): Promise<PreviewResult> {
  const indexResult = await fetchRegistryIndex();
  if (!indexResult.ok) return { ok: false, status: indexResult.status, error: indexResult.error };
  const entry = indexResult.index.collections.find((candidate) => candidate.author === author && candidate.slug === slug);
  if (!entry) return { ok: false, status: STATUS_NOT_FOUND, error: `unknown collection: ${author}/${slug}` };
  const schema = await fetchJsonObject(entry.path, "schema.json", "schema.json");
  if (!schema.ok) return schema;
  const meta = await fetchJsonObject(entry.path, "meta.json", "meta.json");
  if (!meta.ok) return meta;
  return { ok: true, entry, schema: schema.value, meta: meta.value };
}
