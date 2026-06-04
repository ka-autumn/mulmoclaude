// Per-collection view-mode preference (table | calendar | kanban) persisted
// to localStorage, keyed by collection slug. Lets the standalone
// `/collections/:slug` page reopen in the last-used view instead of always
// defaulting to "table". Embedded chat-card mode persists its own `viewState`
// in the tool result and does NOT use this.

export type CollectionViewMode = "table" | "calendar" | "kanban";

const STORAGE_KEY = "collection_view_modes";

const VIEW_MODES: readonly CollectionViewMode[] = ["table", "calendar", "kanban"];

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
  const stored = readAll()[slug];
  return stored && VIEW_MODES.includes(stored) ? stored : null;
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
