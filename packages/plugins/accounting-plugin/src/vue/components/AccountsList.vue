<template>
  <!-- Full-tab chart-of-accounts list. Distinct from AccountsModal
       (called from the entry / opening forms): this one fills the
       canvas, surfaces a single "Manage accounts" button at the top,
       and emits `selectAccount` so the parent View can route the
       click into the Ledger tab pre-filtered to that account. -->
  <div class="flex flex-col gap-3" data-testid="accounting-accounts-list">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-accounts-manage"
        @click="showManageModal = true"
      >
        <span class="material-icons text-base">tune</span>
        <span>{{ t("pluginAccounting.accounts.manageButton") }}</span>
      </button>
    </div>
    <section v-for="group in groups" :key="group.type" class="flex flex-col gap-1">
      <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ t(`pluginAccounting.accounts.sectionTitle.${group.type}`) }}</h4>
      <p v-if="group.accounts.length === 0" class="text-xs text-gray-400 italic px-1">{{ t("pluginAccounting.accounts.listEmpty") }}</p>
      <ul v-else class="flex flex-col">
        <li
          v-for="account in group.accounts"
          :key="account.code"
          tabindex="0"
          role="button"
          :aria-label="t('pluginAccounting.accounts.openLedgerAria', { code: account.code, name: account.name })"
          class="flex items-center gap-3 px-2 py-1.5 border-b border-gray-100 hover:bg-blue-50 cursor-pointer text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          :data-testid="`accounting-account-row-${account.code}`"
          @click="onSelect(account)"
          @keydown.enter.prevent.self="onKeyActivate($event, account)"
          @keydown.space.prevent.self="onKeyActivate($event, account)"
        >
          <span class="font-mono text-xs w-16 shrink-0">{{ account.code }}</span>
          <span class="text-sm flex-1 min-w-0 truncate">{{ account.name }}</span>
        </li>
      </ul>
    </section>
    <AccountsModal v-if="showManageModal" :book-id="bookId" :accounts="accounts" @close="showManageModal = false" @changed="onAccountsChanged" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Account, AccountType } from "../api";
import AccountsModal from "./AccountsModal.vue";

const { t } = useI18n();

const props = defineProps<{ bookId: string; accounts: Account[] }>();
const emit = defineEmits<{ selectAccount: [code: string]; changed: [] }>();

const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "income", "expense"];

const showManageModal = ref(false);

interface AccountGroup {
  type: AccountType;
  accounts: Account[];
}

function byCode(left: Account, right: Account): number {
  return left.code.localeCompare(right.code);
}

// Soft-deleted accounts (active === false) are hidden — managing
// them lives in the Manage Accounts modal, where Reactivate is one
// click away.
const groups = computed<AccountGroup[]>(() =>
  ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: props.accounts
      .filter((account) => account.type === type && account.active !== false)
      .slice()
      .sort(byCode),
  })),
);

function onSelect(account: Account): void {
  emit("selectAccount", account.code);
}

// Keyboard activation: Enter / Space on a focused row. The
// `.prevent.self` modifiers in the template stop the default scroll
// (Space) and ensure we don't fire when the event bubbles up from
// a focused descendant (currently none, but defensive for future
// row content).
function onKeyActivate(event: KeyboardEvent, account: Account): void {
  if (event.repeat) return;
  emit("selectAccount", account.code);
}

function onAccountsChanged(): void {
  // Forward to the parent — `bookVersion` already drives the
  // accounts refetch in View.vue, so the list updates without us
  // doing anything extra. Bubble the event in case a future
  // consumer needs it.
  emit("changed");
}
</script>
