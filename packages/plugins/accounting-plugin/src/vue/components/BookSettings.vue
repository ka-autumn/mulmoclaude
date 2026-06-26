<template>
  <div class="flex flex-col gap-4" data-testid="accounting-settings">
    <section class="border border-gray-200 rounded p-3 flex flex-col gap-2">
      <h4 class="text-sm font-semibold">{{ t("pluginAccounting.settings.bookInfo") }}</h4>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.bookInfoExplain") }}</p>
      <label class="text-sm flex flex-col gap-1">
        {{ t("pluginAccounting.bookSwitcher.nameLabel") }}
        <input
          v-model="selectedName"
          type="text"
          class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
          data-testid="accounting-settings-name"
          :disabled="updating"
          maxlength="200"
        />
      </label>
      <dl class="text-xs text-gray-700 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt class="text-gray-500">{{ t("pluginAccounting.bookSwitcher.currencyLabel") }}</dt>
        <dd>{{ currency }}</dd>
      </dl>
      <label class="text-sm flex flex-col gap-1 mt-1">
        {{ t("pluginAccounting.bookSwitcher.countryLabel") }}
        <select
          v-model="selectedCountry"
          class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
          data-testid="accounting-settings-country"
          :disabled="updating"
        >
          <option value="">{{ t("pluginAccounting.settings.countryUnset") }}</option>
          <option v-for="opt in countryOptions" :key="opt.code" :value="opt.code">{{ opt.label }}</option>
        </select>
      </label>
      <label class="text-sm flex flex-col gap-1 mt-1">
        {{ t("pluginAccounting.bookSwitcher.fiscalYearEndLabel") }}
        <select
          v-model="selectedFiscalYearEnd"
          class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
          data-testid="accounting-settings-fiscal-year-end"
          :disabled="updating"
        >
          <option v-for="opt in fiscalYearEndOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.fiscalYearEndExplain") }}</p>
      <p v-if="updateOk" class="text-xs text-green-600" data-testid="accounting-settings-update-ok">{{ updateOk }}</p>
      <p v-if="updateError" class="text-xs text-red-500" data-testid="accounting-settings-update-error">{{ updateError }}</p>
      <div>
        <button
          class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
          :disabled="updating || !hasPendingChanges"
          data-testid="accounting-settings-save"
          @click="onSaveBookInfo"
        >
          {{ updating ? t("pluginAccounting.common.loading") : t("pluginAccounting.settings.saveChanges") }}
        </button>
      </div>
    </section>
    <section class="border border-gray-200 rounded p-3 flex flex-col gap-2">
      <h4 class="text-sm font-semibold">{{ t("pluginAccounting.settings.rebuild") }}</h4>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.rebuildExplain") }}</p>
      <p v-if="rebuildOk" class="text-xs text-green-600" data-testid="accounting-settings-rebuild-ok">{{ rebuildOk }}</p>
      <p v-if="rebuildError" class="text-xs text-red-500" data-testid="accounting-settings-rebuild-error">{{ rebuildError }}</p>
      <div>
        <button
          class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
          :disabled="rebuilding"
          data-testid="accounting-settings-rebuild"
          @click="onRebuild"
        >
          {{ rebuilding ? t("pluginAccounting.common.loading") : t("pluginAccounting.settings.rebuild") }}
        </button>
      </div>
    </section>
    <div v-if="!showAdvanced">
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-settings-advanced"
        @click="showAdvanced = true"
      >
        <span class="material-icons text-base">expand_more</span>
        <span>{{ t("pluginAccounting.settings.advanced") }}</span>
      </button>
    </div>
    <section v-if="showAdvanced" class="border border-red-300 rounded p-3 flex flex-col gap-2">
      <h4 class="text-sm font-semibold text-red-700">{{ t("pluginAccounting.settings.deleteBook") }}</h4>
      <p class="text-xs text-gray-500">{{ t("pluginAccounting.settings.deleteBookExplain") }}</p>
      <p v-if="deleteError" class="text-xs text-red-500" data-testid="accounting-settings-delete-error">{{ deleteError }}</p>
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.settings.deleteBookConfirm", { bookName: bookName }) }}
        <input v-model="confirmName" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-settings-delete-confirm" />
      </label>
      <div>
        <button
          class="h-8 px-3 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
          :disabled="confirmName !== bookName || deleting"
          data-testid="accounting-settings-delete"
          @click="onDelete"
        >
          {{ deleting ? t("pluginAccounting.common.loading") : t("pluginAccounting.settings.deleteBookButton") }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { deleteBook, rebuildSnapshots, updateBook } from "../api";
import {
  SUPPORTED_COUNTRY_CODES,
  isSupportedCountryCode,
  localizedCountryName,
  type SupportedCountryCode,
  DEFAULT_FISCAL_YEAR_END,
  FISCAL_YEAR_ENDS,
  resolveFiscalYearEnd,
  type FiscalYearEnd,
} from "../../shared";

const { t, locale } = useI18n();

const props = defineProps<{
  bookId: string;
  bookName: string;
  currency: string;
  country?: SupportedCountryCode;
  fiscalYearEnd?: FiscalYearEnd;
}>();
const emit = defineEmits<{ deleted: [bookName: string]; "books-changed": [] }>();

const rebuilding = ref(false);
const rebuildOk = ref<string | null>(null);
const rebuildError = ref<string | null>(null);
const deleting = ref(false);
const deleteError = ref<string | null>(null);
const confirmName = ref("");
const updating = ref(false);
const updateOk = ref<string | null>(null);
const updateError = ref<string | null>(null);
const showAdvanced = ref(false);
const selectedName = ref<string>(props.bookName);
const selectedCountry = ref<string>(props.country ?? "");
// Resolved at the boundary so the dropdown always shows a concrete
// value — books without a `fiscalYearEnd` field on disk land here as
// the default Q4 (matches the back-compat read policy).
const selectedFiscalYearEnd = ref<FiscalYearEnd>(props.fiscalYearEnd ?? DEFAULT_FISCAL_YEAR_END);

interface CountryOption {
  code: string;
  label: string;
}

const countryOptions = computed<CountryOption[]>(() =>
  SUPPORTED_COUNTRY_CODES.map((code) => ({
    code,
    label: `${code} — ${localizedCountryName(code, locale.value)}`,
  })),
);

interface FiscalYearEndOption {
  value: FiscalYearEnd;
  label: string;
}

const fiscalYearEndOptions = computed<FiscalYearEndOption[]>(() =>
  FISCAL_YEAR_ENDS.map((value) => ({
    value,
    label: t(`pluginAccounting.bookSwitcher.fiscalYearEnd${value}`),
  })),
);

const hasPendingChanges = computed<boolean>(() => {
  // Compare against the trimmed value so a no-op edit (typing then
  // backspacing back to the original) doesn't keep the Save button
  // hot. Server-side validateUpdateBookInput rejects empty / whitespace
  // names with a 400 — the disabled binding below mirrors that contract
  // so the button can't fire a doomed request.
  const nameChanged = selectedName.value.trim() !== props.bookName;
  const nameValid = selectedName.value.trim().length > 0;
  const countryChanged = selectedCountry.value !== (props.country ?? "");
  const fiscalChanged = selectedFiscalYearEnd.value !== resolveFiscalYearEnd(props.fiscalYearEnd);
  return nameValid && (nameChanged || countryChanged || fiscalChanged);
});

async function onRebuild(): Promise<void> {
  rebuilding.value = true;
  rebuildOk.value = null;
  rebuildError.value = null;
  try {
    const result = await rebuildSnapshots(props.bookId);
    if (!result.ok) {
      rebuildError.value = result.error;
      return;
    }
    rebuildOk.value = t("pluginAccounting.settings.rebuildOk", { count: result.data.rebuilt.length });
  } finally {
    rebuilding.value = false;
  }
}

async function onSaveBookInfo(): Promise<void> {
  if (updating.value) return;
  updating.value = true;
  updateOk.value = null;
  updateError.value = null;
  try {
    // The select v-model is a plain `string` (HTML form value); narrow
    // it back to the union before handing it to the API helper. The
    // empty string is the sentinel that clears the country server-side.
    const rawCountry = selectedCountry.value;
    const country: SupportedCountryCode | "" = rawCountry === "" || isSupportedCountryCode(rawCountry) ? rawCountry : "";
    const result = await updateBook({
      bookId: props.bookId,
      name: selectedName.value.trim(),
      country,
      fiscalYearEnd: selectedFiscalYearEnd.value,
    });
    if (!result.ok) {
      updateError.value = result.error;
      return;
    }
    updateOk.value = t("pluginAccounting.settings.updateOk");
    emit("books-changed");
  } finally {
    updating.value = false;
  }
}

async function onDelete(): Promise<void> {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    const result = await deleteBook(props.bookId);
    if (!result.ok) {
      deleteError.value = result.error;
      return;
    }
    emit("deleted", props.bookName);
    emit("books-changed");
  } finally {
    deleting.value = false;
  }
}

