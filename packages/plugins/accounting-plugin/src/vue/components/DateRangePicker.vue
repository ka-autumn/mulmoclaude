<template>
  <!-- Reusable from/to + shortcut date range picker. Owns no state
       beyond the v-model; the parent supplies an initial range and
       the active book's fiscalYearEnd so quarter/year shortcuts
       resolve under the right calendar. -->
  <div class="flex flex-wrap items-end gap-2" data-testid="accounting-daterange">
    <label class="text-xs text-gray-500 flex flex-col gap-1">
      {{ t("pluginAccounting.dateRange.shortcutLabel") }}
      <select
        :value="selectedShortcut"
        class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
        data-testid="accounting-daterange-shortcut"
        @change="onShortcutChange(($event.target as HTMLSelectElement).value)"
      >
        <!-- Sentinel for the "custom" state. Hidden from the menu
             but bound when the current range doesn't match any
             preset, which leaves the trigger displaying blank
             instead of forcing a wrong-looking match. -->
        <option value="" hidden></option>
        <option value="currentQuarter">{{ t("pluginAccounting.dateRange.currentQuarter") }}</option>
        <option value="previousQuarter">{{ t("pluginAccounting.dateRange.previousQuarter") }}</option>
        <option value="currentYear">{{ t("pluginAccounting.dateRange.currentYear") }}</option>
        <option value="previousYear">{{ t("pluginAccounting.dateRange.previousYear") }}</option>
        <option v-if="hasOpeningDate" value="lifetime">{{ t("pluginAccounting.dateRange.lifetime") }}</option>
        <option value="all">{{ t("pluginAccounting.dateRange.all") }}</option>
      </select>
    </label>
    <label class="text-xs text-gray-500 flex flex-col gap-1">
      {{ t("pluginAccounting.dateRange.fromLabel") }}
      <input
        :value="modelValue.from"
        type="date"
        class="h-8 px-2 rounded border border-gray-300 text-sm"
        data-testid="accounting-daterange-from"
        @input="onFromChange(($event.target as HTMLInputElement).value)"
      />
    </label>
    <label class="text-xs text-gray-500 flex flex-col gap-1">
      {{ t("pluginAccounting.dateRange.toLabel") }}
      <input
        :value="modelValue.to"
        type="date"
        class="h-8 px-2 rounded border border-gray-300 text-sm"
        data-testid="accounting-daterange-to"
        @input="onToChange(($event.target as HTMLInputElement).value)"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  currentFiscalYearRange,
  currentQuarterRange,
  previousFiscalYearRange,
  previousQuarterRange,
  type DateRange,
  type FiscalYearEnd,
  localDateString,
} from "../../shared";

const { t } = useI18n();

const props = defineProps<{
  modelValue: DateRange;
  fiscalYearEnd: FiscalYearEnd;
  /** The active book's opening-balance date. Drives the "Lifetime"
   *  shortcut (from = openingDate, to = today). Optional — when
   *  absent the Lifetime option is hidden from the menu. The opening
   *  gate prevents the tabs that mount this picker from rendering
   *  before an opening exists, so in normal use this stays defined. */
  openingDate?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [DateRange];
}>();

const hasOpeningDate = computed<boolean>(() => Boolean(props.openingDate));

const UNBOUNDED_RANGE: DateRange = { from: "", to: "" };

/** From the book's opening date through today. Hidden from the menu
 *  when the parent hasn't supplied an opening. */
function lifetimeRange(): DateRange | null {
  if (!props.openingDate) return null;
  return { from: props.openingDate, to: localDateString() };
}

type Shortcut = "currentQuarter" | "previousQuarter" | "currentYear" | "previousYear" | "lifetime" | "all";
/** Empty string is the sentinel "no preset matches" value bound to
 *  the hidden option in the template — the trigger shows blank. */
type SelectedShortcut = Shortcut | "";

function rangesEqual(left: DateRange, right: DateRange): boolean {
  return left.from === right.from && left.to === right.to;
}

// Resolve the dropdown's displayed value from the current
// modelValue. Re-evaluates today on every read — the picker is a
// short-lived UI surface so cache invalidation isn't a concern, and
// the user has no expectation that "current quarter" picked in the
// morning still labels correctly at midnight. Returns "" when no
// preset matches (custom range from manual from/to edits).
//
// Order matters when ranges collide: when no opening is on file the
// Lifetime option is hidden from the menu, but if it ever produced
// the same span as another preset (it can't — Lifetime spans years,
// presets span quarter/year), the earlier branch would win. We
// check the explicit ranges first and fall through to the unbounded
// "all" last so a manually-cleared input lands on "all" rather than
// blank when both sides happen to be empty.
const selectedShortcut = computed<SelectedShortcut>(() => {
  const value = props.modelValue;
  const today = new Date();
  if (rangesEqual(value, currentQuarterRange(props.fiscalYearEnd, today))) return "currentQuarter";
  if (rangesEqual(value, previousQuarterRange(props.fiscalYearEnd, today))) return "previousQuarter";
  if (rangesEqual(value, currentFiscalYearRange(props.fiscalYearEnd, today))) return "currentYear";
  if (rangesEqual(value, previousFiscalYearRange(props.fiscalYearEnd, today))) return "previousYear";
  const lifetime = lifetimeRange();
  if (lifetime && rangesEqual(value, lifetime)) return "lifetime";
  if (rangesEqual(value, UNBOUNDED_RANGE)) return "all";
  return "";
});

function onShortcutChange(raw: string): void {
  const today = new Date();
  if (raw === "currentQuarter") emit("update:modelValue", currentQuarterRange(props.fiscalYearEnd, today));
  else if (raw === "previousQuarter") emit("update:modelValue", previousQuarterRange(props.fiscalYearEnd, today));
  else if (raw === "currentYear") emit("update:modelValue", currentFiscalYearRange(props.fiscalYearEnd, today));
  else if (raw === "previousYear") emit("update:modelValue", previousFiscalYearRange(props.fiscalYearEnd, today));
  else if (raw === "lifetime") {
    const lifetime = lifetimeRange();
    if (lifetime) emit("update:modelValue", lifetime);
  } else if (raw === "all") emit("update:modelValue", UNBOUNDED_RANGE);
}

function onFromChange(value: string): void {
  emit("update:modelValue", { from: value, to: props.modelValue.to });
}

function onToChange(value: string): void {
  emit("update:modelValue", { from: props.modelValue.from, to: value });
}
</script>
