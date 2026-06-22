// `manageCollection` is the agent's data plane for schema-driven
// collections — the paved road over the same record files that raw
// Read/Write/Edit reach (the workspace stays the database; this tool is
// a convenience + gate, not a second store):
//
//   - getItems: records WITH the host-computed fields the stored JSON
//     never contains — `derived` formulas evaluated (cross-collection
//     derefs included), `toggle` projected, `embed` resolved — i.e. the
//     same numbers the user sees rendered. One call instead of N file
//     Reads plus a mental join.
//   - putItems: rows validated against the schema BEFORE the write
//     (primaryKey↔id, required fields, enum membership, no computed
//     keys), written atomically, with per-row accept/reject results the
//     model can fix and retry — instead of writing a broken file and
//     meeting it later in the presentCollection repair loop.
//
// It is also the paved road for a collection's STRUCTURE — so an edit
// gets the same authoring reference + validation a create does:
//
//   - schemaDocs: the collection-authoring reference (`collection-skills.md`)
//     delivered as a method, so the agent never needs to know the help
//     file's path or that it exists — the gap that made schema EDITS fail
//     (create-time prompts point at the doc; edit-time had no pointer).
//   - getSchema / putSchema: read the raw schema.json, and validate it
//     against `CollectionSchemaZ` BEFORE writing the canonical staging
//     copy + mirroring it active (an internal write skips the skill-bridge
//     hook, so the mirror is explicit). Edit-only; creation stays the
//     normal "write SKILL.md + schema.json under data/skills/" flow.
//
// Like `spawnBackgroundChat`, the workspace lookups are injected so the
// unit test can point everything at a tmpdir workspace; the production
// singleton binds the live modules with default (real-workspace) opts.

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  COMPUTED_TYPES,
  CollectionSchemaZ,
  resolveDataDir,
  enrichItems,
  listItems,
  loadCollection,
  readItem,
  resolveCreateItemId,
  validateCollectionRecords,
  validateRecordObject,
  writeItem,
} from "../../workspace/collections/index.js";
import type { CollectionItem, CollectionSchema, LoadedCollection } from "../../workspace/collections/index.js";
import type { DiscoveryOptions } from "@mulmoclaude/collection-plugin/server";
import { defangForPrompt } from "@mulmoclaude/collection-plugin";
import { dataSkillDir, mirrorSkillWrite } from "@mulmoclaude/skill-bridge";
import { helpsAssetDir, isPresetSlug } from "@mulmoclaude/workspace-setup";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";

/** Refuse an unselective getItems beyond this many records — a silent
 *  truncation would read as "covered everything", and an unbounded dump
 *  of a large collection is a token bomb. `ids` or `fields` lifts it. */
export const MAX_UNSELECTIVE_ITEMS = 200;

/** schema.json basename under a skill dir (canonical staging + active mirror). */
const SCHEMA_FILE = "schema.json";
/** The collection-authoring reference, served by the `schemaDocs` action. */
const SCHEMA_DOCS_FILE = "collection-skills.md";
/** Cap the rejected-schema issue list so a deeply-broken schema can't flood the result. */
export const MAX_SCHEMA_ISSUES = 20;

/** Workspace-targeting overrides, threaded to every collections call.
 *  Production: `{}` (live workspace). Tests: a tmpdir + empty user
 *  skills dir. `refreshAfterWrite` is the best-effort UI-refresh fired
 *  after a `putSchema` write (default: the same refreshers
 *  `/api/config/refresh` wraps); tests inject a no-op so they never
 *  touch the real workspace. */
export type ManageCollectionDeps = DiscoveryOptions & { refreshAfterWrite?: () => Promise<void> };

/** Resolve the workspace root the same way every collections call does:
 *  the injected override (tests) or the live workspace path (prod). */
function resolveBase(deps: ManageCollectionDeps): string {
  return deps.workspaceRoot ?? workspacePath;
}

/** Shared "unknown collection" message — its schema.json is missing or
 *  failed validation, so discovery skipped it. */
