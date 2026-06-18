// Collection view-state / response types — used by the View components, the
// record panel, the rendering composable, and the draft helper. Pure types
// (no Vue, no Node); kept in the core so both the host and MulmoTerminal share
// them. The host's src/components/collectionTypes.ts re-exports these.

import type { CollectionDetail, CollectionItem, CollectionSchema } from "./schema";

/** A record file the server couldn't load or that violates the schema —
 *  silently skipped at read time (mirror of the server `RecordIssue`). */
export interface CollectionRecordIssue {
  /** Record filename, e.g. `lesson-003.json`. */
  file: string;
  /** Human-readable problem, written to be actionable by the LLM. */
  problem: string;
}

export interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
  /** Record files that failed validation; drives the in-view Repair prompt. */
  issues?: CollectionRecordIssue[];
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

/** Per-target-collection cache of full referenced records, for `<field>.<col>`
 *  derefs in derived formulas. */
export type RefRecordMap = Record<string, CollectionItem>;
export type RefRecordCache = Record<string, RefRecordMap>;

/** Per-target cache for `embed` fields: the target collection's schema + items. */
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
