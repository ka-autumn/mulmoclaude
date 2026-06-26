<template>
  <div class="flex flex-col h-full gap-3">
    <!-- Top-row toolbar slot. Renders the embedded entry form
         in "+ New entry" mode here; Edit-mode for a row's existing
         entry is rendered IN-PLACE inside that row's expanded
         detail panel below. The date picker / account filter /
         table below stay visible in either state. -->
    <div v-if="showNewForm" class="border border-gray-200 rounded p-3" data-testid="accounting-journal-inline-form">
      <JournalEntryForm
        :book-id="bookId"
        :accounts="accounts"
        :currency="currency"
        :country="country"
        :entry-to-edit="null"
        @submitted="onFormSubmitted"
        @cancel="onFormCancel"
      />
    </div>
    <div v-else class="flex items-center justify-end">
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-journal-new-entry"
        @click="onOpenNewEntry"
      >
        <span class="material-icons text-base">add</span>
        <span>{{ t("pluginAccounting.tabs.newEntry") }}</span>
      </button>
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <DateRangePicker v-model="range" :fiscal-year-end="resolvedFiscalYearEnd" :opening-date="openingDate" />
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.journalList.accountLabel") }}
        <select v-model="accountCode" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-journal-account">
          <option value="">{{ t("pluginAccounting.journalList.allAccounts") }}</option>
          <option v-for="account in accounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
        </select>
      </label>
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <!-- Scrollable list area: only the entries list scrolls below
         this point. The new-entry slot + filter bar above stay
         pinned by virtue of NOT being inside this scroll container,
         and the column-header row stays visible via `position:
         sticky` on its <th>s. `min-h-0` is required for the flex-1
         child to actually shrink below its content height in a
         flex-col parent. -->
    <div class="flex-1 min-h-0 overflow-auto">
      <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
      <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
      <p v-else-if="visibleEntries.length === 0" class="text-xs text-gray-400">{{ t("pluginAccounting.common.empty") }}</p>
      <table v-else class="w-full text-sm" data-testid="accounting-journal-table">
        <thead>
          <tr class="text-xs text-gray-500 border-b border-gray-200">
            <!-- Per-<th> sticky (rather than `<thead class="sticky">`)
                 for compatibility — `position: sticky` on the
                 table-header-group display is brittle in some
                 browsers, but on `<th>` it's universally supported.
                 `bg-white` is required so the scrolled rows beneath
                 don't bleed through. -->
            <th class="sticky top-0 bg-white text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.date") }}</th>
            <th class="sticky top-0 bg-white text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.kind") }}</th>
            <th class="sticky top-0 bg-white text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.memo") }}</th>
            <th class="sticky top-0 bg-white text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.lines") }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="entry in visibleEntries" :key="entry.id">
            <tr
              :class="[
                voidedEntryIds.has(entry.id) ? 'text-gray-400 line-through' : '',
                expandedEntryId === entry.id ? 'row-selected' : '',
                'border-b border-gray-100 align-top cursor-pointer hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              ]"
              :data-testid="voidedEntryIds.has(entry.id) ? `accounting-journal-row-voided-${entry.id}` : `accounting-journal-row-${entry.id}`"
              tabindex="0"
              role="button"
              :aria-expanded="expandedEntryId === entry.id"
              @click="toggleExpanded(entry.id)"
              @keydown.enter.prevent.self="onKeyToggle($event, entry.id)"
              @keydown.space.prevent.self="onKeyToggle($event, entry.id)"
            >
              <td class="py-1 px-2 whitespace-nowrap">{{ entry.date }}</td>
              <td class="py-1 px-2 text-xs">{{ kindLabel(entry.kind) }}</td>
              <td class="py-1 px-2">
                <span v-if="entry.memo">{{ entry.memo }}</span>
              </td>
              <td class="py-1 px-2">
                <template v-if="expandedEntryId !== entry.id">
                  <div v-for="(line, idx) in entry.lines" :key="idx" class="text-xs flex gap-2 items-baseline">
                    <span class="font-mono text-[10px] text-gray-400">{{ line.accountCode }}</span>
                    <span v-if="accountNameFor(line.accountCode)">{{ accountNameFor(line.accountCode) }}</span>
                    <span v-if="line.debit">{{ formatDebit(line.debit) }}</span>
                    <span v-if="line.credit">{{ formatCredit(line.credit) }}</span>
                  </div>
                </template>
                <div v-else class="flex items-center justify-between gap-2">
                  <span class="text-xs text-gray-400 font-mono">{{ formatCreatedAt(entry.createdAt) }}</span>
                  <button
                    type="button"
                    class="h-6 w-6 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                    :data-testid="`accounting-journal-detail-close-${entry.id}`"
                    :aria-label="t('common.close')"
                    @click.stop="onCloseDetail"
                  >
                    <span class="material-icons text-base">close</span>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="expandedEntryId === entry.id" class="bg-gray-50 detail-selected" :data-testid="`accounting-journal-detail-${entry.id}`">
              <td :colspan="4" class="px-6 py-2">
                <!-- Edit-in-place: the JournalEntryForm replaces the
                   read-only detail content for this row when the
                   user clicks Edit. Submit / cancel collapses back
                   (submit also voids the original, so we clear the
                   selection); top-bar "+ New entry" stays a separate
                   path that opens the same form above the table. -->
                <div v-if="entryBeingEdited?.id === entry.id" :data-testid="`accounting-journal-detail-edit-${entry.id}`">
                  <JournalEntryForm
                    :book-id="bookId"
                    :accounts="accounts"
                    :currency="currency"
                    :country="country"
                    :entry-to-edit="entryBeingEdited"
                    @submitted="onFormSubmitted"
                    @cancel="onFormCancel"
                  />
                </div>
                <template v-else>
                  <div class="flex items-center gap-3 mb-2">
                    <template v-if="entry.kind === 'normal' && !voidedEntryIds.has(entry.id)">
                      <button class="text-xs text-blue-600 hover:underline" :data-testid="`accounting-edit-${entry.id}`" @click="onEditEntry(entry)">
                        {{ t("pluginAccounting.journalList.edit") }}
                      </button>
                      <button class="text-xs text-red-500 hover:underline" :data-testid="`accounting-void-${entry.id}`" @click="onVoid(entry)">
                        {{ t("pluginAccounting.journalList.void") }}
                      </button>
                    </template>
                    <button
                      v-else-if="entry.kind === 'opening' && !voidedEntryIds.has(entry.id)"
                      class="text-xs text-blue-600 hover:underline"
                      :data-testid="`accounting-edit-opening-${entry.id}`"
                      @click="emit('editOpening')"
                    >
                      {{ t("pluginAccounting.journalList.edit") }}
                    </button>
                  </div>
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="text-gray-500 border-b border-gray-200">
                        <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.accountLabel") }}</th>
                        <th class="text-right py-1 px-2">{{ t("pluginAccounting.entryForm.debitLabel") }}</th>
                        <th class="text-right py-1 px-2">{{ t("pluginAccounting.entryForm.creditLabel") }}</th>
                        <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.memoLabel") }}</th>
                        <th v-if="entryHasTaxIds(entry)" class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.taxRegistrationIdLabel") }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(line, idx) in entry.lines" :key="idx" class="border-b border-gray-100 text-gray-700">
                        <td class="py-1 px-2">
                          <span class="font-mono text-[10px] text-gray-400 mr-2">{{ line.accountCode }}</span>
                          <span v-if="accountNameFor(line.accountCode)">{{ accountNameFor(line.accountCode) }}</span>
                        </td>
                        <td class="py-1 px-2 text-right font-mono">
                          <template v-if="line.debit">{{ formatAmount(line.debit, currency) }}</template>
                        </td>
                        <td class="py-1 px-2 text-right font-mono">
                          <template v-if="line.credit">{{ formatAmount(line.credit, currency) }}</template>
                        </td>
                        <td class="py-1 px-2">
                          <template v-if="line.memo">{{ line.memo }}</template>
                        </td>
                        <td v-if="entryHasTaxIds(entry)" class="py-1 px-2 font-mono text-[10px]">
                          <template v-if="line.taxRegistrationId">{{ line.taxRegistrationId }}</template>
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="font-semibold border-t border-gray-300 text-gray-700">
                        <td class="py-1 px-2 text-gray-500">{{ t("pluginAccounting.balanceSheet.total") }}</td>
                        <td class="py-1 px-2 text-right font-mono">{{ formatAmount(entryDebitTotal(entry), currency) }}</td>
                        <td class="py-1 px-2 text-right font-mono">{{ formatAmount(entryCreditTotal(entry), currency) }}</td>
                        <td :colspan="entryHasTaxIds(entry) ? 2 : 1"></td>
                      </tr>
                    </tfoot>
                  </table>
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getJournalEntries, voidEntry, type Account, type JournalEntry, type JournalEntryKind, type JournalLine } from "../api";
import { formatAmount, currentFiscalYearRange, resolveFiscalYearEnd, type DateRange, type FiscalYearEnd, type SupportedCountryCode } from "../../shared";
import { useLatestRequest } from "./useLatestRequest";
import DateRangePicker from "./DateRangePicker.vue";
import JournalEntryForm from "./JournalEntryForm.vue";
import { errorMessage } from "../../shared/errors";