function unknownCollection(slug: string): string {
  return `manageCollection: unknown collection '${defangForPrompt(slug)}' — its schema.json is missing or failed validation.`;
}

interface GetItemsArgs {
  slug: string;
  ids?: string[];
  fields?: string[];
}

type PutMode = "upsert" | "create" | "merge";

interface PutItemsArgs {
  slug: string;
  items: CollectionItem[];
  mode: PutMode;
}

function optionalStringArray(value: unknown, name: string): { ok: true; value?: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    return { ok: false, error: `manageCollection: \`${name}\` must be an array of non-empty strings when present.` };
  }
  return { ok: true, value: value as string[] };
}

/** Project a record down to the requested fields. The primary key is
 *  always kept so every returned record stays addressable for a
 *  follow-up getItems/putItems. */
function projectFields(record: CollectionItem, fields: string[], primaryKey: string): CollectionItem {
  const keys = fields.includes(primaryKey) ? fields : [primaryKey, ...fields];
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

/** The validation warning appended to a getItems result when stored
 *  record files are malformed (they're silently skipped at read time,
 *  so without this they'd just look missing). Issue strings quote
 *  record-controlled text → defanged, mirroring the presentCollection
 *  dispatch. The record VALUES in `items` ride verbatim, like a raw
 *  file Read — only host-composed report strings are defanged. */
async function recordIssuesWarning(collection: LoadedCollection, deps: ManageCollectionDeps): Promise<string | undefined> {
  const issues = await validateCollectionRecords(collection, { workspaceRoot: deps.workspaceRoot });
  if (issues.length === 0) return undefined;
  const lines = issues.map((issue) => `- ${defangForPrompt(issue.file)}: ${defangForPrompt(issue.problem)}`).join("\n");
  return `${issues.length} record file(s) have data problems and are missing from this result. Fix each (Read → correct → Write):\n${lines}`;
}

async function loadRequestedItems(
  collection: LoadedCollection,
  ids: string[] | undefined,
  deps: ManageCollectionDeps,
): Promise<{ items: CollectionItem[]; missing: string[] }> {
  if (!ids) return { items: await listItems(collection.dataDir, { workspaceRoot: deps.workspaceRoot }), missing: [] };
  const items: CollectionItem[] = [];
  const missing: string[] = [];
  for (const recordId of ids) {
    // readItem THROWS on a malformed record file (only ENOENT is null) —
    // for the tool that's a `missing` entry, not a failed call: the
    // warning scan that runs whenever something is missing then names
    // the broken file and how to fix it.
    const item = await readItem(collection.dataDir, recordId, { workspaceRoot: deps.workspaceRoot }).catch(() => null);
    if (item) items.push(item);
    else missing.push(recordId);
  }
  return { items, missing };
}

async function handleGetItems(collection: LoadedCollection, args: GetItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  const { items, missing } = await loadRequestedItems(collection, args.ids, deps);
  if (!args.ids && !args.fields && items.length > MAX_UNSELECTIVE_ITEMS) {
    return `manageCollection: refused — '${collection.slug}' has ${items.length} records, over the unselective limit of ${MAX_UNSELECTIVE_ITEMS}. Pass \`ids\` for specific records or \`fields\` to project only the columns you need.`;
  }
  const enriched = await enrichItems(collection, items, deps);
  const projected = args.fields ? enriched.map((item) => projectFields(item, args.fields as string[], collection.schema.primaryKey)) : enriched;
  // The warning scan reads every record file, so don't pay it on a
  // selective read that found everything it asked for — only a full
  // listing (where a malformed file silently looks absent) or a missing
  // requested id (where the scan explains WHY it's missing) needs it.
  const warning = !args.ids || missing.length > 0 ? await recordIssuesWarning(collection, deps) : undefined;
  return JSON.stringify({
    collection: collection.slug,
    count: projected.length,
    items: projected,
    ...(missing.length > 0 ? { missing: missing.map((recordId) => defangForPrompt(recordId)) } : {}),
    ...(warning ? { warning } : {}),
  });
}

/** Reject writes that set host-computed keys, with a pointer at the
 *  writable source of truth (the toggle's enum) where one exists. */
function computedKeyProblem(record: CollectionItem, schema: CollectionSchema): string | null {
  for (const key of Object.keys(record)) {
    const spec = schema.fields[key];
    if (!spec || !COMPUTED_TYPES.has(spec.type)) continue;
    if (spec.type === "toggle" && spec.field) return `'${key}' is a toggle projection — write the enum field '${spec.field}' instead`;
    return `'${key}' is ${spec.type === "derived" ? "derived" : "an embed"} — computed by the host, remove it from the record`;
  }
  return null;
}

interface RejectedRow {
  id: string;
  problem: string;
}

/** `mode: "merge"` resolves the row against the EXISTING record —
 *  a partial row updates just the fields it carries, instead of a
 *  whole-record upsert silently erasing the optional fields it omits
 *  (an upsert of `{id, status}` would pass validation yet drop
 *  `notes`/`lesson`/…). Merge is a partial UPDATE by definition, so a
 *  missing record is a reject, not an implicit create — a merged-over-
 *  nothing partial record is exactly the data shape this mode exists
 *  to prevent.
 *
 *  Computed keys found in the STORED record are stripped before the
 *  merge: the caller's own row was already computed-key-rejected, but a
 *  raw-written / legacy record can carry a stale `derived`/`embed`/
 *  `toggle` value, and re-writing it would perpetuate a forged
 *  host-computed value. A merge heals the record instead. */
async function mergeWithExisting(
  collection: LoadedCollection,
  record: CollectionItem,
  itemId: string,
  deps: ManageCollectionDeps,
): Promise<CollectionItem | string> {
  const existing = await readItem(collection.dataDir, itemId, { workspaceRoot: deps.workspaceRoot });
  if (!existing) return `'${itemId}' not found — mode "merge" updates an existing record; use "upsert" or "create" to add it`;
  const stored = Object.entries(existing).filter(([key]) => !COMPUTED_TYPES.has(collection.schema.fields[key]?.type ?? ""));
  return { ...Object.fromEntries(stored), ...record };
}

async function putOneItem(
  collection: LoadedCollection,
  record: CollectionItem,
  mode: PutMode,
  deps: ManageCollectionDeps,
): Promise<{ written?: string; rejected?: RejectedRow }> {
  const { schema } = collection;
  const itemId = resolveCreateItemId(schema, record);
  const reject = (about: string, problem: string): { rejected: RejectedRow } => ({
    rejected: { id: defangForPrompt(about), problem: defangForPrompt(problem) },
  });
  if (itemId === null) return reject("(no id)", `record has no '${schema.primaryKey}' value — set it (it doubles as the filename)`);
  const computed = computedKeyProblem(record, schema);
  if (computed) return reject(itemId, computed);
  let toWrite = record;
  if (mode === "merge") {
    const merged = await mergeWithExisting(collection, record, itemId, deps);
    if (typeof merged === "string") return reject(itemId, merged);
    toWrite = merged;
  }
  const invalid = validateRecordObject(toWrite, itemId, schema);
  if (invalid) return reject(itemId, invalid);
  const result = await writeItem(collection.dataDir, itemId, toWrite, { refuseOverwrite: mode === "create", workspaceRoot: deps.workspaceRoot });
  if (result.kind === "ok") return { written: result.itemId };
  if (result.kind === "invalid-id")
    return reject(itemId, `'${itemId}' is not a valid record id (letters/digits at the ends; -, _, or . inside; no '..' or path characters)`);
  if (result.kind === "conflict") return reject(itemId, `'${itemId}' already exists — mode "create" refuses overwrite; use "upsert" to update it`);
  return reject(itemId, "write refused: the collection's data dir escapes the workspace");
}

async function handlePutItems(collection: LoadedCollection, args: PutItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  const written: string[] = [];
  const rejected: RejectedRow[] = [];
  for (const record of args.items) {
    const outcome = await putOneItem(collection, record, args.mode, deps);
    if (outcome.written) written.push(outcome.written);
    if (outcome.rejected) rejected.push(outcome.rejected);
  }
  return JSON.stringify({ collection: collection.slug, written, rejected });
}

function parsePutItems(args: Record<string, unknown>, slug: string): PutItemsArgs | string {
  const { items, mode } = args;
  const validItems = Array.isArray(items) && items.length > 0 && items.every((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  if (!validItems) return "manageCollection: `items` is required for putItems — a non-empty array of record objects.";
  if (mode !== undefined && mode !== "upsert" && mode !== "create" && mode !== "merge") {
    return 'manageCollection: `mode` must be "upsert" (default), "create", or "merge".';
  }
  return { slug, items: items as CollectionItem[], mode: (mode as PutItemsArgs["mode"] | undefined) ?? "upsert" };
}

/** Return the collection-authoring reference (`collection-skills.md`).
 *  Workspace copy first (reflects user edits), bundled asset as the
 *  always-present fallback. Both reads guarded; if neither resolves the
 *  agent still gets an actionable message instead of a thrown call. */
async function handleSchemaDocs(deps: ManageCollectionDeps): Promise<string> {
  const candidates = [path.join(resolveBase(deps), WORKSPACE_DIRS.helps, SCHEMA_DOCS_FILE), path.join(helpsAssetDir(), SCHEMA_DOCS_FILE)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // try the next source
    }
  }
  return `manageCollection: could not read the collection-authoring reference (${SCHEMA_DOCS_FILE}).`;
}

/** Return the raw schema.json of an existing collection, for editing.
 *  Staging (the canonical writable copy) first, the active mirror as a
 *  fallback for user-scope skills that have no staging copy. Raw text —
 *  not the parsed schema — so the agent edits the true on-disk source. */
async function handleGetSchema(slug: string, deps: ManageCollectionDeps): Promise<string> {
  const collection = await loadCollection(slug, deps);
  if (!collection) return unknownCollection(slug);
  // Path from the discovered (sanitized) slug, never the raw arg.
  const candidates = [path.join(dataSkillDir(resolveBase(deps), collection.slug), SCHEMA_FILE), path.join(collection.skillDir, SCHEMA_FILE)];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // fall through to the next location
    }
  }
  return `manageCollection: '${defangForPrompt(slug)}' has no readable ${SCHEMA_FILE}.`;
}

