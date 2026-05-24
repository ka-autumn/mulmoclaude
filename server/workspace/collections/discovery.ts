// Discover schema-driven collections. A "collection" is a skill
// directory that ships a `schema.json` alongside its `SKILL.md`.
// Scans both user (`~/.claude/skills/`) and project
// (`<workspace>/.claude/skills/`) scopes; project wins on slug
// collision (mirrors the rule in
// `server/workspace/skills/discovery.ts`).

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../workspace.js";
import { USER_SKILLS_DIR, projectSkillsDir } from "../skills/paths.js";
import { SCHEMA_FILE, resolveDataDir, safeSlugName } from "./paths.js";
import type { CollectionDetail, CollectionSchema, CollectionSource, CollectionSummary } from "./types.js";

const FieldSpecSchema = z
  .object({
    type: z.enum(["string", "text", "email", "number", "date", "boolean", "markdown", "ref"]),
    label: z.string().min(1),
    primary: z.boolean().optional(),
    required: z.boolean().optional(),
    /** Target collection slug, required iff type === "ref". The
     *  refine below enforces the cross-field rule (Zod has no
     *  first-class discriminated union for this shape; refine is
     *  the standard escape hatch). */
    to: z.string().min(1).optional(),
  })
  .refine(
    (spec) => {
      if (spec.type !== "ref") return true;
      // Cross-field constraint: a `ref` field MUST declare a `to`,
      // AND that `to` must be a valid slug. Non-slug values like
      // `../foo` or `mc-clients/extra` would otherwise produce
      // malformed `/collections/${field.to}` router targets and
      // behavior-mismatched API fetches (the fetch URI-encodes
      // each segment but the router-link interpolates raw —
      // Codex P2 review on PR #1495). Same shape we enforce on
      // collection slugs themselves via `safeSlugName`.
      if (typeof spec.to !== "string") return false;
      return safeSlugName(spec.to) !== null;
    },
    {
      message: "fields with type 'ref' must declare a `to` that is a valid collection slug (alphanumeric / hyphen / underscore, no path separators)",
      path: ["to"],
    },
  );

const CollectionSchemaZ = z.object({
  title: z.string().min(1),
  icon: z.string().min(1),
  dataPath: z.string().min(1),
  primaryKey: z.string().min(1),
  fields: z.record(z.string(), FieldSpecSchema),
});

interface LoadedCollection {
  slug: string;
  source: CollectionSource;
  schema: CollectionSchema;
  /** Absolute path to the resolved dataPath directory (inside the
   *  workspace). May not exist yet — the data folder is created on
   *  first write. */
  dataDir: string;
}

async function loadOneCollection(skillsRoot: string, slug: string, source: CollectionSource, workspaceRoot: string): Promise<LoadedCollection | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const schemaPath = path.join(skillsRoot, safeName, SCHEMA_FILE);
  let raw: string;
  try {
    const fileStat = await stat(schemaPath);
    if (!fileStat.isFile()) return null;
    raw = await readFile(schemaPath, "utf-8");
  } catch (err) {
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
      log.warn("collections", "failed to read schema.json, skipping", { slug: safeName, path: schemaPath, error: String(err) });
    }
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn("collections", "schema.json is not valid JSON, skipping", { slug: safeName, error: String(err) });
    return null;
  }

  const parsed = CollectionSchemaZ.safeParse(parsedJson);
  if (!parsed.success) {
    log.warn("collections", "schema.json failed validation, skipping", { slug: safeName, issues: parsed.error.issues });
    return null;
  }

  // Verify the primary key is one of the declared fields AND is
  // flagged `primary: true`. Without the flag the CollectionView
  // would render the field as editable (its disabled-on-edit check
  // is `field.primary === true`), the user's rename would silently
  // be pinned back to the URL itemId on save, and they'd never know
  // the edit was dropped. Reject the schema up front rather than
  // ship that UX.
  const schema = parsed.data;
  const primaryField = schema.fields[schema.primaryKey];
  if (!primaryField) {
    log.warn("collections", "schema.json primaryKey not found in fields, skipping", { slug: safeName, primaryKey: schema.primaryKey });
    return null;
  }
  if (primaryField.primary !== true) {
    log.warn("collections", "schema.json primaryKey field is not flagged primary: true, skipping", { slug: safeName, primaryKey: schema.primaryKey });
    return null;
  }

  const dataDir = resolveDataDir(schema.dataPath, workspaceRoot);
  if (dataDir === null) {
    log.warn("collections", "schema.json dataPath escapes workspace, skipping", { slug: safeName, dataPath: schema.dataPath, workspaceRoot });
    return null;
  }

  return { slug: safeName, source, schema, dataDir };
}

