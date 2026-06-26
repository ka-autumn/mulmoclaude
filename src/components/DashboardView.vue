<template>
  <div class="h-full overflow-auto p-4" :class="{ 'select-none': isResizing || isReordering }" data-testid="dashboard-view">
    <!-- Empty state: no pinned collections yet. -->
    <div v-if="favoriteSlugs.length === 0" class="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
      <span class="material-icons text-4xl text-slate-300">dashboard</span>
      <p class="text-sm font-medium">{{ t("dashboard.empty") }}</p>
      <p class="text-xs">{{ t("dashboard.emptyHint") }}</p>
    </div>

    <!-- Two-column grid of favorite collections. Each tile shows a live
         embedded CollectionView in the tile's chosen view mode. Height is
         per grid ROW (both side-by-side tiles share it), set via the
         resize handle and stored positionally in the layout. -->
    <div v-else class="grid gap-4 sm:grid-cols-2" data-testid="dashboard-grid">
      <section
        v-for="(tile, index) in tiles"
        v-show="metaFor(tile.slug)"
        :key="tile.slug"
        class="flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm transition-opacity"
        :class="{ 'ring-2 ring-indigo-400': dropIndex === index && dragIndex !== index, 'opacity-50': dragIndex === index }"
        :data-dashboard-index="index"
        :data-testid="`dashboard-tile-${tile.slug}`"
      >
        <!-- Tile header: drag handle + title/icon (opens full view) + view picker. -->
        <header class="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
          <span
            class="material-icons text-base text-slate-400 cursor-grab select-none touch-none"
            :title="t('dashboard.dragHint')"
            :aria-label="t('dashboard.dragHint')"
            data-testid="dashboard-tile-drag"
            @pointerdown.prevent="onReorderStart(index, $event)"
            >drag_indicator</span
          >
          <button
            type="button"
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left text-sm font-semibold text-slate-700 hover:text-indigo-600"
            :title="t('dashboard.openFull')"
            @dblclick="openFull(tile.slug)"
          >
            <span class="material-symbols-outlined text-base flex-none">{{ metaFor(tile.slug)?.icon || "apps" }}</span>
            <span class="truncate">{{ metaFor(tile.slug)?.title || tile.slug }}</span>
          </button>
          <select
            class="flex-none text-xs bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            :value="effectiveView(tile)"
            :aria-label="t('dashboard.viewPickerLabel')"
            :data-testid="`dashboard-tile-view-${tile.slug}`"
            @change="onPickView(tile.slug, $event)"
          >
            <option v-for="mode in modesFor(tile.slug)" :key="mode" :value="mode">{{ modeLabel(tile.slug, mode) }}</option>
          </select>
        </header>
        <!-- Live embedded view. `:key` remounts the view when the mode
             changes so the new initial view takes effect. Height is the
             grid ROW's height (shared by both side-by-side tiles), set via
             the resize handle below. -->
        <div class="overflow-auto" :style="{ height: `${rowHeight(index)}px` }">
          <CollectionView
            :key="`${tile.slug}:${effectiveView(tile)}`"
            :slug="tile.slug"
            :initial-view="effectiveView(tile)"
            hide-view-toggle
            hide-header
            hide-search
          />
        </div>
        <!-- Resize handle: drag vertically to set this row's height. -->
        <div
          class="h-2 flex-none cursor-row-resize bg-slate-100 hover:bg-indigo-200 transition-colors flex items-center justify-center"
          :title="t('dashboard.resizeHint')"
          :aria-label="t('dashboard.resizeHint')"
          :data-testid="`dashboard-tile-resize-${tile.slug}`"
          @pointerdown.prevent="onResizeStart(index, $event)"
        >
          <span class="h-0.5 w-8 rounded-full bg-slate-300"></span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { CollectionView, applicableViewModes, customViewKey, type CollectionViewMode } from "@mulmoclaude/collection-plugin/vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useDashboard } from "../composables/useDashboard";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import type { DashboardTile } from "../types/dashboard";
import type { CollectionDetailResponse, CollectionSchema } from "./collectionTypes";

const { t } = useI18n();
const router = useRouter();

