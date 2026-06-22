// Discover schema-driven collections. A "collection" is a skill
// directory that ships a `schema.json` alongside its `SKILL.md`.
// Scans both user (`~/.claude/skills/`) and project
// (`<workspace>/.claude/skills/`) scopes; project wins on slug
// collision (mirrors the rule in
// `server/workspace/skills/discovery.ts`).

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { log, getWorkspaceRoot, userSkillsDir, projectSkillsDir, feedsRoot } from "./host";
import { INGEST_KINDS, FEED_SCHEDULES } from "../core/schema";
import { SCHEMA_FILE, resolveDataDir, safeRecordId, safeSlugName } from "./paths";
import type { LoadedCollection } from "./discoveredCollection";
import { isSafeActionTemplatePath, isSafeCustomViewPath } from "./templatePath";
import type { CollectionDetail, CollectionSchema, CollectionSource, CollectionSummary } from "../core/schema";

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
// The calendar anchor/end fields accept either a date-only or a datetime
// field (the latter carries the clock for the day view).
const isDateLike = (type: string | undefined): boolean => type === "date" || type === "datetime";

// `calendarTimeField` parses a free-form time string, so it must name a
// string-backed field — a number/enum/date column has no time-range text.
const isTimeStringField = (type: string | undefined): boolean => type === "string" || type === "text";

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

// Optional visibility predicate shared by actions and fields: the
// target shows only when the open record's `field` (stringified) is
// one of `in`. Domain-free — `field` is any non-empty key, `in` a
// non-empty array of non-empty values; the host never interprets the
// meaning.
const WhenSchema = z.object({
  field: z.string().trim().min(1),
  in: z.array(z.string().trim().min(1)).min(1),
});

// Sub-fields inside a `table.of` map: the regular field types
// minus `table` (no nested tables) and `derived` (no computed
// columns inside a table — would need the evaluator to walk the
// row context, defer until a real need surfaces).
const SubFieldSpecSchema = z
  .object({
    type: z.enum(["string", "text", "email", "number", "date", "datetime", "boolean", "markdown", "ref", "money", "enum"]),
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
    type: z.enum([
      "string",
      "text",
      "email",
      "number",
      "date",
      "datetime",
      "boolean",
      "markdown",
      "ref",
      "money",
      "enum",
      "table",
      "derived",
      "embed",
      "image",
      "file",
      "toggle",
    ]),
    label: z.string().min(1),
    primary: z.boolean().optional(),
    required: z.boolean().optional(),
    to: z.string().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    currency: z.string().trim().min(1).optional(),
    currencyField: z.string().trim().min(1).optional(),
    values: z.array(z.string().trim().min(1)).min(1).optional(),
    // `toggle` projection: the enum field it fronts + the checked/unchecked
    // values written to it. Validated against the target enum's `values` by
    // a schema-level refine below.
    field: z.string().trim().min(1).optional(),
    onValue: z.string().trim().min(1).optional(),
    offValue: z.string().trim().min(1).optional(),
    of: z.record(z.string(), SubFieldSpecSchema).optional(),
    formula: z.string().trim().min(1).optional(),
    /** Inner type to render a derived value as (e.g. `"money"`).
     *  Restricted to the non-composite display targets — derived
     *  values are scalars, so rendering them via `table` or another
     *  `derived` would be meaningless. */
    display: z.enum(["string", "number", "money", "date"]).optional(),
    // Optional visibility predicate: this field renders only when the
    // record matches (e.g. hide `rating` until `visited` is `true`).
    // The referenced `when.field` is validated to be a real top-level
    // field by a schema-level refine below (a field can't see its
    // siblings here).
    when: WhenSchema.optional(),
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
  })
  .refine(
    (spec) =>
      spec.type !== "toggle" ||
      (typeof spec.field === "string" && spec.field.length > 0 && typeof spec.onValue === "string" && typeof spec.offValue === "string"),
    {
      message: "fields with type 'toggle' must declare `field` (the enum field to project), `onValue`, and `offValue`",
      path: ["field"],
    },
  );

