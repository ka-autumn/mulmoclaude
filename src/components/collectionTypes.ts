// Shared types for the collection surfaces — the list/detail view
// (CollectionView.vue), the extracted record panel
// (CollectionRecordPanel.vue), the calendar view
// (CollectionCalendarView.vue), and the rendering composable
// (composables/collections/useCollectionRendering.ts). These lived
// inline in CollectionView.vue until the calendar view needed the panel
// to be reusable; the shapes are unchanged.

export type FieldType =
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
  | "image"
  | "file"
  | "embed"
  | "toggle";

export interface FieldSpec {
  type: FieldType;
  label: string;
  primary?: boolean;
  required?: boolean;
  /** When type === "ref" or "embed": slug of the target collection. */
  to?: string;
  /** When type === "embed": primary-key value of the fixed record
   *  pulled from `to` and rendered read-only in the detail view. */
  id?: string;
  /** When type === "money" (or derived/money): a literal ISO 4217
   *  currency, fixed for every record. */
  currency?: string;
  /** When type === "money" (or derived/money): name of a sibling
   *  record field holding the ISO code, so currency can vary per record. */
  currencyField?: string;
  /** When type === "enum": closed list of allowed string values. */
  values?: readonly string[];
  /** When type === "table": sub-schema for each row. */
  of?: Record<string, FieldSpec>;
  /** When type === "derived": formula evaluated against the record. */
  formula?: string;
  /** When type === "derived": render the computed value as this type. */
  display?: FieldType;
  /** Optional visibility predicate: render this field only when
   *  `String(record[when.field])` is one of `when.in`. */
  when?: { field: string; in: string[] };
  /** When type === "toggle": the `enum` field this checkbox projects
   *  (stores nothing itself — reads + writes that field). */
  field?: string;
  /** When type === "toggle": the enum value meaning "checked" (and written
   *  on check). */
  onValue?: string;
  /** When type === "toggle": the enum value written on uncheck. */
  offValue?: string;
}

/** A schema-declared, per-record action rendered as a button in the
 *  detail view. */
export interface CollectionAction {
  id: string;
  label: string;
  icon?: string;
  kind: "chat";
  role: string;
  template: string;
  when?: { field: string; in: string[] };
}

export interface CollectionSchema {
  title: string;
  icon: string;
  dataPath: string;
  primaryKey: string;
  /** When set, the collection is a singleton: at most one record whose
   *  primary key is fixed to this value. */
  singleton?: string;
  fields: Record<string, FieldSpec>;
  actions?: CollectionAction[];
  /** Name of the field whose value labels the record in notifications and
   *  the calendar chip (falls back to the primary key). */
  displayField?: string;
  /** Name of a `date` field anchoring the optional calendar view. When
   *  unset, the toggle still appears if any `date` field exists. */
  calendarField?: string;
  /** Name of a second `date` field marking the END of a multi-day span
   *  on the calendar. Requires `calendarField`. */
  calendarEndField?: string;
  /** Name of a string field holding a free-form time or time-range
   *  (e.g. "14:00-17:00", "17:00-", "16:30") used to place records on the
   *  day (time-allocation) view. Only consulted when the calendar date
   *  fields are date-only (a `datetime` anchor/end pair carries its own
   *  clock and takes precedence). Requires `calendarField`. */
  calendarTimeField?: string;
  /** Name of an `enum` field grouping records into columns on the optional
   *  Kanban board. When unset, the toggle still appears if any `enum` field
   *  exists (the first one, in declaration order, is the default and is
   *  switchable in-view). */
  kanbanField?: string;
  /** Optional predicate gating the completion bell (server-side); reuses
   *  the `when` shape. */
  notifyWhen?: { field: string; in: string[] };
  /** Present only on "feed" collections (the <workspace>/feeds/ registry):
   *  declarative retrieval config the host uses to refill the records.
   *  When set, the view shows a Refresh control. */
  ingest?: { kind: string; url: string; schedule: string };
}

export interface CollectionDetail {
  slug: string;
  title: string;
  icon: string;
  // "feed" = a data-source collection from the <workspace>/feeds/ registry.
  source: "user" | "project" | "feed";
  schema: CollectionSchema;
}

export type CollectionItem = Record<string, unknown>;

export interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
}

export interface ItemMutationResponse {
  itemId: string;
  item: CollectionItem;
}

/** One row of a `table`-typed field, in draft form. */
export interface TableRowDraft {
  text: Record<string, string>;
  bool: Record<string, boolean>;
  boolOriginallyPresent: Record<string, boolean>;
  boolTouched: Record<string, boolean>;
}

export interface EditState {
  mode: "create" | "edit";
  text: Record<string, string>;
  bool: Record<string, boolean>;
  boolOriginallyPresent: Record<string, boolean>;
  boolTouched: Record<string, boolean>;
  table: Record<string, TableRowDraft[]>;
  /** For edit mode: the original item id pinned to the URL. */
  originalId: string | null;
}

/** Per-target-collection cache: an item's primary-key slug → display label. */
export type RefDisplayMap = Record<string, string>;
export type RefCache = Record<string, RefDisplayMap>;

/** Per-target-collection cache of full referenced records, for
 *  `<field>.<col>` derefs in derived formulas. */
export type RefRecordMap = Record<string, CollectionItem>;
export type RefRecordCache = Record<string, RefRecordMap>;

/** Per-target cache for `embed` fields: the target collection's schema +
 *  items, kept in full so the detail view can render the embedded record. */
export interface EmbedTargetData {
  schema: CollectionSchema;
  items: CollectionItem[];
}
export type EmbedCache = Record<string, EmbedTargetData>;

/** Option shown in a `ref` field's `<select>` dropdown. */
export interface RefOption {
  slug: string;
  display: string;
}