// Reset feedback / confirmation AND the dropdown selection when the
// user navigates between books while this tab is open. Without the
// `selectedCountry` reset, switching from book A (country=JP) to
// book B (also country=JP) leaves a previously-typed unsaved value
// staged on B — a save would then misattribute the edit.
watch(
  () => props.bookId,
  () => {
    rebuildOk.value = null;
    rebuildError.value = null;
    deleteError.value = null;
    confirmName.value = "";
    updateOk.value = null;
    updateError.value = null;
    selectedName.value = props.bookName;
    selectedCountry.value = props.country ?? "";
    selectedFiscalYearEnd.value = props.fiscalYearEnd ?? DEFAULT_FISCAL_YEAR_END;
    showAdvanced.value = false;
  },
);

// Follow external bookName updates — e.g. an LLM-driven updateBook in
// another tab, or pubsub-driven refetch. Without this, an out-of-band
// rename leaves a stale draft staged in the input.
watch(
  () => props.bookName,
  (next) => {
    selectedName.value = next;
  },
);

watch(
  () => props.country,
  (next) => {
    selectedCountry.value = next ?? "";
  },
);

watch(
  () => props.fiscalYearEnd,
  (next) => {
    selectedFiscalYearEnd.value = next ?? DEFAULT_FISCAL_YEAR_END;
  },
);
</script>