// A schema-declared record action. Domain-free: the host validates the
// shape; the meaning (which role, which template) is data.
const ActionSpecSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
  kind: z.enum(["chat"]),
  role: z.string().trim().min(1),
  template: z
    .string()
    .trim()
    .min(1)
    .refine(isSafeActionTemplatePath, "must be a safe path under `templates/` (e.g. `templates/invoice.md`; no `..`, no leading `/`, no backslash)"),
  when: WhenSchema.optional(),
});

// A custom (LLM-authored) HTML view registration. Domain-free: the host
// validates the shape; the view's behaviour lives in the HTML file. `file`
// is constrained to `views/*.html` (path-safe) so the view-file reader can
// never reach the data folder or the schema/template files. `id` is
// validated to be a real slug + unique by schema-level refines below.
const CustomViewSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
  file: z
    .string()
    .trim()
    .min(1)
    .refine(isSafeCustomViewPath, "must be a safe path under `views/` ending in `.html` (e.g. `views/year.html`; no `..`, no leading `/`, no backslash)"),
  capabilities: z.array(z.enum(["read", "write"])).optional(),
});

// Recurrence advance for `spawn.every`. `interval` is a positive integer
// count of `unit`s; `dayOfMonth` (month/year only) is the canonical
// day-of-month anchor (1-31) or the `"last"` sentinel for end-of-month.
const EverySchema = z.object({
  unit: z.enum(["day", "week", "month", "year"]),
  interval: z.number().int().min(1),
  dayOfMonth: z.union([z.number().int().min(1).max(31), z.literal("last")]).optional(),
});