/** Refuse a schema edit the host can't honour: user-scope/feed collections
 *  are read-only, and presets (mc-*) re-seed on restart so an edit is lost. */
function schemaEditRefusal(collection: LoadedCollection, slug: string): string | null {
  if (collection.source !== "project") {
    return `manageCollection: '${defangForPrompt(slug)}' is ${collection.source}-scope and read-only here — only project collections (data/skills/) can be edited.`;
  }
  if (isPresetSlug(slug)) {
    return `manageCollection: '${defangForPrompt(slug)}' is a preset (mc-*) and re-seeds on restart — copy it under a different slug to customise.`;
  }
  return null;
}

/** Turn a CollectionSchemaZ failure into a short, actionable list the
 *  agent can fix, pointing back at the field reference. */
function formatSchemaIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const shown = issues.slice(0, MAX_SCHEMA_ISSUES);
  const lines = shown.map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${defangForPrompt(issue.message)}`).join("\n");
  const omitted = issues.length - shown.length;
  const more = omitted > 0 ? `\n- …and ${omitted} more issue(s); fix these first and retry.` : "";
  return `manageCollection: schema rejected — fix and retry (call schemaDocs for the field reference):\n${lines}${more}`;
}

/** Best-effort post-write refresh. Discovery re-reads schema.json from
 *  disk on every call, so a failed refresh only delays the live UI
 *  update — never the data. Default loads the refreshers lazily to keep
 *  this module's static import graph (and the unit test) light. */
async function defaultRefresh(): Promise<void> {
  const [{ refreshScheduledSkills }, { refreshUserTasks }] = await Promise.all([
    import("../../workspace/skills/scheduler.js"),
    import("../../workspace/skills/user-tasks.js"),
  ]);
  await Promise.all([refreshScheduledSkills(), refreshUserTasks()]);
}

/** Write the validated schema to the canonical staging copy, then mirror
 *  it into the active `.claude/skills/` tree discovery reads — an internal
 *  write doesn't fire the skill-bridge hook, so we mirror explicitly. */
async function writeAndMirrorSchema(slug: string, schema: unknown, deps: ManageCollectionDeps): Promise<void> {
  const base = resolveBase(deps);
  await writeFileAtomic(path.join(dataSkillDir(base, slug), SCHEMA_FILE), `${JSON.stringify(schema, null, 2)}\n`);
  mirrorSkillWrite(base, { slug, relSegments: [SCHEMA_FILE] });
  try {
    await (deps.refreshAfterWrite ?? defaultRefresh)();
  } catch {
    // best-effort — see defaultRefresh
  }
}

/** The post-Zod acceptance gates discovery applies before a parsed schema
 *  becomes a live collection. Mirrors collection-plugin's discovery checks
 *  (`loadOneCollection`) but lives host-side and is built only on
 *  already-published primitives (`resolveDataDir` + plain field access) — so
 *  the standalone launcher boots against the published collection-plugin
 *  rather than depending on a new cross-package export. putSchema only runs
 *  for project-scope collections, so the feed-`ingest` gate doesn't apply.
 *  Returns a one-line reason, or null when the schema would be accepted. */
function schemaDiscoveryGate(schema: CollectionSchema, base: string): string | null {
  const primaryField = schema.fields[schema.primaryKey];
  if (!primaryField) return `primaryKey '${schema.primaryKey}' is not one of the declared fields`;
  if (primaryField.primary !== true) return `the primaryKey field '${schema.primaryKey}' must be flagged \`primary: true\``;
  if (resolveDataDir(schema.dataPath, base) === null) return `dataPath '${schema.dataPath}' escapes the workspace`;
  return null;
}

