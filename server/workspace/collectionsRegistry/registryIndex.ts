// Parse + validate the curated collection registry's published index.json.
// Pure — no I/O. The caller fetches the JSON and hands the parsed value here.
// Mirrors the registry repo's schema/index.schema.json contract (schemaVersion 1):
//   receptron/mulmoclaude-collections.
//
// The index is host-fetched convenience data for the Discover catalog, not a
// trust boundary: a collection's actual files are re-validated on import.

import { isRecord } from "../../utils/types.js";

export interface RegistryCollectionEntry {
  /** `<author>/<slug>` — global identity. */
  id: string;
  author: string;
  slug: string;
  title: string;
  icon: string;
  description: string;
  version: string;
  tags: string[];
  license: string;
  fieldCount: number;
  /** Custom view labels. */
  views: string[];
  hasSeed: boolean;
  seedCount: number;
  /** repo-relative path, omitted when absent. */
  screenshot?: string;
  /** repo-relative collection dir. */
  path: string;
  /** Stable bundle hash for update detection. */
  contentSha: string;
}

export interface RegistryIndex {
  schemaVersion: number;
  generatedAt: string;
  registry: string;
  collections: RegistryCollectionEntry[];
}

export type ParseResult = { ok: true; index: RegistryIndex } | { ok: false; error: string };

const SUPPORTED_SCHEMA_VERSION = 1;

const pickString = (rec: Record<string, unknown>, key: string): string | undefined => {
  const value = rec[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

// Count fields (fieldCount/seedCount) must be non-negative integers. A present
// but negative/fractional value is rejected rather than served to the UI; an
// absent value defaults to 0.
function validatedCount(rec: Record<string, unknown>, key: string): number | "invalid" {
  const value = rec[key];
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : "invalid";
}

const pickBoolean = (rec: Record<string, unknown>, key: string): boolean | undefined => {
  const value = rec[key];
  return typeof value === "boolean" ? value : undefined;
};

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

// Identifier allowlists (mirror the registry's meta.schema.json). Crucially these
// exclude `.`, `/`, `\`, and `..`, so a poisoned author/slug can never make
// collectionFileUrl() escape the collections/<author>/<slug> subtree — even if the
// entry is internally consistent. Bounded quantifiers (no ReDoS).
const AUTHOR_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// author/slug must be allowlisted identifiers, and id/path must agree with them, so a
// lookup by author+slug can never fetch files from a different (or out-of-tree)
// directory than requested (defense against a poisoned index).
function identityError(entryId: string, author: string, slug: string, dirPath: string, index: number): string | null {
  if (!AUTHOR_RE.test(author)) return `collections[${index}].author has an invalid format`;
  if (!SLUG_RE.test(slug)) return `collections[${index}].slug has an invalid format`;
  if (entryId !== `${author}/${slug}`) return `collections[${index}].id must equal "${author}/${slug}"`;
  if (dirPath !== `collections/${author}/${slug}`) return `collections[${index}].path must equal "collections/${author}/${slug}"`;
  return null;
}

function validatedCounts(value: Record<string, unknown>, index: number): { fieldCount: number; seedCount: number } | string {
  const fieldCount = validatedCount(value, "fieldCount");
  const seedCount = validatedCount(value, "seedCount");
  if (fieldCount === "invalid") return `collections[${index}].fieldCount must be a non-negative integer`;
  if (seedCount === "invalid") return `collections[${index}].seedCount must be a non-negative integer`;
  return { fieldCount, seedCount };
}

function parseEntry(value: unknown, index: number): RegistryCollectionEntry | string {
  if (!isRecord(value)) return `collections[${index}] is not an object`;
  const entryId = pickString(value, "id");
  const author = pickString(value, "author");
  const slug = pickString(value, "slug");
  const title = pickString(value, "title");
  const version = pickString(value, "version");
  const path = pickString(value, "path");
  const contentSha = pickString(value, "contentSha");
  if (!entryId || !author || !slug || !title || !version || !path || !contentSha) {
    return `collections[${index}] is missing a required string field (id/author/slug/title/version/path/contentSha)`;
  }
  const mismatch = identityError(entryId, author, slug, path, index);
  if (mismatch) return mismatch;
  const counts = validatedCounts(value, index);
  if (typeof counts === "string") return counts;
  return {
    id: entryId,
    author,
    slug,
    title,
    version,
    path,
    contentSha,
    icon: pickString(value, "icon") ?? "",
    description: pickString(value, "description") ?? "",
    license: pickString(value, "license") ?? "",
    tags: asStringArray(value.tags),
    views: asStringArray(value.views),
    fieldCount: counts.fieldCount,
    seedCount: counts.seedCount,
    hasSeed: pickBoolean(value, "hasSeed") ?? false,
    screenshot: pickString(value, "screenshot"),
  };
}

export function parseRegistryIndex(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: "index is not an object" };
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported schemaVersion (expected ${SUPPORTED_SCHEMA_VERSION})` };
  }
  const registry = pickString(value, "registry");
  const generatedAt = pickString(value, "generatedAt");
  if (!registry || !generatedAt) return { ok: false, error: "index missing registry/generatedAt" };
  if (!Array.isArray(value.collections)) return { ok: false, error: "index.collections must be an array" };

  const parsed = value.collections.map(parseEntry);
  const firstError = parsed.find((entry): entry is string => typeof entry === "string");
  if (firstError !== undefined) return { ok: false, error: firstError };
  const collections = parsed.filter((entry): entry is RegistryCollectionEntry => typeof entry !== "string");
  return { ok: true, index: { schemaVersion: SUPPORTED_SCHEMA_VERSION, registry, generatedAt, collections } };
}