const { shortcuts, load: loadShortcuts } = useShortcuts();
const { tiles, rowHeights, load: loadDashboard, reconcile, setTiles, setViewMode, setRowHeight } = useDashboard();

// Favorites = pinned COLLECTION shortcuts (feeds are excluded — the
// dashboard is a collections surface). The cached title/icon ride along
// so a tile renders without an extra fetch.
const collectionFavorites = computed(() => shortcuts.value.filter((entry) => entry.kind === "collection"));
const favoriteSlugs = computed(() => collectionFavorites.value.map((entry) => entry.slug));
const metaFor = (slug: string) => collectionFavorites.value.find((entry) => entry.slug === slug);

// Per-slug schema, fetched lazily to drive each tile's view picker.
const schemas = ref<Record<string, CollectionSchema>>({});

async function loadSchema(slug: string): Promise<void> {
  if (schemas.value[slug]) return;
  const url = API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
  const result = await apiGet<CollectionDetailResponse>(url);
  if (result.ok) schemas.value = { ...schemas.value, [slug]: result.data.collection.schema };
}

function modesFor(slug: string): CollectionViewMode[] {
  const schema = schemas.value[slug];
  return schema ? applicableViewModes(schema) : ["table"];
}

/** The view a tile opens in: its stored mode when still applicable, else
 *  the first available mode (table). */
function effectiveView(tile: DashboardTile): CollectionViewMode {
  const modes = modesFor(tile.slug);
  return tile.viewMode && modes.includes(tile.viewMode as CollectionViewMode) ? (tile.viewMode as CollectionViewMode) : (modes[0] ?? "table");
}

const BUILTIN_LABEL_KEYS: Record<string, string> = {
  table: "dashboard.viewTable",
  calendar: "dashboard.viewCalendar",
  kanban: "dashboard.viewKanban",
};

function modeLabel(slug: string, mode: CollectionViewMode): string {
  const builtin = BUILTIN_LABEL_KEYS[mode];
  if (builtin) return t(builtin);
  // Custom view: use the author-authored label from the schema.
  const view = schemas.value[slug]?.views?.find((entry) => customViewKey(entry.id) === mode);
  return view?.label ?? mode;
}

function onPickView(slug: string, event: Event): void {
  const { value } = event.target as HTMLSelectElement;
  void setViewMode(slug, value);
}

function openFull(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

// ── Drag-to-reorder via pointer events. Native HTML5 DnD conflicted with
//    the embedded views' own card drag-and-drop (e.g. kanban), so drops
//    over a tile body were swallowed — pointer + elementFromPoint avoids
//    that entirely, the same robust approach as the row resize. ──
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);
const isReordering = ref(false);
let reorder: { startIndex: number; handle: HTMLElement; pointerId: number } | null = null;

/** The tile index under a viewport point, or null when over no tile. */
function tileIndexAtPoint(clientX: number, clientY: number): number | null {
  const section = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-dashboard-index]");
  if (!section) return null;
  const index = Number(section.dataset.dashboardIndex);
  return Number.isNaN(index) ? null : index;
}

function onReorderMove(event: PointerEvent): void {
  if (!reorder) return;
  event.preventDefault();
  dropIndex.value = tileIndexAtPoint(event.clientX, event.clientY);
}

function teardownReorder(): void {
  window.removeEventListener("pointermove", onReorderMove);
  window.removeEventListener("pointerup", onReorderEnd);
  window.removeEventListener("pointercancel", onReorderEnd);
  isReordering.value = false;
}

function onReorderEnd(): void {
  teardownReorder();
  if (!reorder) return;
  const { startIndex, handle, pointerId } = reorder;
  const target = dropIndex.value;
  reorder = null;
  dragIndex.value = null;
  dropIndex.value = null;
  try {
    handle.releasePointerCapture(pointerId);
  } catch {
    // Capture may already be gone (pointercancel) — ignore.
  }
  if (target === null || target === startIndex) return;
  const next = [...tiles.value];
  const [moved] = next.splice(startIndex, 1);
  next.splice(target, 0, moved);
  void setTiles(next);
}