/** Validate a schema against CollectionSchemaZ and, on success, persist it.
 *  Edit-only: a new collection is created by writing SKILL.md + schema.json
 *  under data/skills/<slug>/ (the normal create flow), not through here. */
async function handlePutSchema(slug: string, schemaArg: unknown, deps: ManageCollectionDeps): Promise<string> {
  if (!schemaArg || typeof schemaArg !== "object" || Array.isArray(schemaArg)) {
    return "manageCollection: `schema` is required for putSchema — the full collection schema object.";
  }
  const collection = await loadCollection(slug, deps);
  if (!collection) {
    return `manageCollection: unknown collection '${defangForPrompt(slug)}' — create it by writing SKILL.md + ${SCHEMA_FILE} under data/skills/${defangForPrompt(slug)}/, then edit it here.`;
  }
  const refusal = schemaEditRefusal(collection, slug);
  if (refusal) return refusal;
  const parsed = CollectionSchemaZ.safeParse(schemaArg);
  if (!parsed.success) return formatSchemaIssues(parsed.error.issues);
  // Run the SAME post-Zod gates discovery applies, so a write can't pass
  // here yet be silently skipped on the next load (hiding the collection).
  const gate = schemaDiscoveryGate(parsed.data, resolveBase(deps));
  if (gate) {
    return `manageCollection: schema rejected — ${gate} (call schemaDocs for the field reference). It passes basic validation but discovery would skip it, hiding the collection.`;
  }
  // Path from the discovered (sanitized) slug, never the raw arg.
  await writeAndMirrorSchema(collection.slug, parsed.data, deps);
  return JSON.stringify({ collection: collection.slug, written: true });
}

