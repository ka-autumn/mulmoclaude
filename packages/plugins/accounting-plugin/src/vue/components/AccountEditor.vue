<template>
  <!-- Inline editor used by AccountsModal both for "Edit" on an
       existing row and per-section "+ Add" buttons. The parent
       owns the open/closed state and the draft instance — this
       component is dumb, but it runs realtime per-field validation
       (red border) so the user gets feedback before clicking Save. -->
  <form
    class="flex flex-col gap-2 p-2 border border-blue-200 bg-blue-50/40 rounded text-sm"
    :data-testid="isNew ? 'accounting-accounts-form-new' : `accounting-accounts-form-edit-${draft.code}`"
    @submit.prevent="onSubmit"
  >
    <div class="flex flex-wrap gap-2">
      <label class="text-xs text-gray-500 flex flex-col gap-1 w-28">
        {{ t("pluginAccounting.accounts.columnCode") }}
        <!-- New accounts: leading digit is fixed by type, so the
             editable input is restricted to the trailing 3 digits.
             The prefix span communicates the rule visually without
             needing a separate help string. -->
        <!-- The trailing-3-digit input has `outline-none bg-transparent`
             so the prefix span and the editable digits read as one
             pill. That removes the browser's default focus indicator,
             so we surface it on the wrapper via `focus-within:ring-1`
             — same shape as the name input below — to keep the field
             keyboard-discoverable (#1115 review). -->
        <div
          v-if="isNew"
          :class="[
            'flex items-stretch h-8 rounded border bg-white text-sm font-mono overflow-hidden',
            codeError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300 focus-within:ring-1 focus-within:ring-blue-500',
          ]"
        >
          <span
            class="px-2 flex items-center bg-gray-100 text-gray-500 border-r border-gray-200 select-none"
            data-testid="accounting-accounts-form-code-prefix"
            >{{ codePrefix }}</span
          >
          <input
            v-model="codeTrailing"
            type="text"
            inputmode="numeric"
            maxlength="3"
            pattern="\d{3}"
            class="px-2 grow w-0 outline-none bg-transparent"
            data-testid="accounting-accounts-form-code"
            @input="codeTouched = true"
          />
        </div>
        <!-- Edit: code is immutable, so we display the actual stored
             value as a single disabled field rather than splitting
             prefix + trailing (legacy non-4-digit codes would
             otherwise be misrendered). -->
        <input
          v-else
          v-model="local.code"
          type="text"
          disabled
          class="h-8 px-2 rounded border border-gray-300 text-sm font-mono bg-gray-100 text-gray-500"
          data-testid="accounting-accounts-form-code"
        />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 grow min-w-[10rem]">
        {{ t("pluginAccounting.accounts.columnName") }}
        <input
          ref="nameInput"
          v-model="local.name"
          type="text"
          :class="[
            'h-8 px-2 rounded border text-sm focus:outline-none',
            nameError ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-300 focus:ring-1 focus:ring-blue-500',
          ]"
          data-testid="accounting-accounts-form-name"
          @input="nameTouched = true"
        />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 w-32">
        {{ t("pluginAccounting.accounts.columnType") }}
        <!-- Type is locked in both modes:
             - NEW: the per-category "+ Add" button already chose
               it, and the suggested code is keyed off it.
             - EDIT: the type is part of the account's identity (it
               drives section placement, the code-prefix rule, and
               report categorization); changing it after the fact
               leads to surprising downstream effects. -->
        <select
          v-model="local.type"
          class="h-8 px-2 rounded border border-gray-300 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-500"
          disabled
          data-testid="accounting-accounts-form-type"
        >
          <option v-for="option in TYPE_OPTIONS" :key="option" :value="option">
            {{ t(`pluginAccounting.accounts.typeOption.${option}`) }}
          </option>
        </select>
      </label>
    </div>
    <label class="text-xs text-gray-500 flex flex-col gap-1">
      <span
        >{{ t("pluginAccounting.accounts.columnNote") }} <span class="text-gray-400">{{ t("pluginAccounting.accounts.noteOptional") }}</span></span
      >
      <input v-model="local.note" type="text" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-accounts-form-note" />
    </label>
    <p v-if="!isNew" class="text-xs text-gray-400">{{ t("pluginAccounting.accounts.codeReadOnlyHint") }}</p>
    <!-- Always rendered with min-h to reserve a single line of space
         so the Save / Cancel buttons stay put as the message shows
         and clears. Field error wins over a stale parent error. -->
    <p class="text-xs text-red-500 min-h-[1rem]" data-testid="accounting-accounts-form-error">{{ fieldErrorMessage ?? error ?? "" }}</p>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-accounts-form-cancel"
        @click="emit('cancel')"
      >
        {{ t("pluginAccounting.accounts.cancel") }}
      </button>
      <button
        type="submit"
        class="h-8 px-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
        :disabled="busy"
        data-testid="accounting-accounts-form-save"
      >
        {{ busy ? t("pluginAccounting.accounts.saving") : t("pluginAccounting.accounts.save") }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Account, AccountType } from "../api";
