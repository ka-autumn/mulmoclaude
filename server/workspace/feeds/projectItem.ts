// Project one raw retrieved item (a parsed RSS entry, or a JSON object)
// into a CollectionItem whose keys match the schema's fields, using the
// declarative `ingest.map`. Also derives the record's id.
//
// Id rule: a collection record's filename IS its primaryKey value, and
// that value must be a safe slug. Feed-native keys (RSS guids/URLs,
// ISO datetimes) usually are NOT slug-safe, so we slugify the natural
// key into a deterministic, stable id — same natural key → same id, so
// re-fetches upsert in place. The natural key comes from the mapped
// primaryKey value, then `ingest.idFrom`, then a content hash.

import { createHash } from "node:crypto";
import { getByPath } from "./pathResolver.js";
import type { CollectionItem, CollectionSchema } from "../collections/index.js";
import type { IngestSpec } from "./ingestTypes.js";

function asKeyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Collapse an XML element object that carries body text alongside
 *  attributes (`{ "#text": "v", "@_x": "..." }`) or CDATA to its text.
 *  Generic — the host knows no field names, only this fast-xml-parser
 *  shape — so a tag like `<guid isPermaLink="false">id</guid>` maps to
 *  its text without the caller needing to write `.#text`. */
function unwrapTextNode(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return obj["#text"];
    if (typeof obj["#cdata"] === "string") return obj["#cdata"];
  }
  return value;
}

/** Normalize a mapped value generically — driven by the SCHEMA's declared
 *  field type, never by the source field name. Today: unwrap XML text
 *  nodes, and parse anything mapped into a `date` field to an ISO string
 *  (so a feed's RFC-822 / RFC-3339 timestamp renders as a real date). */
function normalizeValue(value: unknown, fieldType: string | undefined): unknown {
  const unwrapped = unwrapTextNode(value);
  if (fieldType === "date" && typeof unwrapped === "string") {
    const millis = Date.parse(unwrapped);
    if (Number.isFinite(millis)) return new Date(millis).toISOString();
  }
  return unwrapped;
}

/** Slugify a natural key into a stable, filename-safe id. Short, safe
 *  keys pass through (lowercased); long or unsafe keys collapse to a
 *  hash so the filename stays bounded and valid. */
function toSafeId(natural: string): string {
  const collapsed = natural
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  // eslint-disable-next-line sonarjs/slow-regex -- anchored hyphen trim, linear, no catastrophic backtracking
  const slug = collapsed.replace(/^-+|-+$/g, "");
  if (slug.length > 0 && slug.length <= 80) return slug;
  const hash = createHash("sha256")
    .update(natural || "item", "utf-8")
    .digest("hex")
    .slice(0, 16);
  return slug.length > 80 ? `${slug.slice(0, 60)}-${hash}` : `feed-${hash}`;
}

function naturalKey(record: CollectionItem, rawItem: unknown, ingest: IngestSpec, schema: CollectionSchema): string {
  const fromMapped = asKeyString(record[schema.primaryKey]);
  if (fromMapped) return fromMapped;
  if (ingest.idFrom) {
    const fromId = asKeyString(unwrapTextNode(getByPath(rawItem, ingest.idFrom)));
    if (fromId) return fromId;
  }
  return JSON.stringify(record);
}

/** Build a record from a raw fetched item (a parsed RSS/Atom element or a
 *  JSON object) using `ingest.map`. Each source path is resolved against
 *  the raw item and normalized per the target field's declared type. The
 *  returned record's primaryKey is set to the derived safe id (so it
 *  doubles as the filename). */
export function projectRecord(rawItem: unknown, ingest: IngestSpec, schema: CollectionSchema): CollectionItem {
  const record: CollectionItem = {};
  for (const [targetField, sourcePath] of Object.entries(ingest.map)) {
    const value = normalizeValue(getByPath(rawItem, sourcePath), schema.fields?.[targetField]?.type);
    if (value !== undefined) record[targetField] = value;
  }
  record[schema.primaryKey] = toSafeId(naturalKey(record, rawItem, ingest, schema));
  return record;
}
