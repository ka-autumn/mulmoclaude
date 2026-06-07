<template>
  <!-- Modal overlay: a time-allocation view of one day. Backdrop click and
       Escape close it. Selecting a record expands the modal to two columns —
       the timeline on the left, the record's detail (the `#detail` slot) on
       the right. -->
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
    data-testid="collection-day-view"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div
      ref="dialogEl"
      tabindex="-1"
      class="flex max-h-[85vh] w-full flex-row rounded-2xl bg-white shadow-xl focus:outline-none"
      :class="showDetail ? 'max-w-4xl' : 'max-w-md'"
      role="dialog"
      aria-modal="true"
    >
      <!-- Left column: the time-allocation timeline. Shrinks to a fixed width
           when a record detail is shown alongside it, else fills the modal. -->
      <div class="flex min-h-0 flex-col" :class="showDetail ? 'w-80 shrink-0 border-r border-slate-200' : 'w-full'">
        <!-- Header -->
        <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h3 class="flex-1 text-sm font-bold text-slate-800" data-testid="collection-day-view-title">{{ dayLabel }}</h3>
          <button
            v-if="canCreate"
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
            :aria-label="t('collectionsView.calendarCreateOn', { date: dayKey })"
            data-testid="collection-day-view-create"
            @click="onCreate"
          >
            <span class="material-icons text-lg">add</span>
          </button>
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
            :aria-label="t('collectionsView.dayViewClose')"
            data-testid="collection-day-view-close"
            @click="emit('close')"
          >
            <span class="material-icons text-lg">close</span>
          </button>
        </div>

        <!-- Empty state -->
        <div v-if="timedEntries.length === 0 && allDayEntries.length === 0" class="px-4 py-10 text-center text-sm text-slate-400">
          {{ t("collectionsView.dayViewEmpty") }}
        </div>

        <!-- Timeline -->
        <div v-else ref="scrollEl" class="flex-1 overflow-y-auto px-2 py-2">
          <div class="relative" :style="{ height: `${TOTAL_HEIGHT}px` }" data-testid="collection-day-view-timeline">
            <!-- Hour gridlines + labels -->
            <div v-for="hour in 24" :key="hour" class="absolute left-0 right-0 border-t border-slate-100" :style="{ top: `${(hour - 1) * HOUR_PX}px` }">
              <span class="absolute -top-2 left-0 w-10 pr-1 text-right text-[10px] tabular-nums text-slate-400">{{ hourLabel(hour - 1) }}</span>
            </div>

            <!-- Event track (right of the hour gutter) -->
            <div class="absolute inset-y-0 right-0" style="left: 2.75rem">
              <button
                v-for="entry in timedEntries"
                :key="entry.id"
                type="button"
                class="absolute overflow-hidden rounded border px-1.5 py-0.5 text-left transition-colors"
                :class="
                  entry.id === selected
                    ? 'bg-indigo-600 text-white border-indigo-600 z-10'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                "
                :style="entry.style"
                :data-testid="`collection-day-view-chip-${entry.id}`"
                @click="onSelect(entry.id)"
              >
                <span class="block truncate text-[11px] font-semibold leading-tight">
                  <span v-if="entry.slice.bleedsBefore" aria-hidden="true">▲ </span>{{ entry.label
                  }}<span v-if="entry.slice.bleedsAfter" aria-hidden="true"> ▼</span>
                </span>
                <!-- A few non-date/time fields under the title. The chip's height
                     stays proportional to its duration; extra lines just clip. -->
                <span v-for="(text, i) in entry.secondary" :key="i" class="block truncate text-[10px] leading-tight opacity-70">{{ text }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- All-day strip (records with no clock) at the bottom -->
        <div
          v-if="allDayEntries.length > 0"
          class="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-4 py-2"
          data-testid="collection-day-view-all-day"
        >
          <span class="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ t("collectionsView.dayViewAllDay") }}</span>
          <button
            v-for="entry in allDayEntries"
            :key="entry.id"
            type="button"
            class="truncate rounded border px-1.5 py-0.5 text-[11px] font-semibold transition-colors"
            :class="entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'"
            :data-testid="`collection-day-view-allday-${entry.id}`"
            @click="onSelect(entry.id)"
          >
            {{ entry.label }}
          </button>
        </div>
      </div>

      <!-- Right column: the selected (or being-created) record's detail panel,
           supplied by the host so selection no longer hands off to a panel
           below the calendar. -->
      <div v-if="showDetail" class="min-w-0 flex-1 overflow-y-auto" data-testid="collection-day-view-detail">
        <slot name="detail" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { bucketRecords, daySlice, assignLanes, ymdKey, MINUTES_PER_DAY, type Ymd, type DaySlice } from "../utils/collections/calendarGrid";
import { labelFieldFor, itemIdOf, itemLabelOf } from "../utils/collections/itemLabel";
import type { CollectionItem, CollectionSchema } from "./collectionTypes";

const props = defineProps<{
  schema: CollectionSchema;
  items: CollectionItem[];
  day: Ymd;
  anchorField: string;
  endField?: string;
  timeField?: string;
  selected?: string;
  canCreate: boolean;
  /** When true, expand the modal to two columns and render the `#detail`
   *  slot (the selected/created record) to the right of the timeline. */
  showDetail?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  createOn: [iso: string];
  close: [];
}>();

const { t, locale } = useI18n();

// One hour = 48px tall; the full day is 24 of them. A point-in-time event
// (start, no end) has no duration to size by, so it gets a fixed one-line-tall
// box (`LINE_PX`) — enough to read its time + label — and a `LANE_MIN_MINUTES`
// footprint so two near-simultaneous events still split into lanes.
const HOUR_PX = 48;
const TOTAL_HEIGHT = HOUR_PX * 24;
const PX_PER_MIN = HOUR_PX / 60;
const MIN_BLOCK_PX = 16;
const LINE_PX = 20;
const LANE_MIN_MINUTES = 30;

const scrollEl = ref<HTMLElement | null>(null);
const dialogEl = ref<HTMLElement | null>(null);

const dayKey = computed<string>(() => ymdKey(props.day));

const dayLabel = computed<string>(() => {
  try {
    return new Intl.DateTimeFormat(locale.value, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(props.day.year, props.day.month - 1, props.day.day)),
    );
  } catch {
    return dayKey.value;
  }
});

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const labelField = computed<string | null>(() => labelFieldFor(props.schema));