const { t } = useI18n();

const props = defineProps<{
  bookId: string;
  accounts: Account[];
  currency: string;
  country?: SupportedCountryCode;
  version: number;
  fiscalYearEnd?: FiscalYearEnd;
  /** Opening-balance date for the active book — drives the "Lifetime"
   *  shortcut in the date picker (from = openingDate, to = today).
   *  When absent, the picker hides Lifetime; "All" still works. */
  openingDate?: string;
  /** Entry id to auto-expand and scroll into view. Surfaced by the
   *  parent when an `addEntries` tool result lands so the user sees
   *  the freshly-posted row highlighted. Captured into
   *  `pendingPreselectId` and consumed once the entry actually
   *  appears in the fetched list — refetch can race the prop. */
  preselectEntryId?: string;
}>();
const emit = defineEmits<{ editOpening: []; preselectConsumed: [] }>();

// Inline-form state. Two distinct surfaces, one component:
//   • showNewForm = true → blank draft, rendered above the table
//     where the "+ New entry" button used to be.
//   • entryBeingEdited != null → edit mode, rendered IN-PLACE inside
//     the matching row's expanded detail panel (replacing the read-
//     only debit/credit table for that row).
// `<JournalEntryForm>` looks at `entryToEdit` to decide its title /
// submit label; the top-bar instance always passes null.
const showNewForm = ref(false);
const entryBeingEdited = ref<JournalEntry | null>(null);
// Single-selection detail expansion. Clicking a row swaps the
// selection (or collapses if it's already the selected row).
// Cleared on book switch via the closeForm watcher; entries deleted
// between fetches simply drop out of filteredEntries, so a stale id
// here just renders no detail row. Declared early so the
// onFormSubmitted / bookId-watcher callbacks below can reference it.
const expandedEntryId = ref<string | null>(null);

