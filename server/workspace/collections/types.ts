// Schema-driven collection types. A "collection" is a skill (under
// .claude/skills/<slug>/) that also ships a sibling `schema.json`.
// The host's <CollectionView> reads the schema + records and renders
// a table/form; Claude reads SKILL.md and CRUDs the records as JSON
// files.
//
// Field types for v0 — keep this list narrow and grow it only when a
// real collection needs the new type. v0 supports flat records only;
// nested tables / cross-collection refs / derived fields / actions are
// deferred to follow-ups (see plans/done/feat-skill-driven-apps.md and
// plans/done/feat-skill-driven-apps-worklog.md — historical names predate
// the rename).

import type { IngestSpec } from "../feeds/ingestTypes.js";

export type CollectionFieldType =
  | "string"
  | "text"
  | "email"
  | "number"
  | "date"
  | "datetime"
  | "boolean"
  | "markdown"
  | "ref"
  | "money"
  | "enum"
  | "table"
  | "derived"
  | "embed"
  // Holds a workspace-relative image path (e.g. a `data/attachments/...`
  // upload); rendered as an <img> in the detail view (not the list table —
  // a per-row fetch is too expensive at scale). Stored and edited as a
  // plain string.
  | "image"
  // A checkbox that is a pure PROJECTION of an `enum` field — it stores
  // nothing of its own. Checked when the enum equals `onValue`; toggling
  // writes `onValue` / `offValue` back to that enum field. Lets a "done"
  // checkbox front a kanban `status` field with the enum as the single
  // source of truth (no separate stored boolean to keep in sync).
  | "toggle";

// "feed" collections live in the non-skill `<workspace>/feeds/` registry
// and carry an `ingest` block; they reuse the same storage + rendering
// as skill-backed collections but are never loaded into the agent prompt.
export type CollectionSource = "user" | "project" | "feed";

/** Recurrence unit for a `spawn.every` advance. */
export type CollectionRecurUnit = "day" | "week" | "month" | "year";

/** How a `spawn` advances the source item's `triggerField` date to
 *  produce the successor's. All arithmetic is done on the civil
 *  (year, month, day) triple — never by adding milliseconds — so month
 *  lengths and leap years are handled correctly. */
export interface CollectionEvery {
  unit: CollectionRecurUnit;
  /** Number of `unit`s to advance (≥ 1). `interval: 3` + `unit: "month"`
   *  = quarterly; `interval: 1` + `unit: "year"` = annual. */
  interval: number;
  /** Day-of-month anchor for `month`/`year` units. The CANONICAL day —
   *  read from the rule, never re-derived from the prior concrete date,
   *  so "31st of every month" yields 31 → 28/29 → 31 → 30 … with no
   *  drift (it is clamped per-month at compute time, not stored
   *  clamped). `"last"` always means the last day of the target month.
   *  Omitted ⇒ preserve the source date's day (safe for days ≤ 28).
   *  Ignored for `day`/`week` units. */
  dayOfMonth?: number | "last";
}

/** Host-driven recurrence: when a record satisfies `when`, the host
 *  creates the next record with a forward-advanced `triggerField` date.
 *  The successor's id and contents are a pure function of (source
 *  record, this rule); creation is create-if-absent, so the mechanism
 *  stays convergent — observing the predicate N times writes one
 *  successor. Requires the schema to declare `triggerField`. */
export interface CollectionSpawn {
  /** Predicate that fires the spawn (a `CollectionWhen`). Defaults to
   *  "`completionField` value ∈ `completionDoneValues`" (i.e. spawn the
   *  next instance when this one is done). */
  when?: CollectionWhen;
  /** How to advance `triggerField` from the source to the successor. */
  every: CollectionEvery;
  /** Record fields copied verbatim onto the successor. Fields not listed
   *  here, not in `set`, and not the trigger / primary keys start
   *  blank. */
  carry?: string[];
  /** Fields forced to fixed values on the successor (typically resetting
   *  the status field to its pending value). */
  set?: Record<string, unknown>;
}

/** The kind of work an action kicks off. v1 ships only `"chat"` —
 *  start a new chat in a role with a templated seed prompt. The enum
 *  reserves room for a future `"mutate"` (status transitions) without
 *  another schema-shape change. */
export type CollectionActionKind = "chat";

/** Optional visibility predicate: the target (an action button or a
 *  field) renders only when the open record's `field` (stringified) is
 *  one of `in`. Generic and domain-free — the host evaluates it against
 *  the record with no knowledge of what the field means. Absent ⇒
 *  always shown. */
export interface CollectionWhen {
  /** Top-level record field key whose value gates visibility. */
  field: string;
  /** Allowed values; the target shows when `String(record[field])` is
   *  one of these. Non-empty. */
  in: string[];
}

/** @deprecated Name retained for back-compat; use {@link CollectionWhen}.
 *  Both actions and fields share the same predicate shape. */
export type CollectionActionWhen = CollectionWhen;

/** A schema-declared, per-record action rendered as a button in the
 *  read-only detail view. Pure UI/behaviour directive — never stored,
 *  never validated against record data. All domain specifics (label,
 *  role, template) live here in the schema / skill folder, so the host
 *  stays generic. */