// Host-driven recurrence. `when` defaults to the completion-done
// condition; `every` is required; `carry`/`set` shape the successor.
const SpawnSchema = z.object({
  when: WhenSchema.optional(),
  every: EverySchema,
  carry: z.array(z.string().trim().min(1)).optional(),
  set: z.record(z.string(), z.unknown()).optional(),
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

// True iff every `toggle` field is a valid projection: its `field` names a
// top-level `enum`, and both `onValue` and `offValue` are members of that
// enum's closed `values` set.
function everyToggleProjectsValidEnum(
  fields: Record<string, { type: string; field?: string; onValue?: string; offValue?: string; values?: readonly string[] }>,
): boolean {
  for (const spec of Object.values(fields)) {
    if (spec.type !== "toggle") continue;
    const target = spec.field === undefined ? undefined : fields[spec.field];
    if (!target || target.type !== "enum" || target.values === undefined) return false;
    const allowed = new Set(target.values);
    if (spec.onValue === undefined || !allowed.has(spec.onValue)) return false;
    if (spec.offValue === undefined || !allowed.has(spec.offValue)) return false;
  }
  return true;
}

// True iff a `spawn`'s successor will NOT be born already matching its own
// predicate (and would therefore re-spawn forever). The effective predicate
// is `spawn.when` when present, else the completion-done pair. The successor's
// value for the predicate field is `set[field]` if set, else the carried
// source value (which matched when the spawn fired) if carried, else absent.
function spawnSuccessorStartsInert(schema: {
  spawn?: { when?: { field: string; in: readonly string[] }; carry?: readonly string[]; set?: Record<string, unknown> };
  completionField?: string;
  completionDoneValues?: readonly string[];
}): boolean {
  const { spawn } = schema;
  if (!spawn) return true;
  const field = spawn.when?.field ?? schema.completionField;
  const values = spawn.when?.in ?? schema.completionDoneValues;
  if (!field || !values) return true; // predicate not evaluable — other refines cover this
  if (spawn.set && Object.prototype.hasOwnProperty.call(spawn.set, field)) {
    return !values.includes(String(spawn.set[field])); // `set` wins over `carry`
  }
  return !(spawn.carry ?? []).includes(field); // carried ⇒ inherits the matching value
}

// Declarative retrieval config for a Feed (a collection that refills
// itself from the internet). Optional on every schema — skill-backed
// collections omit it; only feeds discovered from `<workspace>/feeds/`
// carry it. `http-json` needs a path to the items array; rss/atom
// yield items natively and ignore `itemsAt`.
const IngestSchemaZ = z.object({
  kind: z.enum(INGEST_KINDS),
  url: z.string().url(),
  schedule: z.enum(FEED_SCHEDULES),
  itemsAt: z.string().trim().min(1).optional(),
  map: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  idFrom: z.string().trim().min(1).optional(),
  maxItems: z.number().int().min(0).optional(),
});
// `itemsAt` is always optional: http-json omits it when the response body
// is itself the items array (the engine falls back to the top-level array);
// rss/atom ignore it. So no kind-specific requirement here.

export const CollectionSchemaZ = z
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
    // Collection-level actions (header buttons). Same shape as `actions`;
    // the `when` predicate is ignored (no record context). The seed
    // prompt injects a progress summary of all records instead.
    collectionActions: z.array(ActionSpecSchema).optional(),
    // Completion-tracking pair: when both are set, item-create fires a
    // notification that clears once `completionField` transitions into
    // `completionDoneValues`. The two are bound together — declaring
    // one without the other is a misconfiguration the cross-field
    // refine below rejects.
    completionField: z.string().trim().min(1).optional(),
    completionDoneValues: z.array(z.string().trim().min(1)).min(1).optional(),
    // Optional human-readable label for the completion notification's
    // title — names the field whose value reads better than the opaque
    // primaryKey (e.g. a `name` field). Falls back to the primaryKey
    // value at render time when unset or empty.
    displayField: z.string().trim().min(1).optional(),
    // Time gate: names a `date` field that delays the completion bell
    // until the clock reaches it. Requires the completion pair (the bell
    // still clears via the done value). Validated to name a real `date`
    // field by refines below.
    triggerField: z.string().trim().min(1).optional(),
    // Lead time in whole days — fire the bell this many days before
    // `triggerField`. Non-negative; requires `triggerField` (refine below).
    triggerLeadDays: z.number().int().min(0).optional(),
    // Host-driven recurrence; requires `triggerField`. See SpawnSchema.
    spawn: SpawnSchema.optional(),
    // Calendar view anchor: names a `date` field whose value places each
    // record on a month grid. Validated to name a real `date` field by a
    // refine below. Optional — the toggle auto-derives from any `date`
    // field when this is unset.
    calendarField: z.string().trim().min(1).optional(),
    // Multi-day span end: a second `date` field the calendar record spans
    // to. Requires `calendarField`; validated to name a real `date` field.
    calendarEndField: z.string().trim().min(1).optional(),
    // Day (time-allocation) view time source: names a string field holding a
    // free-form time or time-range (e.g. "14:00-17:00", "17:00-", "16:30").
    // Consulted only when the date fields are date-only. Requires
    // `calendarField`; validated to name a real field by a refine below.
    calendarTimeField: z.string().trim().min(1).optional(),
    // Kanban board group: names an `enum` field whose value buckets each
    // record into a column. Validated to name a real `enum` field by a
    // refine below. Optional — the toggle auto-derives from any `enum`
    // field when this is unset.
    kanbanField: z.string().trim().min(1).optional(),
    // Custom (LLM-authored) HTML views. Each renders in a sandboxed iframe
    // over the records. Optional, so every existing schema validates
    // unchanged. Ids validated to be valid + unique slugs by refines below.
    views: z.array(CustomViewSchema).optional(),
    // Completion-bell gate: only notify for records matching this predicate
    // (e.g. high-priority todos). Reuses the `when` shape; requires
    // `completionField`; field validated to exist by refines below.
    notifyWhen: WhenSchema.optional(),
    // Declarative retrieval config. Present only on Feeds (collections in
    // the `<workspace>/feeds/` registry). Optional, so every existing
    // skill schema validates unchanged.
    ingest: IngestSchemaZ.optional(),
  })
  // The singleton value becomes a record id (and thus a `<id>.json`
  // filename), so it must satisfy the SAME `safeRecordId` rule the
  // write path enforces — otherwise the create form would lock the
  // primary key to a value the POST route then rejects as an invalid
  // item id, making the collection impossible to initialize (Codex P1).
  .refine((schema) => schema.singleton === undefined || safeRecordId(schema.singleton) !== null, {
    message: "schema `singleton` must be a valid item id (alphanumeric / hyphen / underscore / interior dot, no `..` or path separators)",
    path: ["singleton"],
  })
  // Action ids must be unique so the dispatch route resolves
  // unambiguously.
  .refine((schema) => schema.actions === undefined || new Set(schema.actions.map((action) => action.id)).size === schema.actions.length, {
    message: "schema `actions` must have unique `id`s",
    path: ["actions"],
  })
  // Collection-level action ids must likewise be unique.
  .refine(
    (schema) => schema.collectionActions === undefined || new Set(schema.collectionActions.map((action) => action.id)).size === schema.collectionActions.length,
    {
      message: "schema `collectionActions` must have unique `id`s",
      path: ["collectionActions"],
    },
  )
  // A `currencyField` pointer must name a real top-level field that
  // holds a code string — a typo (`curreny`) would otherwise pass the
  // per-field check, then silently fall back to the literal / USD at
  // render and mislabel amounts. Checked at the schema level because a
  // field can't see its siblings.
  .refine((schema) => collectCurrencyFieldRefs(schema.fields).every((name) => CODE_FIELD_TYPES.has(schema.fields[name]?.type ?? "")), {
    message: "a money field's `currencyField` must name a top-level `string`, `text`, or `enum` field that holds the currency code",
    path: ["fields"],
  })
  // Completion-tracking pair must be declared together: declaring
  // `completionField` without `completionDoneValues` (or vice-versa)
  // is meaningless — the host would either never fire (no done values
  // to compare against) or never clear (no field to read). Bound
  // together so the misconfiguration fails loudly at load time.
  .refine((schema) => (schema.completionField === undefined) === (schema.completionDoneValues === undefined), {
    message: "schema `completionField` and `completionDoneValues` must be declared together (both set, or both omitted)",
    path: ["completionField"],
  })
  // `completionField` must name a real top-level field — a typo would
  // silently disable the notification mechanism otherwise.
  .refine((schema) => schema.completionField === undefined || schema.fields[schema.completionField] !== undefined, {
    message: "schema `completionField` must name a top-level field declared in `fields`",
    path: ["completionField"],
  })
  // `displayField`, like `completionField`, must name a real top-level
  // field — a typo would silently fall back to the primaryKey forever.
  .refine((schema) => schema.displayField === undefined || schema.fields[schema.displayField] !== undefined, {
    message: "schema `displayField` must name a top-level field declared in `fields`",
    path: ["displayField"],
  })
  // A field's `when.field` gates its visibility against a sibling's
  // value, so it must name a real top-level field — a typo would
  // silently keep the field hidden forever (the gate never matches).
  // Checked at the schema level because a field can't see its siblings.
  .refine((schema) => Object.values(schema.fields).every((field) => field.when === undefined || schema.fields[field.when.field] !== undefined), {
    message: "a field's `when.field` must name a top-level field declared in `fields`",
    path: ["fields"],
  })
  // `triggerField` requires the completion pair: the time gate only
  // suppresses the *completion* bell until the date, and the bell still
  // clears via `completionDoneValues`. Without completion there is no
  // bell to gate (or clear), so the declaration is meaningless.
  .refine((schema) => schema.triggerField === undefined || schema.completionField !== undefined, {
    message: "schema `triggerField` requires `completionField` / `completionDoneValues` (the gated bell still clears via the done value)",
    path: ["triggerField"],
  })
  // `triggerField` must name a real `date` field — the gate parses its
  // value as `YYYY-MM-DD`; any other type can't be compared to the clock.
  .refine((schema) => schema.triggerField === undefined || schema.fields[schema.triggerField]?.type === "date", {
    message: "schema `triggerField` must name a top-level `date` field declared in `fields`",
    path: ["triggerField"],
  })
  // `triggerLeadDays` only means something relative to a trigger date.
  .refine((schema) => schema.triggerLeadDays === undefined || schema.triggerField !== undefined, {
    message: "schema `triggerLeadDays` requires `triggerField` (it shifts when that field's bell fires)",
    path: ["triggerLeadDays"],
  })
  // `spawn` advances `triggerField` to compute the successor's trigger
  // date, so the schema must declare one.
  .refine((schema) => schema.spawn === undefined || schema.triggerField !== undefined, {
    message: "schema `spawn` requires `triggerField` (the successor's trigger date is `triggerField` advanced by `spawn.every`)",
    path: ["spawn"],
  })
  // `spawn.when.field` and every `spawn.carry` entry must name real
  // top-level fields — a typo would silently never match / never copy.
  .refine((schema) => schema.spawn?.when === undefined || schema.fields[schema.spawn.when.field] !== undefined, {
    message: "schema `spawn.when.field` must name a top-level field declared in `fields`",
    path: ["spawn"],
  })
  .refine((schema) => (schema.spawn?.carry ?? []).every((name) => schema.fields[name] !== undefined), {
    message: "every `spawn.carry` entry must name a top-level field declared in `fields`",
    path: ["spawn"],
  })
  // A successor must NOT be born already matching its own spawn predicate
  // — it would re-spawn on its first reconcile, fanning out into an
  // unbounded chain of records. The predicate field/values are `spawn.when`
  // when given, else the completion-done pair (the default predicate). The
  // successor's value for that field is `set[field]` if set, else the
  // carried source value (which matched, by definition, when the spawn
  // fired) if carried, else absent (safe). Reject the first two when they
  // land on a matching value.
  .refine((schema) => spawnSuccessorStartsInert(schema), {
    message:
      "`spawn` must leave the successor in a non-matching state (e.g. `set` the status to a pending value); seeding the predicate field to a matching value via `set`/`carry` would respawn forever",
    path: ["spawn"],
  })
  // `calendarField` must name a real `date`/`datetime` field — the calendar
  // view parses its value to place records on the month grid (a `datetime`
  // anchor also carries the clock for the day view); any other type can't be
  // put on a calendar.
  .refine((schema) => schema.calendarField === undefined || isDateLike(schema.fields[schema.calendarField]?.type), {
    message: "schema `calendarField` must name a top-level `date` or `datetime` field declared in `fields`",
    path: ["calendarField"],
  })
  // `calendarEndField` marks the end of a multi-day span, so it only means
  // something alongside a start anchor.
  .refine((schema) => schema.calendarEndField === undefined || schema.calendarField !== undefined, {
    message: "schema `calendarEndField` requires `calendarField` (it marks the end of the span that starts at `calendarField`)",
    path: ["calendarEndField"],
  })
  // `calendarEndField` must also name a real `date`/`datetime` field — same parse.
  .refine((schema) => schema.calendarEndField === undefined || isDateLike(schema.fields[schema.calendarEndField]?.type), {
    message: "schema `calendarEndField` must name a top-level `date` or `datetime` field declared in `fields`",
    path: ["calendarEndField"],
  })
  // `calendarTimeField` places records on the day view, so it only means
  // something alongside a start anchor.
  .refine((schema) => schema.calendarTimeField === undefined || schema.calendarField !== undefined, {
    message: "schema `calendarTimeField` requires `calendarField` (it supplies the time-of-day for the calendar's day view)",
    path: ["calendarTimeField"],
  })
  // `calendarTimeField` must name a real top-level field (a free-form time
  // string the day view parses).
  .refine((schema) => schema.calendarTimeField === undefined || schema.fields[schema.calendarTimeField] !== undefined, {
    message: "schema `calendarTimeField` must name a top-level field declared in `fields`",
    path: ["calendarTimeField"],
  })
  // …and that field must be string-backed — the day view parses its value as a
  // time string, so a number/enum/date column can't drive it.
  .refine((schema) => schema.calendarTimeField === undefined || isTimeStringField(schema.fields[schema.calendarTimeField]?.type), {
    message: "schema `calendarTimeField` must name a top-level `string` or `text` field declared in `fields`",
    path: ["calendarTimeField"],
  })
  // `kanbanField` must name a real `enum` field — the board groups records
  // into one column per declared enum value; any other type has no closed
  // set of columns to group by.
  .refine((schema) => schema.kanbanField === undefined || schema.fields[schema.kanbanField]?.type === "enum", {
    message: "schema `kanbanField` must name a top-level `enum` field declared in `fields`",
    path: ["kanbanField"],
  })
  // A `toggle` field projects an `enum` field: its `field` must name a real
  // top-level enum, and `onValue` / `offValue` must be members of that
  // enum's `values` — otherwise toggling would write a value outside the
  // closed set (and never appear "checked").
  .refine((schema) => everyToggleProjectsValidEnum(schema.fields), {
    message: "a `toggle` field's `field` must name a top-level `enum` field, and its `onValue`/`offValue` must be values of that enum",
    path: ["fields"],
  })
  // `notifyWhen` narrows the completion bell, so it only means something with
  // completion tracking, and its `field` must name a real top-level field.
  .refine((schema) => schema.notifyWhen === undefined || schema.completionField !== undefined, {
    message: "schema `notifyWhen` requires `completionField` (it narrows that bell)",
    path: ["notifyWhen"],
  })
  .refine((schema) => schema.notifyWhen === undefined || schema.fields[schema.notifyWhen.field] !== undefined, {
    message: "schema `notifyWhen.field` must name a top-level field declared in `fields`",
    path: ["notifyWhen"],
  })
  // Every custom view `id` must be a valid slug — it doubles as the
  // view-mode selector key (`custom:<id>`) and the capability-token clamp
  // key, both of which expect a path-safe token.
  .refine((schema) => schema.views === undefined || schema.views.every((view) => safeSlugName(view.id) !== null), {
    message: "every `views[].id` must be a valid slug (alphanumeric / hyphen / underscore, no path separators)",
    path: ["views"],
  })
  // Custom view ids must be unique so the selector + token clamp resolve
  // unambiguously.
  .refine((schema) => schema.views === undefined || new Set(schema.views.map((view) => view.id)).size === schema.views.length, {
    message: "schema `views` must have unique `id`s",
    path: ["views"],
  });