import type { AccountDraft } from "./accountDraft";
import { ACCOUNT_TYPE_PREFIX } from "./accountNumbering";
import { validateCodeField, validateNameField, type AccountValidationError, type CodeValidationError, type NameValidationError } from "./accountValidation";

const { t } = useI18n();

const props = defineProps<{
  draft: AccountDraft;
  isNew: boolean;
  busy: boolean;
  error: string | null;
  existingAccounts: readonly Account[];
}>();
const emit = defineEmits<{ save: [draft: AccountDraft]; cancel: [] }>();

const TYPE_OPTIONS: readonly AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const VALIDATION_MESSAGE_KEYS: Record<AccountValidationError, string> = {
  emptyCode: "pluginAccounting.accounts.errorEmptyCode",
  reservedCode: "pluginAccounting.accounts.errorReservedCode",
  invalidCodeFormat: "pluginAccounting.accounts.errorInvalidCodeFormat",
  codeTypeMismatch: "pluginAccounting.accounts.errorCodeTypeMismatch",
  emptyName: "pluginAccounting.accounts.errorEmptyName",
  duplicateCode: "pluginAccounting.accounts.errorDuplicateCode",
  duplicateName: "pluginAccounting.accounts.errorDuplicateName",
};

// Local copy so the parent's `draft` ref stays untouched until the
// user clicks Save. Cancelling reverts cleanly because the parent
// just discards its draft.
const local = reactive<AccountDraft>({ ...props.draft });
const nameInput = ref<HTMLInputElement | null>(null);

// Track which fields the user has interacted with so we can suppress
// "empty required" errors on a freshly-opened editor (the suggested
// code is always valid, but a brand-new account starts with an empty
// name — flashing red before the user has typed would be noise).
// Format / collision errors fire immediately because they only
// happen when the user has actually entered something.
const codeTouched = ref(false);
const nameTouched = ref(false);

const codePrefix = computed(() => String(ACCOUNT_TYPE_PREFIX[local.type]));

// Two-way binding for the trailing 3 digits. The full code
// (`local.code`) remains the source of truth; the trailing slice is
// derived. Non-digits and overflow are stripped on input so the
// downstream validator only ever sees a clean 4-digit candidate.
const codeTrailing = computed({
  get: () => {
    const { code } = local;
    if (code.startsWith(codePrefix.value)) return code.slice(codePrefix.value.length);
    return code;
  },
  set: (val: string) => {
    const cleaned = val.replace(/\D/g, "").slice(0, 3);
    local.code = codePrefix.value + cleaned;
  },
});

const codeError = computed<CodeValidationError | null>(() => {
  const result = validateCodeField(local, props.existingAccounts, props.isNew);
  if (result === "emptyCode" && !codeTouched.value) return null;
  return result;
});

const nameError = computed<NameValidationError | null>(() => {
  const result = validateNameField(local, props.existingAccounts, props.isNew);
  // For NEW accounts the empty-name field is invalid from the moment
  // the editor opens — flag it red right away to communicate the
  // requirement. For edits, the name is non-empty on open; only flag
  // emptyName once the user has actively cleared it (post-touch).
  if (result === "emptyName" && !nameTouched.value && !props.isNew) return null;
  return result;
});

const fieldErrorMessage = computed<string | null>(() => {
  const code = codeError.value;
  if (code !== null) return t(VALIDATION_MESSAGE_KEYS[code]);
  const name = nameError.value;
  if (name !== null) return t(VALIDATION_MESSAGE_KEYS[name]);
  return null;
});

// Re-sync when the parent swaps which account is being edited
// (e.g. user clicks Edit on a different row without first
// cancelling). Single watcher rather than per-field copy to keep
// behaviour boringly predictable.
watch(
  () => props.draft,
  (next) => {
    local.code = next.code;
    local.name = next.name;
    local.type = next.type;
    local.note = next.note;
    codeTouched.value = false;
    nameTouched.value = false;
  },
);

onMounted(() => {
  // Land the cursor in the field the user actually has to fill in:
  //   - new accounts: code is suggested and type is locked, so
  //     Name is the only non-decorative input.
  //   - edits: code is disabled, type is rarely the reason for
  //     editing — Name is still the most likely target. Keeping
  //     focus consistent across new/edit avoids surprise.
  void nextTick(() => nameInput.value?.focus());
});

function onSubmit(): void {
  // Surface any latent empty-required errors that were suppressed
  // pre-touch — clicking Save is intent enough to want the red
  // border, even if the user never typed in the field.
  codeTouched.value = true;
  nameTouched.value = true;
  emit("save", { code: local.code, name: local.name, type: local.type, note: local.note });
}
</script>
