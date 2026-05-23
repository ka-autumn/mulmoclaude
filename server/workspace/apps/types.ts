// Schema-driven app types. An "app" is a skill (under
// .claude/skills/<slug>/) that also ships a sibling `schema.json`.
// The host's CollectionView reads the schema + records and renders a
// table/form; Claude reads SKILL.md and CRUDs the records as JSON
// files.
//
// Field types for v0 — keep this list narrow and grow it only when a
// real app needs the new type. v0 supports flat records only; nested
// tables / cross-collection refs / derived fields / actions are
// deferred to follow-ups (see plans/feat-skill-driven-apps.md).

export type AppFieldType = "string" | "text" | "email" | "number" | "date" | "markdown";

export type AppSource = "user" | "project";

export interface AppFieldSpec {
  type: AppFieldType;
  label: string;
  /** True for the field whose value is the record's filename (no
   *  separate auto-id). Exactly one field per schema may set this. */
  primary?: boolean;
  required?: boolean;
}

export interface AppSchema {
  /** Human-facing app name (sidebar, header). */
  title: string;
  /** Material-icon name shown next to the title. */
  icon: string;
  /** Workspace-relative folder holding one-JSON-per-record. Validated
   *  to live under the workspace root at load time. */
  dataPath: string;
  /** Field name whose value doubles as the record's filename. */
  primaryKey: string;
  /** Ordered map: insertion order = column order in the table view. */
  fields: Record<string, AppFieldSpec>;
}

export interface AppSummary {
  slug: string;
  title: string;
  icon: string;
  source: AppSource;
}

export interface AppDetail extends AppSummary {
  schema: AppSchema;
}

export type AppItem = Record<string, unknown>;