export interface CollectionAction {
  /** Stable id (used in the dispatch route + testids). */
  id: string;
  /** Button text (English, like field labels). */
  label: string;
  /** Material-icon name shown on the button. */
  icon?: string;
  /** What the action does. v1: `"chat"`. */
  kind: CollectionActionKind;
  /** `kind: "chat"`: the role id the new chat runs in. */
  role: string;
  /** `kind: "chat"`: skill-relative path to the template file whose
   *  text becomes the seed prompt body (e.g. `templates/invoice.md`). */
  template: string;
  /** Optional visibility predicate; the button renders only when the
   *  open record matches (see CollectionWhen). Absent ⇒ always
   *  shown. */
  when?: CollectionWhen;
}

export interface CollectionFieldSpec {
  type: CollectionFieldType;
  label: string;
  /** True for the field whose value is the record's filename (no
   *  separate auto-id). Exactly one field per schema may set this. */
  primary?: boolean;
  required?: boolean;
  /** When `type === "ref"` or `type === "embed"`: the slug of the
   *  target collection. For `ref` the record stores the target
   *  item's primary-key slug and the host renders a clickable link
   *  + dropdown picker. For `embed` the host pulls a *fixed* record
   *  (see `id`) from the target and renders its fields read-only in
   *  the detail view. Required for both; ignored on every other
   *  type. */
  to?: string;
  /** When `type === "embed"`: the primary-key value of the fixed
   *  record to pull from the `to` collection (e.g. `me` for the
   *  singleton mc-profile). Nothing is stored on this record — the
   *  embed is a display-only directive resolved at render time, so
   *  it never appears in the list table or the edit form. Required
   *  when type is `embed`; ignored on every other type. */
  id?: string;
  /** When `type === "money"` (or `type === "derived"` with
   *  `display: "money"`): a literal ISO 4217 currency code passed to
   *  `Intl.NumberFormat` for display — fixed for every record. The
   *  stored value is always a plain decimal number; currency is
   *  presentation only. Mutually substitutable with `currencyField`:
   *  a money field must declare at least one of the two. */
  currency?: string;
  /** When `type === "money"` (or `type === "derived"` with
   *  `display: "money"`): the name of a sibling record field whose
   *  value holds the ISO 4217 code, letting currency vary per record
   *  (e.g. an invoice's `currency` enum). The renderer reads
   *  `record[currencyField]` and falls back to the literal `currency`
   *  (then "USD") when the field is absent or empty. Resolved against
   *  the top-level record even for money sub-fields inside a table. */
  currencyField?: string;
  /** When `type === "enum"`: the closed set of allowed string
   *  values. The form renders a `<select>` populated from this
   *  list; storage is a plain string. Required when type is
   *  `enum`; ignored on every other type. */
  values?: readonly string[];
  /** When `type === "table"`: the sub-schema for each row (a flat
   *  record of non-table / non-derived field specs). Required when
   *  type is `table`. v0 disallows nested tables and derived
   *  columns to keep the editor + evaluator simple. */
  of?: Record<string, CollectionFieldSpec>;
  /** When `type === "derived"`: a tiny expression evaluated against
   *  the record. Supports `+ - * /`, parens, identifier refs to
   *  top-level fields, `sum(tableField[].col)`, and
   *  `sum(tableField[].col * tableField[].col)`. See
   *  `src/utils/collections/derivedFormula.ts`. Required when type
   *  is `derived`. */
  formula?: string;
  /** When `type === "derived"`: an inner field type the computed
   *  value should be rendered as (e.g. `"money"` so $1,234.56 is
   *  formatted). Defaults to `"number"`. */
  display?: CollectionFieldType;
  /** Optional visibility predicate: this field renders only when the
   *  record matches (e.g. hide a `rating` field until `visited` is
   *  `true` via `{ field: "visited", in: ["true"] }`). Applies to the
   *  list cell (blank when hidden), the edit form (hidden live as the
   *  gating field changes), and the detail view. Purely presentational
   *  — a hidden field's stored value is never cleared. `when.field`
   *  must name another top-level field. Absent ⇒ always shown. Only
   *  honoured on top-level fields, not inside a `table`'s `of`. */
  when?: CollectionWhen;
  /** When `type === "toggle"`: the name of the top-level `enum` field this
   *  checkbox projects. The toggle stores nothing itself — it reads and
   *  writes this field. Required when type is `toggle`; ignored otherwise.
   *  Must name a real `enum` field. */
  field?: string;
  /** When `type === "toggle"`: the enum value that means "checked". The
   *  box is checked when the projected `field` equals this; checking writes
   *  it. Required when type is `toggle`; must be one of the enum's `values`. */
  onValue?: string;
  /** When `type === "toggle"`: the enum value written when the box is
   *  unchecked. Required when type is `toggle`; must be one of the enum's
   *  `values`. */
  offValue?: string;
}