function onOpenNewEntry(): void {
  entryBeingEdited.value = null;
  showNewForm.value = true;
}

function onEditEntry(entry: JournalEntry): void {
  showNewForm.value = false;
  entryBeingEdited.value = entry;
}

function closeForm(): void {
  showNewForm.value = false;
  entryBeingEdited.value = null;
}

function onFormSubmitted(): void {
  // Submit posts via the form. In production the server-side
  // publishBookChange round-trips an SSE event that bumps
  // `bookVersion` and re-runs `refresh` via the watcher below.
  // We also kick a synchronous refetch here so the freshly-posted
  // row shows up immediately — the SSE round-trip can race the
  // tab repaint, and skipping it here also makes the e2e mock
  // path (no pubsub replay) deterministic.
  closeForm();
  // After an in-place edit submit, the original entry is voided
  // and replaced. Collapse the detail panel since it was pointing
  // at an entry that's now superseded.
  expandedEntryId.value = null;
  void refresh();
}

function onFormCancel(): void {
  closeForm();
}

// Switching books mid-edit would carry the prior book's draft into
// the new book. Force the panel closed so the next visit starts
// from a blank toolbar — the form's own bookId watcher would also
// reset its internal state, but we want the user back in the
// neutral "+ New entry" surface.
watch(
  () => props.bookId,
  () => {
    closeForm();
    expandedEntryId.value = null;
  },
);

const resolvedFiscalYearEnd = computed<FiscalYearEnd>(() => resolveFiscalYearEnd(props.fiscalYearEnd));

// Default = current fiscal year. Reset by the bookId/fiscalYearEnd
// watcher so switching books or changing the FY-end in settings
// drops a stale custom range from the prior book.
const range = ref<DateRange>(currentFiscalYearRange(resolvedFiscalYearEnd.value));
const accountCode = ref("");
const entries = ref<JournalEntry[]>([]);
const serverVoidedIds = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

function kindLabel(kind: JournalEntryKind): string {
  if (kind === "opening") return t("pluginAccounting.journalList.kind.opening");
  if (kind === "void") return t("pluginAccounting.journalList.kind.void");
  if (kind === "void-marker") return t("pluginAccounting.journalList.kind.voidMarker");
  return t("pluginAccounting.journalList.kind.normal");
}