// Field types with no compact inline representation for a chip subtitle.
const CHIP_SKIP_TYPES = new Set<string>(["date", "datetime", "table", "embed", "image", "markdown"]);
const MAX_CHIP_FIELDS = 3;

/** A few scalar field values to show under a chip's title — excludes the label
 *  (already the title), the primary key, the date/time fields that position the
 *  record, and non-scalar field types. */
function secondaryFieldsOf(item: CollectionItem): string[] {
  const out: string[] = [];
  for (const [key, field] of Object.entries(props.schema.fields)) {
    if (out.length >= MAX_CHIP_FIELDS) break;
    if (key === props.schema.primaryKey || key === labelField.value) continue;
    if (key === props.anchorField || key === props.endField || key === props.timeField) continue;
    if (CHIP_SKIP_TYPES.has(field.type)) continue;
    const value = item[key];
    if (value === undefined || value === null || typeof value === "object") continue;
    const text = String(value);
    if (text.length > 0) out.push(text);
  }
  return out;
}

interface DayEntry {
  id: string;
  label: string;
  secondary: string[];
  slice: DaySlice;
}

// Every record whose span covers this day, projected onto it.
const dayEntries = computed<DayEntry[]>(() => {
  const { spans } = bucketRecords(props.items, props.anchorField, props.endField, props.timeField);
  const entries: DayEntry[] = [];
  for (const span of spans) {
    const slice = daySlice(span, props.day);
    if (!slice) continue;
    entries.push({
      id: itemIdOf(span.item, props.schema),
      label: itemLabelOf(span.item, props.schema, labelField.value),
      secondary: secondaryFieldsOf(span.item),
      slice,
    });
  }
  return entries;
});

const allDayEntries = computed<DayEntry[]>(() => dayEntries.value.filter((entry) => entry.slice.kind === "allDay"));

interface TimedEntry extends DayEntry {
  style: Record<string, string>;
}

const timedEntries = computed<TimedEntry[]>(() => {
  const timed = dayEntries.value.filter((entry) => entry.slice.kind !== "allDay");
  const lanes = assignLanes(
    timed.map((entry) => ({ startMin: entry.slice.startMin, endMin: Math.max(entry.slice.endMin, entry.slice.startMin + LANE_MIN_MINUTES) })),
  );
  return timed.map((entry, index) => {
    const { lane, lanes: laneCount } = lanes[index];
    const widthPct = 100 / laneCount;
    const heightPx = entry.slice.kind === "line" ? LINE_PX : Math.max((entry.slice.endMin - entry.slice.startMin) * PX_PER_MIN, MIN_BLOCK_PX);
    return {
      ...entry,
      style: {
        top: `${entry.slice.startMin * PX_PER_MIN}px`,
        height: `${heightPx}px`,
        left: `${lane * widthPct}%`,
        width: `calc(${widthPct}% - 3px)`,
      },
    };
  });
});

// Select a record: report it to the host (which shows it in the right pane).
// Unlike before, the modal stays open so the timeline and detail sit
// side-by-side and the user can hop between records.
function onSelect(itemId: string): void {
  emit("select", itemId);
}

// Start a create for this day. The popup stays open so the new-item form
// renders in the right pane (like the open/edit detail) — closing here would
// drop the form to the panel below the grid.
function onCreate(): void {
  emit("createOn", dayKey.value);
}

// On open: move focus into the dialog (so Escape/Tab act on the modal, not the
// background day cell), then auto-scroll the timeline to the earliest timed
// event (less one hour of lead-in) so an afternoon-heavy day doesn't open on
// an empty morning.
onMounted(async () => {
  await nextTick();
  dialogEl.value?.focus();
  const earliest = timedEntries.value.reduce((min, entry) => Math.min(min, entry.slice.startMin), MINUTES_PER_DAY);
  if (earliest >= MINUTES_PER_DAY) return;
  if (scrollEl.value) scrollEl.value.scrollTop = Math.max(0, (earliest - 60) * PX_PER_MIN);
});
</script>
