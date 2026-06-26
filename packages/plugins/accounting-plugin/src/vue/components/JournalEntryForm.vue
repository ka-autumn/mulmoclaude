<template>
  <form class="flex flex-col gap-3" data-testid="accounting-entry-form" @submit.prevent="onSubmit">
    <!-- Edit mode mounts inside the row's expanded detail panel,
         which already gives the user enough context (the row above
         shows date / kind / memo / lines). Hide the redundant
         "Edit journal entry" title there; the editBanner below
         still surfaces the void-and-replace consequence. -->
    <h3 v-if="!isEditing" class="text-base font-semibold">{{ t("pluginAccounting.entryForm.title") }}</h3>
    <div class="flex flex-wrap gap-3">
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.entryForm.dateLabel") }}
        <input v-model="date" type="date" required class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-entry-date" />
      </label>
      <label class="text-xs text-gray-500 flex flex-col gap-1 grow min-w-0">
        {{ t("pluginAccounting.entryForm.memoLabel") }}
        <input v-model="memo" type="text" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-entry-memo" />
      </label>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-xs text-gray-500 border-b border-gray-200">
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.accountLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.debitLabel") }}</th>
          <th class="text-right py-1 px-2 w-32">{{ t("pluginAccounting.entryForm.creditLabel") }}</th>
          <th v-if="anyTaxLine" class="text-left py-1 px-2 w-40">{{ t("pluginAccounting.entryForm.taxRegistrationIdLabel") }}</th>
          <th class="py-1 px-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(line, idx) in lines" :key="idx" class="border-b border-gray-100">
          <td class="py-1 px-2">
            <select
              v-model="line.accountCode"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm bg-white"
              :data-testid="`accounting-entry-line-account-${idx}`"
            >
              <option value="">{{ DASH }}</option>
              <option v-for="account in selectableAccounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
            </select>
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="line.debit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right bg-white"
              :data-testid="`accounting-entry-line-debit-${idx}`"
              @input="onDebitInput(line)"
            />
          </td>
          <td class="py-1 px-2">
            <input
              v-model.number="line.credit"
              type="number"
              :step="step"
              min="0"
              class="h-8 px-2 w-full rounded border border-gray-300 text-sm text-right bg-white"
              :data-testid="`accounting-entry-line-credit-${idx}`"
              @input="onCreditInput(line)"
            />
          </td>
          <!-- Tax-registration ID column appears only when at least
               one line picks an input-tax account (14xx — see
               isTaxAccountCode). Within a column-visible row, the
               input itself only renders for the lines that actually
               pick a 14xx account; other lines render an empty cell
               so the row keeps its column alignment. -->
          <td v-if="anyTaxLine" class="py-1 px-2">
            <template v-if="isTaxLine(line)">
              <input
                v-model="line.taxRegistrationId"
                type="text"
                :maxlength="MAX_TAX_REGISTRATION_ID_LENGTH"
                :placeholder="t('pluginAccounting.entryForm.taxRegistrationIdPlaceholder')"
                :class="[
                  'h-8 px-2 w-full rounded border text-sm font-mono bg-white focus:outline-none',
                  isTaxRegistrationIdInvalid(line)
                    ? 'border-red-500 ring-1 ring-red-500'
                    : isTaxRegistrationIdMissing(line)
                      ? 'border-amber-500 ring-1 ring-amber-500'
                      : 'border-gray-300 focus:ring-1 focus:ring-blue-500',
                ]"
                :data-testid="`accounting-entry-line-tax-registration-id-${idx}`"
                :aria-describedby="isTaxRegistrationIdMissing(line) ? `accounting-entry-line-tax-registration-id-warning-${idx}` : undefined"
              />
              <!-- Non-color cue for the amber border. Polite live
                   region so screen readers are nudged when the
                   user finishes typing an amount and the warning
                   first appears, without interrupting other speech. -->
              <p
                v-if="isTaxRegistrationIdMissing(line)"
                :id="`accounting-entry-line-tax-registration-id-warning-${idx}`"
                class="text-xs text-amber-600 mt-1"
                role="status"
                aria-live="polite"
                :data-testid="`accounting-entry-line-tax-registration-id-warning-${idx}`"
              >
                {{ t("pluginAccounting.entryForm.taxRegistrationIdMissingWarning") }}
              </p>
            </template>
          </td>
          <td class="py-1 px-2 text-right">
            <button v-if="lines.length > 2" type="button" class="text-xs text-red-500 hover:underline" @click="lines.splice(idx, 1)">
              {{ t("pluginAccounting.entryForm.removeLine") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
          data-testid="accounting-entry-add-line"
          @click="addLine"
        >
          <span class="material-icons text-base">add</span>
          <span>{{ t("pluginAccounting.entryForm.addLine") }}</span>
        </button>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
          data-testid="accounting-entry-manage-accounts"
          @click="showAccountsModal = true"
        >
          <span class="material-icons text-base">tune</span>
          <span>{{ t("pluginAccounting.accounts.manageButton") }}</span>
        </button>
      </div>
      <span :class="balanced ? 'text-green-600' : 'text-red-500'" class="text-xs" data-testid="accounting-entry-balance">
        {{ balanced ? t("pluginAccounting.entryForm.balanced") : t("pluginAccounting.entryForm.imbalance", { amount: imbalanceText }) }}
      </span>
    </div>
    <p v-if="error" class="text-xs text-red-500" data-testid="accounting-entry-error">{{ error }}</p>
    <p v-if="successMessage" class="text-xs text-green-600" data-testid="accounting-entry-success">{{ successMessage }}</p>
    <div class="flex items-center justify-between gap-2">
      <!-- editBanner sits on the action row in edit mode (instead
           of as a separate paragraph above the form) so the panel
           is shorter and the user reads the void-and-replace
           consequence right next to the button that triggers it. -->
      <p v-if="isEditing" class="text-xs text-gray-500 flex-1 min-w-0" data-testid="accounting-entry-edit-banner">
        {{ t("pluginAccounting.entryForm.editBanner") }}
      </p>
      <span v-else></span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-8 px-3 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
          :disabled="submitting"
          data-testid="accounting-entry-cancel-edit"
          @click="emit('cancel')"
        >
          {{ t("pluginAccounting.common.cancel") }}
        </button>
        <button
          type="submit"
          class="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
          :disabled="!balanced || submitting || editLocked"
          data-testid="accounting-entry-submit"
        >
          {{ submitButtonLabel }}
        </button>
      </div>
    </div>
  </form>
  <!-- Sibling of the parent <form> on purpose: the modal renders
       its own <form @submit.prevent> for the inline editor, and
       nesting <form>s is invalid HTML that breaks Enter-key submit
       routing in some browsers. Vue 3 multi-root templates let us
       keep the markup flat with no wrapper div. -->
  <AccountsModal v-if="showAccountsModal" :book-id="bookId" :accounts="accounts" @close="showAccountsModal = false" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { addEntries, voidEntry, type Account, type JournalEntry, type JournalLine } from "../api";
import { formatAmount, inputStepFor, localDateString, countryHasFeature, type SupportedCountryCode } from "../../shared";
import { isTaxAccountCode } from "./accountNumbering";
import AccountsModal from "./AccountsModal.vue";
import { errorMessage } from "../../shared/errors";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[]; currency: string; country?: SupportedCountryCode; entryToEdit?: JournalEntry | null }>();
const emit = defineEmits<{ submitted: []; cancel: [] }>();

const showAccountsModal = ref(false);

const DASH = "—";

function formatAccountLabel(account: Account): string {
  // Name first so type-to-search in the <select> matches the
  // human-meaningful word; the code goes in trailing parens.
  return `${account.name} (${account.code})`;
}

// Hide deactivated accounts from the entry dropdown — accounting
// integrity requires keeping them in the chart of accounts (any
// historical journal line still references the code), but new
// entries should not be able to land on a soft-deleted account.
const selectableAccounts = computed<Account[]>(() => props.accounts.filter((account) => account.active !== false));
const selectableAccountCodes = computed<Set<string>>(() => new Set(selectableAccounts.value.map((account) => account.code)));

interface FormLine {
  accountCode: string;
  debit: number | null;
  credit: number | null;
  taxRegistrationId: string;
}

// Mirrors server/accounting/journal.ts MAX_TAX_REGISTRATION_ID_LENGTH.
// Duplicated rather than imported to keep the front-end bundle from
// pulling in server modules (the existing client / server type alias
// pattern in api.ts does the same — both sides own their copy of the
// shape).
const MAX_TAX_REGISTRATION_ID_LENGTH = 32;

function blankLine(): FormLine {
  return { accountCode: "", debit: null, credit: null, taxRegistrationId: "" };
}

function isTaxRegistrationIdInvalid(line: FormLine): boolean {
  return line.taxRegistrationId.trim().length > MAX_TAX_REGISTRATION_ID_LENGTH;
}

function isTaxLine(line: FormLine): boolean {
  return line.accountCode !== "" && isTaxAccountCode(line.accountCode);
}

// Soft warning: a postable tax line in a jurisdiction the role
// prompt requires a counterparty registration number for (JP, EU,
// GB, IN, AU, NZ, CA — see COUNTRY_FEATURES.warnMissingTaxRegistrationId)
// gets an amber border + helper text when the field is blank. The
// form lets the user post anyway (some suppliers genuinely won't
// have one), but the silent-strip in `toApiLines` no longer goes
// unnoticed. `function` declarations hoist, so calling `isPostable`
// here is fine even though it appears later in the file.
function isTaxRegistrationIdMissing(line: FormLine): boolean {
  if (!isTaxLine(line)) return false;
  if (!isPostable(line)) return false;
  if (!countryHasFeature("warnMissingTaxRegistrationId", props.country)) return false;
  return line.taxRegistrationId.trim() === "";
}

const date = ref(localDateString());
const memo = ref("");
const lines = ref<FormLine[]>([blankLine(), blankLine()]);
const submitting = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const isEditing = computed<boolean>(() => Boolean(props.entryToEdit));
const submitButtonLabel = computed<string>(() => {
  if (submitting.value) {
    return isEditing.value ? t("pluginAccounting.entryForm.updating") : t("pluginAccounting.entryForm.submitting");
  }
  return isEditing.value ? t("pluginAccounting.entryForm.update") : t("pluginAccounting.entryForm.submit");
});

// One-shot lock: once the user has clicked Update on an edit, the
// submit button is dead until they Cancel (or land on a different
// entry). Edit = void + addEntries as two sequential calls; if the
// void succeeds and the add fails, a second Submit would try to
// void an already-voided original. We don't add retry plumbing
// for that — policy is "report the error, do not retry". The user
// cancels out and re-enters manually.
const editAttempted = ref(false);
const editLocked = computed(() => isEditing.value && editAttempted.value);

function addLine(): void {
  lines.value.push(blankLine());
}

// Toggling ensures a single line never has both sides set — the
// server validates this too, but doing it on input prevents a
// confusing UX where the running total goes negative as the user
// types.
function onDebitInput(line: FormLine): void {
  if (line.debit !== null && line.debit !== 0) line.credit = null;
}
function onCreditInput(line: FormLine): void {
  if (line.credit !== null && line.credit !== 0) line.debit = null;
}

// Imbalance is computed off lines that are *postable* (have an
// accountCode + a positive amount). Without that filter,
// `balanced` could be `true` even when `toApiLines()` would drop a
// row, and the user would hit a confusing "needs ≥ 2 lines" error
// from the server on submit.
const imbalance = computed<number>(() => {
  let sum = 0;
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    if (isPositiveAmount(line.debit)) sum += line.debit;
    if (isPositiveAmount(line.credit)) sum -= line.credit;
  }
  return sum;
});
const hasAtLeastTwoPostableLines = computed(() => {
  let count = 0;
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    count += 1;
    if (count >= 2) return true;
  }
  return false;
});
// Show the tax-registration ID column only when at least one line
// targets a 14xx (input-tax) account; otherwise the column is
// wasted space for the typical entry that has no input-tax line.
const anyTaxLine = computed(() => lines.value.some(isTaxLine));
const hasTaxRegistrationIdError = computed(() => lines.value.some(isTaxRegistrationIdInvalid));
const balanced = computed(() => Math.abs(imbalance.value) <= 0.005 && hasAtLeastTwoPostableLines.value && !hasTaxRegistrationIdError.value);
const imbalanceText = computed(() => formatAmount(imbalance.value, props.currency));
const step = computed(() => inputStepFor(props.currency));