function formatDebit(value: number): string {
  return `DR ${formatAmount(value, props.currency)}`;
}
function formatCredit(value: number): string {
  return `CR ${formatAmount(value, props.currency)}`;
}
function formatAccountLabel(account: Account): string {
  // Name first so type-to-search in the <select> matches the
  // human-meaningful word; the code goes in trailing parens.
  // Same convention used by JournalEntryForm and Ledger pickers.
  return `${account.name} (${account.code})`;
}
// `entry.createdAt` is server-stamped ISO 8601. We render local
// date+time (no seconds, no timezone) in YYYY-MM-DD HH:MM form to
// match `entry.date`'s style and keep the line compact. Parens are
// baked in here so the template doesn't carry raw text (the
// vue-i18n/no-raw-text rule flags literal strings in mustache).
function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `(${iso})`;
  const pad = (num: number): string => String(num).padStart(2, "0");
  return `(${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())})`;
}
const accountNameByCode = computed(() => {
  const map = new Map<string, string>();
  for (const account of props.accounts) map.set(account.code, account.name);
  return map;
});
function accountNameFor(code: string): string | null {
  return accountNameByCode.value.get(code) ?? null;
}

// Close button on the selected row's lines cell. Has to clear BOTH
// expandedEntryId AND entryBeingEdited — if the user clicks Edit
// (which sets entryBeingEdited) and then clicks Close, leaving
// entryBeingEdited stale would block reopening: toggleExpanded's
// edit-mode guard early-returns when entryBeingEdited.id matches the
// clicked row, so the user could never reopen that entry from the
// list. Issue surfaced by the CodeRabbit review on PR #1161.
function onCloseDetail(): void {
  expandedEntryId.value = null;
  entryBeingEdited.value = null;
}

function toggleExpanded(entryId: string): void {
  // While the row is in edit mode for itself, ignore clicks on the
  // row chrome (date / kind / memo / lines cells) — the user is
  // actively typing into the form below and a stray cell click
  // shouldn't collapse the panel. Cancel / Submit on the form, or
  // clicking a different row, are the deliberate exits.
  if (entryBeingEdited.value?.id === entryId) return;
  expandedEntryId.value = expandedEntryId.value === entryId ? null : entryId;
  // Switching to a different row (or collapsing) drops any
  // in-progress edit on the prior row.
  entryBeingEdited.value = null;
}

function onKeyToggle(event: KeyboardEvent, entryId: string): void {
  if (event.repeat) return;
  toggleExpanded(entryId);
}

function entryHasTaxIds(entry: JournalEntry): boolean {
  return entry.lines.some((line) => Boolean(line.taxRegistrationId));
}

function sumLines(lines: JournalLine[], pick: (line: JournalLine) => number | undefined): number {
  return lines.reduce((acc, line) => acc + (pick(line) ?? 0), 0);
}

function entryDebitTotal(entry: JournalEntry): number {
  return sumLines(entry.lines, (line) => line.debit);
}

