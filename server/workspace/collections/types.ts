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

export type CollectionFieldType = "string" | "text" | "email" | "number" | "date" | "boolean" | "markdown" | "ref";

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
