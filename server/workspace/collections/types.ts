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

export type CollectionFieldType = "string" | "text" | "email" | "number" | "date" | "boolean" | "markdown" | "ref" | "money" | "enum" | "table" | "derived";

export type CollectionSource = "user" | "project";

export interface CollectionFieldSpec {
  type: CollectionFieldType;
  label: string;
  /** True for the field whose value is the record's filename (no
   *  separate auto-id). Exactly one field per schema may set this. */
  primary?: boolean;
  required?: boolean;
  /** When `type === "ref"`: the slug of the target collection the
   *  field's value references (e.g. `clientId` in mc-worklog has
   *  `to: "mc-clients"`). The record stores the target item's
   *  primary-key slug as a plain string; the host uses `to` to
   *  render a clickable link, populate a dropdown picker, and
   *  (future) validate referential integrity. Required when type
   *  is `ref`; ignored on every other type. */
  to?: string;
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
  /** Ordered map: insertion order = column order in the table view. */
  fields: Record<string, CollectionFieldSpec>;
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
