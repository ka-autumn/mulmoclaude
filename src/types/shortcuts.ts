// Shared shape for a launcher shortcut (pinned collection / feed).
//
// A shortcut is a thin, generic record — it carries NO collection- or
// feed-specific logic. `kind` selects which existing route family the
// host navigates to (`/collections/:slug` or `/feeds/:slug`), and
// `title` / `icon` are cached at pin time so the launcher renders
// without re-fetching every index. A stale cached label (collection
// renamed) is acceptable; it self-heals on the next index visit.
//
// Browser-safe (no Node imports) so both the Vue frontend and the
// Express server can import this single definition.

/** Which route family a shortcut points at. */
export const SHORTCUT_KINDS = ["collection", "feed"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

export interface Shortcut {
  /** Which route family — drives `router.push({ name: kind, ... })`. */
  kind: ShortcutKind;
  /** The `:slug` route param for the target collection / feed. */
  slug: string;
  /** Cached display label (user-named) — refreshed on reconcile. */
  title: string;
  /** Cached material-symbols glyph — refreshed on reconcile. */
  icon: string;
}

/** On-disk shape of `config/shortcuts.json`. Object wrapper (not a
 *  bare array) so the schema can grow without a migration. */
export interface ShortcutsFile {
  shortcuts: Shortcut[];
}

/** True when two shortcuts target the same thing (the dedupe key). */
export function sameShortcut(left: Pick<Shortcut, "kind" | "slug">, right: Pick<Shortcut, "kind" | "slug">): boolean {
  return left.kind === right.kind && left.slug === right.slug;
}
