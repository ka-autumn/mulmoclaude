// Detect whether an active skill is a launcher-managed preset (i.e.
// `data/skills/catalog/preset/<slug>/` has a copy of it). Used by the
// detail pane to swap the destructive Delete affordance for a
// non-destructive Unstar one — see View.vue.
//
// Why catalog membership rather than a `mc-` prefix heuristic:
// nothing in the writer pipeline (server/workspace/skills/writer.ts)
// blocks a user from naming a hand-rolled project skill `mc-foo`. The
// authoritative signal that "this activation is recoverable from the
// catalog" is the catalog entry itself, not the slug.
//
// If `catalogPresets` hasn't loaded yet (network in flight / failed)
// the helper returns `false` — i.e. the UI falls back to the Delete
// label, which is the safe default: it accurately warns about
// destructive intent even if the slug happens to be `mc-`-prefixed.

export interface PresetCatalogLookup {
  slug: string;
  source: string;
}

export function isPresetActivation(name: string | undefined, presets: readonly PresetCatalogLookup[]): boolean {
  if (!name) return false;
  return presets.some((entry) => entry.slug === name && entry.source === "preset");
}
