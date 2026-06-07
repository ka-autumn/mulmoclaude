<template>
  <div class="flex flex-col gap-3" data-testid="collection-calendar">
    <!-- Month nav -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
        :aria-label="t('collectionsView.calendarPrevMonth')"
        data-testid="collection-calendar-prev"
        @click="stepMonth(-1)"
      >
        <span class="material-icons text-lg">chevron_left</span>
      </button>
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 transition-colors"
        :aria-label="t('collectionsView.calendarNextMonth')"
        data-testid="collection-calendar-next"
        @click="stepMonth(1)"
      >
        <span class="material-icons text-lg">chevron_right</span>
      </button>
      <h3 class="text-sm font-bold text-slate-800 flex-1" data-testid="collection-calendar-month">{{ monthLabel }}</h3>
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold transition-colors"
        data-testid="collection-calendar-today"
        @click="goToday"
      >
        {{ t("collectionsView.calendarToday") }}
      </button>
    </div>

    <!-- Weekday header -->
    <div class="grid grid-cols-7 gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider select-none">
      <div v-for="(label, idx) in weekdayLabels" :key="idx" class="px-1 py-1 text-center">{{ label }}</div>
    </div>

    <!-- Day grid. Every cell is a keyboard-operable button that opens the day
         (time-allocation) view; its record chips are nested interactive
         elements that `@click.stop` to select instead. Creating a record now
         happens from inside the day view's + button. -->
    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="{ cell, entries } in cells"
        :key="cell.key"
        class="min-h-[5.5rem] rounded-lg border p-1 flex flex-col gap-1 overflow-hidden transition-colors cursor-pointer hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        :class="cell.inMonth ? 'bg-white border-slate-200' : 'bg-slate-50/50 border-slate-100'"
        role="button"
        :tabindex="0"
        :aria-label="t('collectionsView.dayViewOpen', { date: cell.key })"
        :data-testid="`collection-calendar-day-${cell.key}`"
        @click="openDay = cell.ymd"
        @keydown.enter.prevent="openDay = cell.ymd"
        @keydown.space.prevent="openDay = cell.ymd"
      >
        <div class="flex items-center justify-end">
          <span
            class="text-[11px] font-bold h-5 min-w-5 px-1 inline-flex items-center justify-center rounded-full"
            :class="cell.key === todayKey ? 'bg-indigo-600 text-white' : cell.inMonth ? 'text-slate-500' : 'text-slate-300'"
            >{{ cell.ymd.day }}</span
          >
        </div>
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          class="text-left text-[11px] leading-tight font-semibold truncate rounded px-1.5 py-0.5 border transition-colors"
          :class="entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'"
          :data-testid="`collection-calendar-chip-${entry.id}`"
          @click.stop="emit('select', entry.id)"
        >
          {{ entry.label }}
        </button>
      </div>
    </div>

    <!-- Records with no usable anchor date — listed rather than dropped. -->
    <div v-if="bucketed.noDate.length > 0" class="flex flex-wrap items-center gap-1.5 pt-1" data-testid="collection-calendar-no-date">
      <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">{{ t("collectionsView.calendarNoDate") }}</span>
      <button
        v-for="entry in undatedEntries"
        :key="entry.id"
        type="button"
        class="text-[11px] font-semibold truncate rounded px-1.5 py-0.5 border transition-colors"
        :class="entry.id === selected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'"
        :data-testid="`collection-calendar-undated-${entry.id}`"
        @click="emit('select', entry.id)"
      >
        {{ entry.label }}
      </button>
    </div>

    <!-- Day (time-allocation) popup, opened from a day-number badge. -->
    <CollectionDayView
      v-if="openDay"
      :schema="schema"
      :items="items"
      :day="openDay"
      :anchor-field="anchorField"
      :end-field="endField"
      :time-field="timeField"
      :selected="selected"
      :can-create="canCreate"
      @select="emit('select', $event)"
      @create-on="emit('createOn', $event)"
      @close="openDay = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { bucketRecords, buildMonthGrid, ymdKey, spanCoversDay, type Ymd } from "../utils/collections/calendarGrid";
