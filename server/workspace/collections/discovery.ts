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

// Cross-field refines, factored out so they can apply at both the
// top-level FieldSpec and the table-row SubFieldSpec without prose
// duplication.
//
// Why two schemas: a `table` field's `of` sub-fields must NOT
// themselves be `table` or `derived` (would explode the form editor
// + formula evaluator into territory v0 doesn't need). The cleanest
// way to encode that in Zod is a separate `SubFieldSpecSchema`
// whose `type` enum simply omits those two values.
const refRefine = (spec: { type: string; to?: string }): boolean => {
  if (spec.type !== "ref") return true;
  // `ref` must declare `to` AND `to` must be a real slug (not
  // `../foo`, not `mc-clients/extra` — see Codex P2 on PR #1495).
  if (typeof spec.to !== "string") return false;
  return safeSlugName(spec.to) !== null;
};
const refMessage = {
  message: "fields with type 'ref' must declare a `to` that is a valid collection slug (alphanumeric / hyphen / underscore, no path separators)",
  path: ["to"],
};

// `embed` pulls a fixed record from another collection into the
// read-only detail view. It must declare a valid `to` slug (same
// path-traversal guard as `ref`) AND a non-empty `id` naming the
// fixed record's primary key (e.g. `me` for the singleton profile).
const embedRefine = (spec: { type: string; to?: string; id?: string }): boolean => {
  if (spec.type !== "embed") return true;
  if (typeof spec.to !== "string" || safeSlugName(spec.to) === null) return false;
  return typeof spec.id === "string" && spec.id.trim().length > 0;
};
const embedMessage = {
  message: "fields with type 'embed' must declare a `to` (valid collection slug) and a non-empty `id` (the fixed record's primary key)",
  path: ["id"],
};

const enumRefine = (spec: { type: string; values?: readonly string[] }): boolean =>
  spec.type !== "enum" || (Array.isArray(spec.values) && spec.values.length > 0 && spec.values.every((value) => typeof value === "string" && value.length > 0));
const enumMessage = {
  message: "fields with type 'enum' must declare a non-empty `values` array of non-empty strings",
  path: ["values"],
};

// A field that renders as money must declare where its currency comes
// from — otherwise the formatter silently falls back to USD and
// mislabels non-USD amounts. Two ways to satisfy it: a literal
// `currency` (fixed for every record) or a `currencyField` naming a
// sibling record field that holds the ISO code (per-record, e.g. an
// invoice's `currency` enum). At least one is required. Covers `money`
// fields and `derived` fields displayed as money (subtotal / tax /
// total). Sub-fields can't be `derived`, so there it's just money.
const currencyRefine = (spec: { type: string; display?: string; currency?: string; currencyField?: string }): boolean => {
  const rendersMoney = spec.type === "money" || (spec.type === "derived" && spec.display === "money");
  if (!rendersMoney) return true;
  const hasLiteral = typeof spec.currency === "string" && spec.currency.trim().length > 0;
  const hasPointer = typeof spec.currencyField === "string" && spec.currencyField.trim().length > 0;
  return hasLiteral || hasPointer;
};
const currencyMessage = {
  message:
    "fields that render as money (type 'money', or 'derived' with display 'money') must declare either a literal `currency` (ISO 4217 code, e.g. 'USD', 'JPY') or a `currencyField` naming the record field that holds the code",
  path: ["currency"],
};

// Sub-fields inside a `table.of` map: the regular field types
// minus `table` (no nested tables) and `derived` (no computed
// columns inside a table — would need the evaluator to walk the
// row context, defer until a real need surfaces).
const SubFieldSpecSchema = z
  .object({
    type: z.enum(["string", "text", "email", "number", "date", "boolean", "markdown", "ref", "money", "enum"]),
    label: z.string().min(1),
    required: z.boolean().optional(),
    to: z.string().min(1).optional(),
    // `trim().min(1)` rather than bare `min(1)` so a whitespace-
    // only string ("   ") fails validation — otherwise the cell
    // formatter / dropdown would render visual blanks that look
    // like missing data. Applied consistently to every "non-empty
    // string" slot in the schema (CodeRabbit PR #1497).
    currency: z.string().trim().min(1).optional(),
    currencyField: z.string().trim().min(1).optional(),
    values: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .refine(refRefine, refMessage)
  .refine(enumRefine, enumMessage)
  .refine(currencyRefine, currencyMessage);

const FieldSpecSchema = z
  .object({
    type: z.enum(["string", "text", "email", "number", "date", "boolean", "markdown", "ref", "money", "enum", "table", "derived", "embed"]),
    label: z.string().min(1),
    primary: z.boolean().optional(),
    required: z.boolean().optional(),
    to: z.string().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    currency: z.string().trim().min(1).optional(),
    currencyField: z.string().trim().min(1).optional(),
    values: z.array(z.string().trim().min(1)).min(1).optional(),
    of: z.record(z.string(), SubFieldSpecSchema).optional(),
    formula: z.string().trim().min(1).optional(),
    /** Inner type to render a derived value as (e.g. `"money"`).
     *  Restricted to the non-composite display targets — derived
     *  values are scalars, so rendering them via `table` or another
     *  `derived` would be meaningless. */
    display: z.enum(["string", "number", "money", "date"]).optional(),
  })
  .refine(refRefine, refMessage)
  .refine(enumRefine, enumMessage)
  .refine(embedRefine, embedMessage)
  .refine(currencyRefine, currencyMessage)
  .refine((spec) => spec.type !== "table" || (spec.of !== undefined && Object.keys(spec.of).length > 0), {
    message: "fields with type 'table' must declare a non-empty `of` (sub-schema for each row)",
    path: ["of"],
  })
  .refine((spec) => spec.type !== "derived" || (typeof spec.formula === "string" && spec.formula.length > 0), {
    message: "fields with type 'derived' must declare a non-empty `formula` (see src/utils/collections/derivedFormula.ts)",
    path: ["formula"],
  });

// An action's `template` becomes a file read under the skill dir, so
// reject traversal up front: each `/`-separated segment must be a plain
// safe name, no `..`, no backslash, not absolute. The reader's realpath
// containment is the hard guarantee; this fails a bad schema fast.
function isSafeTemplatePath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/")) return false;
  return value.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && /^[A-Za-z0-9._-]+$/.test(seg));
}