async function collectFromDir(skillsRoot: string, source: CollectionSource, workspaceRoot: string): Promise<LoadedCollection[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    log.warn("collections", "failed to list skills dir, returning empty", { root: skillsRoot, error: String(err) });
    return [];
  }

  const results: LoadedCollection[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const safeName = safeSlugName(name);
    if (safeName === null) continue;
    const dirPath = path.join(skillsRoot, safeName);
    let dirStat;
    try {
      dirStat = await stat(dirPath);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const collection = await loadOneCollection(skillsRoot, safeName, source, workspaceRoot);
    if (collection) results.push(collection);
  }
  return results;
}

export interface DiscoveryOptions {
  /** Override the workspace root for project-scope skill discovery.
   *  Default: the live `workspacePath`. Tests point this at a
   *  `mkdtempSync` tree so they don't touch the user's real
   *  `~/mulmoclaude/`. Mirrors the pattern in
   *  `server/workspace/skills/catalog.ts#CatalogOptions`. */
  workspaceRoot?: string;
  /** Override `~/.claude/skills/` for tests. Production callers
   *  leave this unset. Without an override, even a test-scoped
   *  workspaceRoot still scans the real user home — which can leak
   *  unrelated skills into the result. */
  userSkillsDir?: string;
}

/** Discover every schema-driven collection available to this
 *  workspace. Project-scope collections override user-scope on slug
 *  collision. The `workspaceRoot` override also flows into each
 *  collection's dataDir resolution so a tmpdir-scoped test gets
 *  dataDirs under the same tmpdir (Codex P1 review on PR #1489 —
 *  previously dataDir was always rooted at the live workspacePath
 *  regardless of override). */
export async function discoverCollections(opts: DiscoveryOptions = {}): Promise<LoadedCollection[]> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const userDir = opts.userSkillsDir ?? USER_SKILLS_DIR;
  const projectDir = projectSkillsDir(workspaceRoot);
  const userCollections = await collectFromDir(userDir, "user", workspaceRoot);
  const projectCollections = await collectFromDir(projectDir, "project", workspaceRoot);
  const merged = new Map<string, LoadedCollection>();
  for (const entry of userCollections) merged.set(entry.slug, entry);
  for (const entry of projectCollections) merged.set(entry.slug, entry);
  return [...merged.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

/** Load one collection by slug. Returns null if the slug is invalid,
 *  no matching skill exists, or the schema is malformed. */
export async function loadCollection(slug: string, opts: DiscoveryOptions = {}): Promise<LoadedCollection | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const userDir = opts.userSkillsDir ?? USER_SKILLS_DIR;
  const projectDir = projectSkillsDir(workspaceRoot);
  // Project first (overrides user).
  const projectCollection = await loadOneCollection(projectDir, safeName, "project", workspaceRoot);
  if (projectCollection) return projectCollection;
  return loadOneCollection(userDir, safeName, "user", workspaceRoot);
}

export function toSummary(collection: LoadedCollection): CollectionSummary {
  return { slug: collection.slug, title: collection.schema.title, icon: collection.schema.icon, source: collection.source };
}

export function toDetail(collection: LoadedCollection): CollectionDetail {
  return { ...toSummary(collection), schema: collection.schema };
}

export type { LoadedCollection };
