<template>
  <div class="flex flex-col gap-3" data-testid="accounting-ledger">
    <div class="flex flex-wrap items-end gap-3">
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.ledger.selectAccount") }}
        <select v-model="accountCode" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-ledger-account">
          <option value="">{{ DASH }}</option>
          <option v-for="account in selectableAccounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
        </select>
      </label>
      <DateRangePicker v-model="range" :fiscal-year-end="resolvedFiscalYearEnd" :opening-date="openingDate" />
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
    <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
    <template v-else-if="ledger">
      <table class="w-full text-sm" :data-testid="showTaxRegistrationColumn ? 'accounting-ledger-table-with-tax-id' : 'accounting-ledger-table'">
        <thead>
          <tr class="text-xs text-gray-500 border-b border-gray-200">
            <th class="text-left py-1 px-2">{{ t("pluginAccounting.ledger.columns.date") }}</th>
            <th class="text-left py-1 px-2">{{ t("pluginAccounting.ledger.columns.memo") }}</th>
            <th v-if="showTaxRegistrationColumn" class="text-left py-1 px-2 w-40">
              {{ t("pluginAccounting.ledger.columns.taxRegistrationId") }}
            </th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.debit") }}</th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.credit") }}</th>
            <th class="text-right py-1 px-2 w-28">{{ t("pluginAccounting.ledger.columns.balance") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in ledger.rows"
            :key="`${row.entryId}-${row.date}`"
            :class="row.kind === 'void' || row.kind === 'void-marker' ? 'text-gray-400 line-through' : ''"
            class="border-b border-gray-100"
          >
            <td class="py-1 px-2 whitespace-nowrap">{{ row.date }}</td>
            <td class="py-1 px-2">
              <span v-if="row.memo">{{ row.memo }}</span>
            </td>
            <td v-if="showTaxRegistrationColumn" class="py-1 px-2 font-mono text-xs">
              <span v-if="row.taxRegistrationId">{{ row.taxRegistrationId }}</span>
            </td>
            <td class="py-1 px-2 text-right">
              <span v-if="row.debit">{{ formatAmount(row.debit) }}</span>
            </td>
            <td class="py-1 px-2 text-right">
              <span v-if="row.credit">{{ formatAmount(row.credit) }}</span>
            </td>
            <td class="py-1 px-2 text-right font-mono">{{ formatAmount(row.runningBalance) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="font-semibold border-t border-gray-300">
            <td :colspan="showTaxRegistrationColumn ? 5 : 4" class="py-1 px-2 text-right">
              {{ t("pluginAccounting.ledger.closingBalance") }}
            </td>
            <td class="py-1 px-2 text-right">{{ formatAmount(ledger.closingBalance) }}</td>
          </tr>
        </tfoot>
      </table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getLedger, type Account, type Ledger, type ReportPeriod } from "../api";
import { formatAmount as formatAmountWithCurrency, currentFiscalYearRange, resolveFiscalYearEnd, type DateRange, type FiscalYearEnd } from "../../shared";
import { isTaxAccountCode } from "./accountNumbering";
import { useLatestRequest } from "./useLatestRequest";
import DateRangePicker from "./DateRangePicker.vue";

const { t } = useI18n();

const props = defineProps<{
  bookId: string;
  accounts: Account[];
  currency: string;
  version: number;
  fiscalYearEnd?: FiscalYearEnd;
  /** Opening-balance date for the active book — drives the "Lifetime"
   *  shortcut in the date picker (from = openingDate, to = today).
   *  When absent, the picker hides Lifetime; "All" still works. */
  openingDate?: string;
  /** Optional account to preselect (Accounts tab → click). Updates
   *  via the watcher below — assigning to the local `accountCode`
   *  ref keeps the dropdown's v-model authoritative for user edits. */
  preselectAccountCode?: string;
}>();

const DASH = "—";
const accountCode = ref("");
const ledger = ref<Ledger | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

const resolvedFiscalYearEnd = computed<FiscalYearEnd>(() => resolveFiscalYearEnd(props.fiscalYearEnd));

// Default range = current fiscal year. Re-evaluated when bookId or
// fiscalYearEnd changes (see watcher) so switching books resets to a
// sensible window rather than carrying the prior book's custom edits.
const range = ref<DateRange>(currentFiscalYearRange(resolvedFiscalYearEnd.value));

function formatAmount(value: number): string {
  return formatAmountWithCurrency(value, props.currency);
}

function formatAccountLabel(account: Account): string {
  // Name first so type-to-search in the <select> matches the
  // human-meaningful word; the code goes in trailing parens.
  return `${account.name} (${account.code})`;
}

// Hide deactivated accounts from the ledger picker; historical
// entries on a soft-deleted account are still inspectable via
// the journal-list filter (which intentionally shows every code
// so the past stays queryable).
const selectableAccounts = computed<Account[]>(() => props.accounts.filter((account) => account.active !== false));

// Surface the T-number column when the active account is in the
// input-tax band (14xx — e.g. 1400 Input Tax Receivable).
// Convention-driven so any custom account a user adds in the band
// participates without an opt-in flag. 24xx (Sales Tax Payable
// and friends) intentionally doesn't get the column — the
// counterparty registration ID matters for input-tax-credit
// eligibility on purchases, not for the seller-side liability.
const showTaxRegistrationColumn = computed<boolean>(() => {
  if (!ledger.value) return false;
  return isTaxAccountCode(ledger.value.accountCode);
});

// Build a ReportPeriod from the current range. Both ends empty = no
// filter (full history); either end alone gets a sentinel on the
// other side so the server-side range filter still applies.
function periodFromRange(value: DateRange): ReportPeriod | undefined {
  if (value.from === "" && value.to === "") return undefined;
  return { kind: "range", from: value.from || "0000-01-01", to: value.to || "9999-12-31" };
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  if (!accountCode.value) {
    ledger.value = null;
    error.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await getLedger(accountCode.value, periodFromRange(range.value), props.bookId);
    // Drop the result if a newer refresh started (bookId or
    // accountCode changed under us) — otherwise a slower earlier
    // request could overwrite the fresh ledger.
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      ledger.value = null;
      return;
    }
    ledger.value = result.data.ledger;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

// Reset to current-year window AND drop the selected account
// whenever the active book or its fiscal-year end changes. Without
// the accountCode reset, switching from book A (cash=1000) to book
// B (which may not even define 1000) fires a getLedger for a
// missing code and surfaces an avoidable 404. The range reset
// follows the same logic — a custom window from book A is
// meaningless against book B's entries.
watch(
  () => [props.bookId, resolvedFiscalYearEnd.value],
  () => {
    accountCode.value = "";
    range.value = currentFiscalYearRange(resolvedFiscalYearEnd.value);
  },
);

// Apply parent-supplied preselection (Accounts tab → click). The
// watcher fires on both initial mount (with `immediate`) and on
// every prop change so re-clicking the same account from the
// Accounts tab while already on the Ledger still routes through.
// Resets the range to the current fiscal year on each preselect so
// a stale custom window the user left behind on the Ledger doesn't
// hide the entries the Accounts tab handed off.
watch(
  () => props.preselectAccountCode,
  (next) => {
    if (!next) return;
    accountCode.value = next;
    range.value = currentFiscalYearRange(resolvedFiscalYearEnd.value);
  },
  { immediate: true },
);

watch(() => [props.bookId, props.version, accountCode.value, range.value.from, range.value.to], refresh, { immediate: true });
</script>