function onReorderStart(index: number, event: PointerEvent): void {
  const handle = event.currentTarget as HTMLElement;
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture unsupported — fall back to plain window listeners.
  }
  reorder = { startIndex: index, handle, pointerId: event.pointerId };
  dragIndex.value = index;
  isReordering.value = true;
  window.addEventListener("pointermove", onReorderMove);
  window.addEventListener("pointerup", onReorderEnd);
  window.addEventListener("pointercancel", onReorderEnd);
}

// ── Drag-to-resize, per grid ROW (height is positional, not per tile) ──
const COLUMNS = 2; // matches the `sm:grid-cols-2` layout
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 900;

function rowOf(index: number): number {
  return Math.floor(index / COLUMNS);
}

// Live height during a drag (smooth, not yet persisted), keyed by row.
const liveRowHeights = ref<Record<number, number>>({});

function rowHeight(index: number): number {
  const row = rowOf(index);
  const live = liveRowHeights.value[row];
  if (live !== undefined) return live;
  const stored = rowHeights.value[row];
  return stored && stored > 0 ? stored : DEFAULT_HEIGHT;
}

// True while a drag is in progress — disables text selection so the drag
// doesn't accidentally select tile content.
const isResizing = ref(false);

interface ResizeState {
  row: number;
  startY: number;
  startHeight: number;
  handle: HTMLElement;
  pointerId: number;
}
let resize: ResizeState | null = null;
// Latest pointer Y, applied once per frame (rAF-coalesced) so a flood of
// pointermove events can't thrash re-renders of the embedded views.
let pendingY: number | null = null;
let rafId = 0;

function applyResize(): void {
  rafId = 0;
  if (!resize || pendingY === null) return;
  const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resize.startHeight + (pendingY - resize.startY)));
  liveRowHeights.value = { ...liveRowHeights.value, [resize.row]: next };
}

function onResizeMove(event: PointerEvent): void {
  if (!resize) return;
  event.preventDefault();
  pendingY = event.clientY;
  if (!rafId) rafId = requestAnimationFrame(applyResize);
}

function clearLiveRow(row: number): void {
  liveRowHeights.value = Object.fromEntries(Object.entries(liveRowHeights.value).filter(([key]) => Number(key) !== row));
}

// Persist the final height, then drop the live override so the stored
// value (now identical) takes over without a flash.
async function persistRowHeight(row: number, height: number): Promise<void> {
  await setRowHeight(row, Math.round(height));
  clearLiveRow(row);
}

function teardownResize(): void {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
  window.removeEventListener("pointercancel", onResizeEnd);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  pendingY = null;
  isResizing.value = false;
}

function onResizeEnd(): void {
  teardownResize();
  if (!resize) return;
  const { row, handle, pointerId } = resize;
  resize = null;
  try {
    handle.releasePointerCapture(pointerId);
  } catch {
    // Capture may already be gone (pointercancel) — ignore.
  }
  const height = liveRowHeights.value[row];
  if (height !== undefined) void persistRowHeight(row, height);
}

function onResizeStart(index: number, event: PointerEvent): void {
  const handle = event.currentTarget as HTMLElement;
  // Pointer capture routes every subsequent move/up to the handle even
  // when the cursor passes over the embedded view (incl. iframes), which
  // is what made the drag drop events and feel unstable.
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture unsupported — fall back to plain window listeners.
  }
  resize = { row: rowOf(index), startY: event.clientY, startHeight: rowHeight(index), handle, pointerId: event.pointerId };
  isResizing.value = true;
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeEnd);
  window.addEventListener("pointercancel", onResizeEnd);
}

onBeforeUnmount(() => {
  teardownResize();
  teardownReorder();
});

// First load: fold favorites into the stored layout once both lists are
// authoritatively loaded (so an empty pre-load list never prunes tiles).
onMounted(async () => {
  await Promise.all([loadShortcuts(), loadDashboard()]);
  await reconcile(favoriteSlugs.value);
});

// Later pin/unpin while on the page re-reconciles. Non-immediate so it
// can't fire on the empty pre-load list.
watch(favoriteSlugs, (slugs) => void reconcile(slugs));

// Fetch each tile's schema as the layout settles.
watch(tiles, (list) => list.forEach((tile) => void loadSchema(tile.slug)), { immediate: true });
</script>
