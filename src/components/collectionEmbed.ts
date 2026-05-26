// View model for an `embed` field — a fixed record from another
// collection rendered read-only. Shared between CollectionView (which
// resolves the model from the embedCache) and CollectionEmbedView
// (which renders it), so both the detail modal and the edit form draw
// the embed identically.

export interface EmbedRow {
  /** Sub-field key (used for `:key` + testids). */
  key: string;
  label: string;
  /** Sub-field type — the renderer branches on "boolean" / "markdown". */
  type: string;
  /** Raw value, used only for the boolean check / em-dash. */
  value: unknown;
  /** Pre-formatted string for every non-boolean render path. */
  display: string;
}

export interface EmbedView {
  /** False when the target collection has no record with the embed's
   *  `id` (or the target couldn't be loaded) — the renderer shows a
   *  "missing" message + a link to create it. */
  found: boolean;
  rows: EmbedRow[];
  /** Target collection slug, for the "create it" link + message. */
  targetSlug: string;
  /** The fixed record id the embed points at, for the message. */
  recordId: string;
}
