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

export type CollectionFieldType =
  | "string"
  | "text"
  | "email"
  | "number"
  | "date"
  | "boolean"
  | "markdown"
  | "ref"
  | "money"
  | "enum"
  | "table"
  | "derived"
  | "embed";

export type CollectionSource = "user" | "project";

/** The kind of work an action kicks off. v1 ships only `"chat"` —
 *  start a new chat in a role with a templated seed prompt. The enum
 *  reserves room for a future `"mutate"` (status transitions) without
 *  another schema-shape change. */
export type CollectionActionKind = "chat";

/** Optional visibility predicate for an action: the button renders
 *  only when the open record's `field` (stringified) is one of `in`.
 *  Generic and domain-free — the host evaluates it against the record
 *  with no knowledge of what the field means. Absent ⇒ always shown. */
export interface CollectionActionWhen {
  /** Top-level record field key whose value gates the button. */
  field: string;
  /** Allowed values; the button shows when `String(record[field])` is
   *  one of these. Non-empty. */
  in: string[];
}

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
   *  open record matches (see CollectionActionWhen). Absent ⇒ always
   *  shown. */
  when?: CollectionActionWhen;
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
   *  `display: "money"`): ISO 4217 currency code passed to
   *  `Intl.NumberFormat` for table display. Defaults to "USD"
   *  client-side when omitted. The stored value is always a plain
   *  decimal number — currency is presentation only. */
  currency?: string;
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