export interface CollectionSchema {
  /** Human-facing collection name (sidebar, header). */
  title: string;
  /** Material-icon name shown next to the title. */
  icon: string;
  /** Workspace-relative folder holding one-JSON-per-record. Validated
   *  to live under the workspace root at load time. */
  dataPath: string;
  /** Field name whose value doubles as the record's filename. */
  primaryKey: string;
  /** When set, the collection is a singleton: at most one record,
   *  whose primary key is fixed to this value (e.g. `me` for the
   *  business profile). The host pre-fills + locks the create form's
   *  primary key and hides Add once the record exists. */
  singleton?: string;
  /** Ordered map: insertion order = column order in the table view. */
  fields: Record<string, CollectionFieldSpec>;
  /** Optional per-record actions rendered as buttons in the detail
   *  view (e.g. "Generate PDF"). Order = button order. */
  actions?: CollectionAction[];
  /** Name of the field whose value marks an item as "done". When set,
   *  a notification fires on item create (unless the item is born done)
   *  and clears when the field's value transitions into
   *  `completionDoneValues`. Must name a real field in `fields`. */
  completionField?: string;
  /** The set of values for `completionField` that count as "done"
   *  (e.g. `["Done"]` for a todo status field, `["paid"]` for an
   *  invoice). Non-empty. Compared as strings. */
  completionDoneValues?: readonly string[];
  /** Name of the field whose value is shown as the human-readable
   *  label in a completion notification's title (e.g. a `name` field,
   *  so the bell reads `Contacts: Jane Doe` instead of the opaque
   *  primaryKey). Must name a real field in `fields`. When unset — or
   *  when the record's value for it is empty — the title falls back to
   *  the record's primaryKey value. Display-only; never stored. */
  displayField?: string;
  /** Name of a `date` field that gates this item's completion
   *  notification: the bell is suppressed until the clock reaches that
   *  date (compared at day-granularity in the server's local timezone),
   *  instead of firing on create. Requires `completionField` /
   *  `completionDoneValues` (the bell still clears via the done value).
   *  Must name a real `date` field. Absent ⇒ fire on create, as before. */
  triggerField?: string;
  /** Lead time in whole days: fire the bell this many days BEFORE
   *  `triggerField` (so `10` shows the reminder 10 days early). The lead
   *  is applied at fire time, not stored, so it composes with `spawn` —
   *  every recurred cycle fires the same number of days before its own
   *  trigger. Non-negative integer; requires `triggerField`. Default 0
   *  (fire on the trigger date). */
  triggerLeadDays?: number;
  /** Host-driven recurrence. When set, requires `triggerField`. See
   *  {@link CollectionSpawn}. */
  spawn?: CollectionSpawn;
  /** Name of a `date` field that anchors the optional calendar view: a
   *  month grid where each record lands on the day cell matching this
   *  field's value. When unset, the calendar toggle still appears if the
   *  schema has any `date` field (the first one, in declaration order, is
   *  used by default and is switchable in-view). Set this to pin a specific
   *  anchor. Must name a real `date` field. */
  calendarField?: string;
  /** Name of a second `date` field marking the END of a multi-day span on
   *  the calendar: the record renders from `calendarField` through this
   *  date inclusive. Requires `calendarField`. Must name a real `date`
   *  field. Absent ⇒ single-day placement. */
  calendarEndField?: string;
  /** Name of a string field holding a free-form time or time-range
   *  (e.g. "14:00-17:00", "17:00-", "16:30") that places records on the
   *  calendar's day (time-allocation) view. Consulted only when the calendar
   *  date fields are date-only. Requires `calendarField`. */
  calendarTimeField?: string;
  /** Name of an `enum` field that groups records into columns on the
   *  optional Kanban board: each record lands in the column matching its
   *  value, with empty/unknown values collected in an "Uncategorized"
   *  column. When unset, the Kanban toggle still appears if the schema has
   *  any `enum` field (the first one, in declaration order, is used by
   *  default and is switchable in-view). Set this to pin a specific group
   *  field. Must name a real `enum` field. */
  kanbanField?: string;
  /** Optional predicate that gates the completion bell: when set, the bell
   *  fires only for records whose `String(record[notifyWhen.field])` is one
   *  of `notifyWhen.in` (e.g. notify only `high`/`urgent` priority todos).
   *  Reuses the `when` predicate shape. Requires `completionField` — it
   *  narrows that bell rather than introducing a second one. The bell still
   *  clears on done / delete / when the predicate stops matching. Absent ⇒
   *  notify for every open record (the prior behaviour). `notifyWhen.field`
   *  must name a real top-level field. */
  notifyWhen?: CollectionWhen;
  /** Optional declarative retrieval config. When present, this collection
   *  is a "Feed": the host periodically fetches `ingest.url`, maps the
   *  response into records, and upserts them by `primaryKey`. Only feeds
   *  discovered from the `<workspace>/feeds/` registry carry this; skill
   *  collections omit it. See {@link IngestSpec}. */
  ingest?: IngestSpec;
}

export interface CollectionSummary {
  slug: string;
  title: string;
  icon: string;
  source: CollectionSource;
}

export interface CollectionDetail extends CollectionSummary {
  schema: CollectionSchema;
}

export type CollectionItem = Record<string, unknown>;