export function makeManageCollectionTool(deps: ManageCollectionDeps = {}) {
  return {
    definition: {
      name: "manageCollection",
      description:
        "Read and write a schema-driven collection through the host — both its records and its structure. getItems returns records WITH computed values (derived formulas, toggles, embeds) the stored JSON files don't contain; putItems validates each row against the schema before writing. schemaDocs returns the collection-authoring reference; getSchema/putSchema read and validate-then-write the collection's schema.json. Prefer it over raw file I/O on collections.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["getItems", "putItems", "schemaDocs", "getSchema", "putSchema"], description: "What to do." },
          slug: { type: "string", description: "The collection's slug (its directory name, e.g. `stock-quotes`). Required for everything except schemaDocs." },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "getItems: only these record ids (primary-key values). Omit for all records.",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "getItems: only these fields per record (the primary key is always included). Omit for all fields. Use on large collections.",
          },
          items: {
            type: "array",
            items: { type: "object" },
            description: "putItems: the record objects to store. Each must carry the schema's primaryKey value (it doubles as the filename).",
          },
          mode: {
            type: "string",
            enum: ["upsert", "create", "merge"],
            description:
              'putItems: "upsert" (default) replaces existing records WHOLE; "create" rejects rows whose id already exists; "merge" updates only the fields a row carries, keeping the rest of the existing record (rejects unknown ids). Use "merge" when changing a few fields.',
          },
          schema: {
            type: "object",
            description:
              "putSchema: the full collection schema object (same shape as schema.json — title, icon, dataPath, primaryKey, fields, …). Call getSchema first for the current one, and schemaDocs for the field DSL.",
          },
        },
        required: ["action"],
      },
    },

    // Collections are workspace data every role can already reach via
    // raw Read/Write/Edit — gating the SAFER path per-role would only
    // push unlisted roles back onto unvalidated file I/O.
    alwaysActive: true,

    prompt:
      "Use `manageCollection` instead of raw Read/Write/Edit when working with a collection's records OR its schema (raw file I/O stays available as the escape hatch). " +
      "Before authoring or changing a collection's `schema.json`, call `schemaDocs` to load the field/DSL reference, then read with `getSchema` and write with `putSchema` — `putSchema` validates the whole schema before writing and returns actionable errors instead of silently failing discovery's validation. " +
      "`getItems` is the only way to see computed values — `derived` fields (e.g. a portfolio's value), `toggle` projections, and `embed` records are host-computed and never present in the stored JSON files. On large collections pass `ids` and/or `fields` to keep the result small. " +
      "`putItems` validates every row against the schema before writing (required fields, enum values, primaryKey = record id) and returns `{ written, rejected }`; fix each rejected row using its `problem` text and retry just those rows. Never include computed fields in a row you write. " +
      'To update a few fields of an existing record, use `mode: "merge"` with a partial row ({ id, <changed fields> }) — the default upsert replaces the WHOLE record, so a partial upsert would silently erase every optional field it omits.',

    async handler(args: Record<string, unknown>): Promise<string> {
      const action = typeof args.action === "string" ? args.action : "";
      if (action === "schemaDocs") return handleSchemaDocs(deps);
      const slug = typeof args.slug === "string" ? args.slug.trim() : "";
      if (!slug) return "manageCollection: `slug` is required (the collection's slug).";
      if (action === "getSchema") return handleGetSchema(slug, deps);
      if (action === "putSchema") return handlePutSchema(slug, args.schema, deps);
      if (action !== "getItems" && action !== "putItems") {
        return 'manageCollection: `action` must be "getItems", "putItems", "schemaDocs", "getSchema", or "putSchema".';
      }
      const collection = await loadCollection(slug, deps);
      if (!collection) return unknownCollection(slug);
      if (action === "getItems") {
        const ids = optionalStringArray(args.ids, "ids");
        if (!ids.ok) return ids.error;
        const fields = optionalStringArray(args.fields, "fields");
        if (!fields.ok) return fields.error;
        return handleGetItems(collection, { slug, ids: ids.value, fields: fields.value }, deps);
      }
      const parsed = parsePutItems(args, slug);
      if (typeof parsed === "string") return parsed;
      return handlePutItems(collection, parsed, deps);
    },
  };
}

export const manageCollection = makeManageCollectionTool();
