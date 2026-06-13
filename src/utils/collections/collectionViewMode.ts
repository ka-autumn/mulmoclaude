// Per-collection view preferences (the view mode, and the table's active
// column sort) persisted to localStorage, keyed by collection slug. Lets the
// standalone `/collections/:slug` page reopen in the last-used view and sort
// instead of resetting. Embedded chat cards seed from these but persist their
// own copy in the tool-result `viewState` (they read, never write — so a
// stale card can't clobber the shared preference).

import type { SortState } from "./sortItems";

/** The host's built-in, field-derived view modes. */
export type BuiltInViewMode = "table" | "calendar" | "kanban";
/** A custom (LLM-authored) view's selector key: `custom:<viewId>`. */
export type CustomViewMode = `custom:${string}`;
export type CollectionViewMode = BuiltInViewMode | CustomViewMode;

const STORAGE_KEY = "collection_view_modes";
const SORT_STORAGE_KEY = "collection_sorts";

const BUILT_IN_MODES: readonly BuiltInViewMode[] = ["table", "calendar", "kanban"];

/** A persisted mode is valid if it's a known built-in OR any `custom:<id>`
 *  key (the id is validated against the live schema at render time, so an
 *  unknown custom id simply collapses to the table there). Takes `unknown`
 *  and type-guards `string` first: a corrupted localStorage entry could hold a
 *  number/object, and calling `.startsWith` on that would throw. */
function isValidViewMode(value: unknown): value is CollectionViewMode {
  return typeof value === "string" && (BUILT_IN_MODES.includes(value as BuiltInViewMode) || value.startsWith("custom:"));
}

type ViewModeMap = Record<string, CollectionViewMode>;

function readAll(): ViewModeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Plain object only — an array would pass `typeof === "object"` and then
    // let writeCollectionViewMode write string keys onto it.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ViewModeMap) : {};
  } catch {
    return {};
  }
}

export function readCollectionViewMode(slug: string): CollectionViewMode | null {
  const stored: unknown = readAll()[slug];
  return isValidViewMode(stored) ? stored : null;
}

export function writeCollectionViewMode(slug: string, view: CollectionViewMode): void {
  try {
    const all = readAll();
    all[slug] = view;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable / quota exceeded — the preference is
    // best-effort, so silently skip rather than break the view.
  }
}

// ── Active column sort (table view) ──────────────────────────────────

type SortMap = Record<string, SortState>;

function isSortState(value: unknown): value is SortState {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.field === "string" && (rec.direction === "asc" || rec.direction === "desc");
}

function readAllSorts(): SortMap {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Drop any entry whose stored shape no longer validates (e.g. a schema
    // whose field was renamed away leaves a stale value) so callers only ever
    // see a well-formed SortState.
    const out: SortMap = {};
    for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSortState(value)) out[slug] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readCollectionSort(slug: string): SortState | null {
  return readAllSorts()[slug] ?? null;
}

/** Persist (or, when `sort` is null, clear) the slug's active column sort. */
export function writeCollectionSort(slug: string, sort: SortState | null): void {
  try {
    // Rebuild without the slug rather than `delete all[slug]` (dynamic-delete),
    // then re-add it when a sort is set — clearing leaves no stale key behind.
    const all = Object.fromEntries(Object.entries(readAllSorts()).filter(([key]) => key !== slug));
    if (sort) all[slug] = sort;
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort, same as the view-mode store.
  }
}