import { labelFieldFor, itemIdOf, itemLabelOf } from "../utils/collections/itemLabel";
import CollectionDayView from "./CollectionDayView.vue";
import type { CollectionItem, CollectionSchema } from "./collectionTypes";

const props = defineProps<{
  schema: CollectionSchema;
  items: CollectionItem[];
  /** The `date`/`datetime` field whose value places each record on the grid. */
  anchorField: string;
  /** Optional second `date`/`datetime` field — records span anchor→end inclusive. */
  endField?: string;
  /** Optional free-form time-string field driving the day (time-allocation) view. */
  timeField?: string;
  /** Primary-key of the currently-open record (highlighted chip). */
  selected?: string;
  /** Whether empty-cell clicks create a record (Add gated for singletons). */
  canCreate: boolean;
}>();

const emit = defineEmits<{
  select: [id: string | null];
  createOn: [iso: string];
}>();

// The day whose time-allocation popup is open, or null. Opened from a day's
// number badge; re-emits select/createOn upward like the month grid does.
const openDay = ref<Ymd | null>(null);

const { t, locale } = useI18n();

// Visible month, 1-12. Initial value is the current local month — app
// code, so `new Date()` is fine (the pure grid helpers stay clock-free).
const now = new Date();
const viewYear = ref(now.getFullYear());
const viewMonth = ref(now.getMonth() + 1);

const todayKey = ymdKey({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });

const grid = computed(() => buildMonthGrid(viewYear.value, viewMonth.value));

const bucketed = computed(() => bucketRecords(props.items, props.anchorField, props.endField, props.timeField));

const labelField = computed<string | null>(() => labelFieldFor(props.schema));

interface CalendarEntry {
  id: string;
  label: string;
}

/** Records whose span covers a given day, in the bucket's start order. */
function recordsOnDay(day: Ymd): CalendarEntry[] {
  return bucketed.value.spans
    .filter((span) => spanCoversDay(span, day))
    .map((span) => ({ id: itemIdOf(span.item, props.schema), label: itemLabelOf(span.item, props.schema, labelField.value) }));
}

/** Grid cells paired with the records that land on them, computed once per
 *  render. Clicking any cell opens the day view (create happens there). */
const cells = computed(() => grid.value.map((cell) => ({ cell, entries: recordsOnDay(cell.ymd) })));

const undatedEntries = computed<CalendarEntry[]>(() =>
  bucketed.value.noDate.map((item) => ({ id: itemIdOf(item, props.schema), label: itemLabelOf(item, props.schema, labelField.value) })),
);

const monthLabel = computed<string>(() => {
  try {
    return new Intl.DateTimeFormat(locale.value, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(viewYear.value, viewMonth.value - 1, 1)),
    );
  } catch {
    return `${viewYear.value}-${String(viewMonth.value).padStart(2, "0")}`;
  }
});

/** Localized short weekday names, Sunday-first (matches the grid). */
const weekdayLabels = computed<string[]>(() => {
  try {
    const formatter = new Intl.DateTimeFormat(locale.value, { weekday: "short", timeZone: "UTC" });
    // 2024-01-07 is a Sunday — anchor the week there.
    return Array.from({ length: 7 }, (_, idx) => formatter.format(new Date(Date.UTC(2024, 0, 7 + idx))));
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }
});

function stepMonth(delta: number): void {
  const next = viewMonth.value + delta;
  if (next < 1) {
    viewMonth.value = 12;
    viewYear.value -= 1;
  } else if (next > 12) {
    viewMonth.value = 1;
    viewYear.value += 1;
  } else {
    viewMonth.value = next;
  }
}

function goToday(): void {
  viewYear.value = now.getFullYear();
  viewMonth.value = now.getMonth() + 1;
}
</script>