function entryCreditTotal(entry: JournalEntry): number {
  return sumLines(entry.lines, (line) => line.credit);
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  loading.value = true;
  error.value = null;
  try {
    const result = await getJournalEntries({
      bookId: props.bookId,
      from: range.value.from || undefined,
      to: range.value.to || undefined,
      accountCode: accountCode.value || undefined,
    });
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      entries.value = [];
      serverVoidedIds.value = [];
      return;
    }
    entries.value = result.data.entries;
    serverVoidedIds.value = result.data.voidedEntryIds;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

const filteredEntries = computed(() => entries.value);

// Visible-list view that pins the entry currently being edited at
// the top when a filter change or pubsub-driven refetch would
// otherwise drop it from `filteredEntries`. Without this, the
// in-place edit form (which is nested under the row's v-if /
// v-for) would unmount and silently discard the user's draft when:
//   • the user adjusts the date range or account filter,
//   • a sibling tab / LLM tool voids the entry out-of-band and the
//     SSE pubsub bumps `bookVersion`, refetching this list,
//   • or a sibling tab / LLM tool deletes the underlying book.
// Pinning the editing entry from the local snapshot (entryBeingEdited)
// keeps the form mounted across all three. The pinned row sits at
// the top of the table while editing; on submit / cancel the
// snapshot clears and the list reverts to filteredEntries.
const visibleEntries = computed<JournalEntry[]>(() => {
  const list = filteredEntries.value;
  const editing = entryBeingEdited.value;
  if (editing && !list.some((entry) => entry.id === editing.id)) {
    return [editing, ...list];
  }
  return list;
});

// Set of original entry ids that have been voided. The server
// computes this from the *unfiltered* journal (so an account-filtered
// query — which drops void-marker rows because they have no lines —
// still strikes out the cancelled original). Source of truth on the
// server is `voidedIdSet()` in journal.ts.
const voidedEntryIds = computed(() => new Set(serverVoidedIds.value));

async function onVoid(entry: JournalEntry): Promise<void> {
  // Single dialog: the prompt is the confirmation. Cancelling
  // (returning null) cancels the void; entering empty text or a
  // reason proceeds.
  const reason = window.prompt(t("pluginAccounting.journalList.voidReason"));
  if (reason === null) return;
  try {
    const result = await voidEntry({ entryId: entry.id, reason: reason || undefined, bookId: props.bookId });
    if (!result.ok) error.value = result.error;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

// Reset to current-year window whenever the active book or its
// fiscal-year end changes. Keeps a custom range from leaking across
// books and follows a settings-driven shift in fiscalYearEnd.
watch(
  () => [props.bookId, resolvedFiscalYearEnd.value],
  () => {
    range.value = currentFiscalYearRange(resolvedFiscalYearEnd.value);
  },
);

watch(() => [props.bookId, props.version, range.value.from, range.value.to, accountCode.value], refresh, { immediate: true });

// Pending preselect: the parent hands us an id via `preselectEntryId`,
// but the matching entry may not be in `entries` yet (the SSE-driven
// refetch lands on its own clock). Stash it here, then the
// [pendingPreselectId, entries] watcher below consumes it once the
// row actually exists in the list — and clears it so subsequent
// unrelated refetches (void events, sibling-tab edits) don't
// re-expand a stale target.
const pendingPreselectId = ref<string | null>(null);

watch(
  () => props.preselectEntryId,
  (incoming) => {
    if (incoming) pendingPreselectId.value = incoming;
  },
  // immediate: true so a late JournalList mount (the View defers our
  // mount until refetchBooks resolves activeBookId) still captures
  // a preselect the parent had already set — without this, a normal
  // watcher misses the "initial value is the target value" case.
  { immediate: true },
);

watch([pendingPreselectId, entries], async ([targetId, list]) => {
  if (!targetId) return;
  if (!list.some((entry) => entry.id === targetId)) return;
  // Always emit `preselectConsumed` (whether we expand or bail) so
  // the parent can drop its `journalPreselectEntryId` ref. Without
  // this one-shot signal, leaving and returning to the journal tab
  // (v-if remount) replays the immediate prop watcher against the
  // stale value, re-expanding an old row the user has already moved
  // past. Issue raised by the Codex automated review on PR #1158.
  if (entryBeingEdited.value) {
    // Don't overwrite an in-progress edit on another row — the
    // user's draft matters more than the highlight. Drop pending so
    // we don't keep retrying every refetch, and signal consumed so
    // the parent doesn't keep re-handing us the same id.
    pendingPreselectId.value = null;
    emit("preselectConsumed");
    return;
  }
  expandedEntryId.value = targetId;
  await nextTick();
  const row =
    document.querySelector(`[data-testid="accounting-journal-row-${targetId}"]`) ??
    document.querySelector(`[data-testid="accounting-journal-row-voided-${targetId}"]`);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  pendingPreselectId.value = null;
  emit("preselectConsumed");
});
</script>

<style scoped>
/* Selection frame for the expanded entry. Borders go on the cells
   (not the <tr>) because border-collapse: collapse — Tailwind's
   default — eats <tr>-level borders/box-shadows. The entry row owns
   top/left/right; the detail-panel row directly below owns
   left/right/bottom, so together they read as one rectangle around
   the selection. Color matches the focus-ring blue used elsewhere
   in this list. */
.row-selected > td {
  background-color: rgb(239 246 255); /* tailwind blue-50 */
  border-top: 2px solid rgb(59 130 246); /* tailwind blue-500 */
}
.row-selected > td:first-child {
  border-left: 2px solid rgb(59 130 246);
}
.row-selected > td:last-child {
  border-right: 2px solid rgb(59 130 246);
}
.detail-selected > td {
  background-color: rgb(239 246 255);
  border-left: 2px solid rgb(59 130 246);
  border-right: 2px solid rgb(59 130 246);
  border-bottom: 2px solid rgb(59 130 246);
}
</style>