// The LoadedCollection shape now lives in @mulmoclaude/collection-plugin/server
// (imported at the top, re-exported below) so discovery stays its producer and
// the many `from "./discovery.js"` importers resolve it unchanged.

// Normalize an agent-authored feed schema (no register tool to do it):
// default `icon`, and **force** `dataPath` to the feed-owned namespace
// `data/feeds/<slug>`. Forcing dataPath (rather than trusting the file) is
// a safety boundary — a feed can only ever read/write/delete records under
// its own folder, never another app's data (e.g. `data/wiki`). Non-object
// input passes through so the Zod error stays clear.
function applyFeedSchemaDefaults(parsed: unknown, slug: string): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = parsed as Record<string, unknown>;
  const icon = typeof obj.icon === "string" && obj.icon.trim().length > 0 ? obj.icon : "dynamic_feed";
  return { ...obj, icon, dataPath: `data/feeds/${slug}` };
}

/** Result of the post-Zod acceptance gates: the resolved record dir on
 *  success, or a one-line reason discovery would skip the schema. */
export type SchemaAcceptance = { ok: true; dataDir: string } | { ok: false; reason: string };

/** The acceptance gates discovery applies AFTER `CollectionSchemaZ` parses,
 *  before a schema becomes a live collection:
 *
 *  - the `primaryKey` must be a declared field flagged `primary: true` —
 *    without the flag CollectionView renders the field editable, and a
 *    rename is silently pinned back to the URL itemId on save, so the user's
 *    edit is dropped with no error;
 *  - a `feed` schema must declare an `ingest` block (else it's a dead,
 *    non-refreshable card);
 *  - `dataPath` must resolve INSIDE the workspace.
 *
 *  Exported so `manageCollection`'s `putSchema` can run the SAME gates before
 *  it reports success — a schema that passes `CollectionSchemaZ` but fails one
 *  of these would otherwise write cleanly yet be skipped on the next discovery,
 *  hiding the collection (the exact failure that tool exists to prevent). */
