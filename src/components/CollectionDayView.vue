<template>
  <!-- Modal overlay: a time-allocation view of one day. Backdrop click and
       Escape close it; the detail panel below the calendar becomes visible
       again on close. -->
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
    data-testid="collection-day-view"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl" role="dialog" aria-modal="true">
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
                entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600 z-10' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              "
              :style="entry.style"
              :data-testid="`collection-day-view-chip-${entry.id}`"
              @click="onSelect(entry.id)"
            >
              <span class="block truncate text-[11px] font-semibold leading-tight">
                <span v-if="entry.slice.bleedsBefore" aria-hidden="true">▲ </span
                ><span v-if="entry.slice.kind === 'line'" class="tabular-nums opacity-70">{{ clock(entry.slice.startMin) }} </span>{{ entry.label }}
              </span>
              <span v-if="entry.slice.kind === 'block'" class="block truncate text-[10px] tabular-nums leading-tight opacity-80">
                {{ entry.timeText }}<span v-if="entry.slice.bleedsAfter" aria-hidden="true"> ▼</span>
              </span>
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

function clock(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

const labelField = computed<string | null>(() => labelFieldFor(props.schema));

interface DayEntry {
  id: string;
  label: string;
  slice: DaySlice;
}

// Every record whose span covers this day, projected onto it.
const dayEntries = computed<DayEntry[]>(() => {
  const { spans } = bucketRecords(props.items, props.anchorField, props.endField, props.timeField);
  const entries: DayEntry[] = [];
  for (const span of spans) {
    const slice = daySlice(span, props.day);
    if (slice) entries.push({ id: itemIdOf(span.item, props.schema), label: itemLabelOf(span.item, props.schema, labelField.value), slice });
  }
  return entries;
});

const allDayEntries = computed<DayEntry[]>(() => dayEntries.value.filter((entry) => entry.slice.kind === "allDay"));

interface TimedEntry extends DayEntry {
  timeText: string;
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
      timeText: `${clock(entry.slice.startMin)}–${clock(entry.slice.endMin)}`,
      style: {
        top: `${entry.slice.startMin * PX_PER_MIN}px`,
        height: `${heightPx}px`,
        left: `${lane * widthPct}%`,
        width: `calc(${widthPct}% - 3px)`,
      },
    };
  });
});

function onSelect(itemId: string): void {
  emit("select", itemId);
  emit("close");
}

function onCreate(): void {
  emit("createOn", dayKey.value);
  emit("close");
}

// Auto-scroll the timeline to the earliest timed event (less one hour of
// lead-in), so a day full of afternoon events doesn't open on empty morning.
onMounted(async () => {
  const earliest = timedEntries.value.reduce((min, entry) => Math.min(min, entry.slice.startMin), MINUTES_PER_DAY);
  if (earliest >= MINUTES_PER_DAY) return;
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = Math.max(0, (earliest - 60) * PX_PER_MIN);
});
</script>