function isPositiveAmount(value: unknown): value is number {
  // Robust against the empty string `v-model.number` produces when
  // the user clears a previously-typed field — `"" ?? 0 === 0` is
  // false so a naive truthy check would let the empty input through
  // as a phantom zero amount.
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPostable(line: FormLine): boolean {
  if (!line.accountCode) return false;
  // Defence-in-depth against a code that was selectable when the
  // user picked it but got deactivated mid-edit. Hiding the
  // option from the dropdown alone isn't enough — the form's
  // `accountCode` value is sticky, so a stale selection would
  // still be POSTed if the user just hits submit. Gating
  // postability here also flows through to `balanced` and
  // `hasAtLeastTwoPostableLines`, so the submit button disables
  // and the user gets immediate feedback.
  if (!selectableAccountCodes.value.has(line.accountCode)) return false;
  return isPositiveAmount(line.debit) || isPositiveAmount(line.credit);
}

function toApiLines(): JournalLine[] {
  const out: JournalLine[] = [];
  for (const line of lines.value) {
    if (!isPostable(line)) continue;
    const apiLine: JournalLine = { accountCode: line.accountCode };
    if (isPositiveAmount(line.debit)) apiLine.debit = line.debit;
    if (isPositiveAmount(line.credit)) apiLine.credit = line.credit;
    // Only persist taxRegistrationId on tax-related lines —
    // otherwise a value typed against an earlier account choice
    // would leak through after the user switched the line to a
    // non-tax account (the input field disappears but the form
    // state lingers).
    if (isTaxLine(line)) {
      const trimmedTaxId = line.taxRegistrationId.trim();
      if (trimmedTaxId !== "") apiLine.taxRegistrationId = trimmedTaxId;
    }
    out.push(apiLine);
  }
  return out;
}

async function onSubmit(): Promise<void> {
  if (submitting.value || !balanced.value || editLocked.value) return;
  submitting.value = true;
  error.value = null;
  successMessage.value = null;
  try {
    // Edit flow: void the original, then post the replacement.
    // Two sequential calls — not atomic, no retry. Marking
    // `editAttempted` *before* the void disables the submit button
    // for the rest of this edit session (the `editLocked` guard
    // and the button's :disabled both honour it), so a partial
    // failure can't trigger a second void on the already-voided
    // original. On any error: show the message, user must Cancel
    // and re-enter manually.
    const editingId = props.entryToEdit?.id;
    if (editingId) {
      editAttempted.value = true;
      const voidResult = await voidEntry({
        bookId: props.bookId,
        entryId: editingId,
        reason: t("pluginAccounting.entryForm.editVoidReason"),
      });
      if (!voidResult.ok) {
        error.value = voidResult.error;
        return;
      }
    }
    const result = await addEntries({
      bookId: props.bookId,
      entries: [
        {
          date: date.value,
          memo: memo.value.trim() || undefined,
          lines: toApiLines(),
          ...(editingId ? { replacesEntryId: editingId } : {}),
        },
      ],
    });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    successMessage.value = editingId ? t("pluginAccounting.entryForm.editSuccess") : t("pluginAccounting.entryForm.success");
    lines.value = [blankLine(), blankLine()];
    memo.value = "";
    emit("submitted");
  } catch (err) {
    // apiPost normally folds network / HTTP failures into
    // `result.ok = false`, so this branch should be rare. It's a
    // belt-and-braces guard against a runtime failure leaving the
    // submit button stuck — the user gets a visible error
    // instead of an unhandled rejection.
    error.value = errorMessage(err);
  } finally {
    submitting.value = false;
  }
}

// Reset the entire draft when bookId switches under us (rare but
// possible via BookSwitcher while the form is open). Carrying the
// previous book's lines and account codes into the new book is
// the worst kind of silent failure — the new book might not even
// have the same chart of accounts.
watch(
  () => props.bookId,
  () => {
    lines.value = [blankLine(), blankLine()];
    memo.value = "";
    date.value = localDateString();
    error.value = null;
    successMessage.value = null;
  },
);

// Edit mode: when the parent hands us an entry to edit, pre-fill
// every field so the user can tweak and resubmit. When it clears
// the prop (after submit / cancel / book switch), wipe back to a
// blank draft so the next "New entry" tab visit is fresh. Mapping
// `entry.lines` (the wire shape with optional `debit` / `credit`)
// onto `FormLine` (which uses nullable numbers + a string
// taxRegistrationId) is straightforward — pad missing optionals
// to null / "".
watch(
  () => props.entryToEdit,
  (entry) => {
    error.value = null;
    successMessage.value = null;
    // Fresh edit (or exit from edit mode) → unlock the submit
    // button so the new edit session has a clean shot.
    editAttempted.value = false;
    if (!entry) {
      lines.value = [blankLine(), blankLine()];
      memo.value = "";
      date.value = localDateString();
      return;
    }
    date.value = entry.date;
    memo.value = entry.memo ?? "";
    lines.value = entry.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: typeof line.debit === "number" ? line.debit : null,
      credit: typeof line.credit === "number" ? line.credit : null,
      taxRegistrationId: line.taxRegistrationId ?? "",
    }));
    if (lines.value.length < 2) {
      while (lines.value.length < 2) lines.value.push(blankLine());
    }
  },
  { immediate: true },
);

// If an account the user already picked gets deactivated mid-edit
// (e.g. via the Manage Accounts modal in this form, or from
// another tab via pubsub), clear the line's accountCode so the
// <select> visibly resets to "—". Without this, the option is
// gone but the form's bound value still holds the stale code,
// which (a) leaves the user staring at a blank-looking select and
// (b) used to slip through to submit before the isPostable guard
// landed. Belt + suspenders.
watch(selectableAccountCodes, (codes) => {
  for (const line of lines.value) {
    if (line.accountCode && !codes.has(line.accountCode)) line.accountCode = "";
  }
});
</script>

<style scoped>
/* Hide the WebKit / Firefox spin buttons on amount inputs. The
   step attribute still controls validation; this is purely UI.
   Accounting amount fields don't benefit from a spinner — users
   type the number and the up/down arrows just clutter the row. */
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