export function acceptParsedSchema(schema: CollectionSchema, opts: { source: CollectionSource; workspaceRoot: string }): SchemaAcceptance {
  const primaryField = schema.fields[schema.primaryKey];
  if (!primaryField) return { ok: false, reason: `primaryKey '${schema.primaryKey}' is not one of the declared fields` };
  if (primaryField.primary !== true) return { ok: false, reason: `the primaryKey field '${schema.primaryKey}' must be flagged \`primary: true\`` };
  if (opts.source === "feed" && !schema.ingest) return { ok: false, reason: "a feed schema must declare an `ingest` block" };
  const dataDir = resolveDataDir(schema.dataPath, opts.workspaceRoot);
  if (dataDir === null) return { ok: false, reason: `dataPath '${schema.dataPath}' escapes the workspace` };
  return { ok: true, dataDir };
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

  // Feeds are authored by the agent as plain files (no register tool), so
  // fill the boilerplate icon / dataPath if omitted before validation.
  const candidate = source === "feed" ? applyFeedSchemaDefaults(parsedJson, safeName) : parsedJson;
  const parsed = CollectionSchemaZ.safeParse(candidate);
  if (!parsed.success) {
    log.warn("collections", "schema.json failed validation, skipping", { slug: safeName, issues: parsed.error.issues });
    return null;
  }

  // Post-Zod acceptance gates (primaryKey flagged primary, feed ingest,
  // workspace-contained dataPath) — shared with manageCollection's putSchema
  // so a validated write and discovery agree on what's a live collection.
  const schema = parsed.data;
  const acceptance = acceptParsedSchema(schema, { source, workspaceRoot });
  if (!acceptance.ok) {
    log.warn("collections", "schema.json rejected after validation, skipping", { slug: safeName, reason: acceptance.reason });
    return null;
  }

  return { slug: safeName, source, schema, dataDir: acceptance.dataDir, skillDir: path.join(skillsRoot, safeName) };
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
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const userDir = opts.userSkillsDir ?? userSkillsDir();
  const projectDir = projectSkillsDir(workspaceRoot);
  // Feeds (the non-skill `<workspace>/feeds/` registry) are scanned as a
  // third root. They merge FIRST so a real skill collection (user or
  // project) always overrides a feed on slug collision — a feed must
  // never shadow a genuine skill-backed collection.
  const feedCollections = await collectFromDir(feedsRoot(workspaceRoot), "feed", workspaceRoot);
  const userCollections = await collectFromDir(userDir, "user", workspaceRoot);
  const projectCollections = await collectFromDir(projectDir, "project", workspaceRoot);
  const merged = new Map<string, LoadedCollection>();
  for (const entry of feedCollections) merged.set(entry.slug, entry);
  for (const entry of userCollections) merged.set(entry.slug, entry);
  for (const entry of projectCollections) merged.set(entry.slug, entry);
  return [...merged.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

/** Load one collection by slug. Returns null if the slug is invalid,
 *  no matching skill exists, or the schema is malformed. */
export async function loadCollection(slug: string, opts: DiscoveryOptions = {}): Promise<LoadedCollection | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const userDir = opts.userSkillsDir ?? userSkillsDir();
  const projectDir = projectSkillsDir(workspaceRoot);
  // Project first (overrides user), then user, then the feeds registry
  // last — mirroring the merge precedence in `discoverCollections` so a
  // skill collection always wins over a feed of the same slug.
  const projectCollection = await loadOneCollection(projectDir, safeName, "project", workspaceRoot);
  if (projectCollection) return projectCollection;
  const userCollection = await loadOneCollection(userDir, safeName, "user", workspaceRoot);
  if (userCollection) return userCollection;
  return loadOneCollection(feedsRoot(workspaceRoot), safeName, "feed", workspaceRoot);
}

export function toSummary(collection: LoadedCollection): CollectionSummary {
  return { slug: collection.slug, title: collection.schema.title, icon: collection.schema.icon, source: collection.source };
}

export function toDetail(collection: LoadedCollection): CollectionDetail {
  return { ...toSummary(collection), schema: collection.schema };
}