// Optional visibility predicate: the action button shows only when the
// open record's `field` (stringified) is one of `in`. Domain-free —
// `field` is any non-empty key, `in` a non-empty array of non-empty
// values; the host never interprets the meaning.
const ActionWhenSchema = z.object({
  field: z.string().trim().min(1),
  in: z.array(z.string().trim().min(1)).min(1),
});

// A schema-declared record action. Domain-free: the host validates the
// shape; the meaning (which role, which template) is data.
const ActionSpecSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
  kind: z.enum(["chat"]),
  role: z.string().trim().min(1),
  template: z.string().trim().min(1).refine(isSafeTemplatePath, "must be a safe skill-relative path (no `..`, no leading `/`, no backslash)"),
  when: ActionWhenSchema.optional(),
});

// Field types that can hold a currency code string. A `currencyField`
// pointer must resolve to one of these — pointing at a number / boolean
// / table would never yield a usable ISO code.
const CODE_FIELD_TYPES = new Set(["string", "text", "enum"]);

interface FieldLike {
  type: string;
  currencyField?: string;
  of?: Record<string, { currencyField?: string }>;
}

// Every `currencyField` declared anywhere in the schema — top-level
// fields and a table's `of` sub-fields. Sub-field money cells resolve
// currency against the TOP-LEVEL record (rows carry no currency), so
// their pointers are validated against the top-level field set too.
function collectCurrencyFieldRefs(fields: Record<string, FieldLike>): string[] {
  const refs: string[] = [];
  for (const field of Object.values(fields)) {
    if (typeof field.currencyField === "string" && field.currencyField.length > 0) refs.push(field.currencyField);
    if (field.of) {
      for (const sub of Object.values(field.of)) {
        if (typeof sub.currencyField === "string" && sub.currencyField.length > 0) refs.push(sub.currencyField);
      }
    }
  }
  return refs;
}

const CollectionSchemaZ = z
  .object({
    title: z.string().min(1),
    icon: z.string().min(1),
    dataPath: z.string().min(1),
    primaryKey: z.string().min(1),
    // When set, the collection holds at most one record whose primary
    // key is this exact value (e.g. `me` for the business profile).
    // The host fixes the create form's primary key to it and hides the
    // Add button once the record exists.
    singleton: z.string().trim().min(1).optional(),
    fields: z.record(z.string(), FieldSpecSchema),
    actions: z.array(ActionSpecSchema).optional(),
  })
  // The singleton value becomes a record id (and thus a `<id>.json`
  // filename), so it must satisfy the SAME `safeSlugName` rule the
  // write path enforces — otherwise the create form would lock the
  // primary key to a value the POST route then rejects as an invalid
  // item id, making the collection impossible to initialize (Codex P1).
  .refine((schema) => schema.singleton === undefined || safeSlugName(schema.singleton) !== null, {
    message: "schema `singleton` must be a valid item id (alphanumeric / hyphen / underscore, no path separators)",
    path: ["singleton"],
  })
  // Action ids must be unique so the dispatch route resolves
  // unambiguously.
  .refine((schema) => schema.actions === undefined || new Set(schema.actions.map((action) => action.id)).size === schema.actions.length, {
    message: "schema `actions` must have unique `id`s",
    path: ["actions"],
  })
  // A `currencyField` pointer must name a real top-level field that
  // holds a code string — a typo (`curreny`) would otherwise pass the
  // per-field check, then silently fall back to the literal / USD at
  // render and mislabel amounts. Checked at the schema level because a
  // field can't see its siblings.
  .refine((schema) => collectCurrencyFieldRefs(schema.fields).every((name) => CODE_FIELD_TYPES.has(schema.fields[name]?.type ?? "")), {
    message: "a money field's `currencyField` must name a top-level `string`, `text`, or `enum` field that holds the currency code",
    path: ["fields"],
  });

interface LoadedCollection {
  slug: string;
  source: CollectionSource;
  schema: CollectionSchema;
  /** Absolute path to the resolved dataPath directory (inside the
   *  workspace). May not exist yet — the data folder is created on
   *  first write. */
  dataDir: string;
  /** Absolute path to the skill directory this collection was loaded
   *  from (`<skillsRoot>/<slug>/`). Action templates are read from
   *  here, path-safely. */
  skillDir: string;
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

  return { slug: safeName, source, schema, dataDir, skillDir: path.join(skillsRoot, safeName) };
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
