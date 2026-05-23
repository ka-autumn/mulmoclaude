<template>
  <div class="solopreneur-billing-dashboard">
    <!-- Header -->
    <header class="dashboard-header glass-panel">
      <div class="header-left">
        <div>
          <h1 class="header-title">{{ t("title") }}</h1>
          <p class="header-subtitle">{{ t("subtitle") }}</p>
        </div>
      </div>
      <div class="header-right">
        <div class="tab-selectors">
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'invoices' }" @click="activeTab = 'invoices'">
            <span class="material-icons text-sm leading-none">list_alt</span>
            <span>{{ t("invoicesTab") }}</span>
          </button>
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
            <span class="material-icons text-sm leading-none">settings_applications</span>
            <span>{{ t("profileTab") }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Global Alerts -->
    <transition name="fade">
      <div v-if="successMsg" class="alert-banner success glass-panel">
        <span class="material-icons">check_circle</span>
        <span class="alert-text">{{ successMsg }}</span>
        <button class="alert-close" @click="successMsg = ''">{{ timesChar }}</button>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="errorMsg" class="alert-banner error glass-panel">
        <span class="material-icons">error</span>
        <span class="alert-text">{{ errorMsg }}</span>
        <button class="alert-close" @click="errorMsg = ''">{{ timesChar }}</button>
      </div>
    </transition>

    <transition name="slide-down">
      <div
        v-if="copyInstructionText"
        class="alert-banner info glass-panel instruction-panel"
        style="
          padding: 1.25rem;
          border-left: 4px solid #4f46e5;
          background: rgba(79, 70, 229, 0.05);
          margin-top: 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
        "
      >
        <div style="display: flex; align-items: center; gap: 0.5rem">
          <span class="material-icons text-indigo-500 animate-pulse">chat</span>
          <span class="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{{ t("manualBookkeepingTitle") }}</span>
        </div>
        <div class="alert-text" style="display: flex; flex-direction: column; gap: 0.75rem">
          <p style="font-size: 0.8rem; margin: 0; color: #4b5563; dark:color: #9ca3af;">
            {{ t("manualBookkeepingDesc") }}
          </p>
          <pre
            style="margin: 0; font-family: monospace; font-size: 0.8rem; background: rgba(0, 0, 0, 0.06); padding: 0.85rem; rounded: 8px; border: 1px solid rgba(0, 0, 0, 0.08); white-space: pre-wrap; word-break: break-all; select: all; line-height: 1.5; color: #1f2937; dark:color: #f3f4f6;"
            >{{ copyInstructionText }}</pre
          >
          <div style="display: flex; gap: 0.5rem">
            <button class="btn btn-indigo" type="button" style="padding: 0.4rem 0.8rem; font-size: 0.75rem" @click="copyToClipboard(copyInstructionText)">
              <span class="material-icons" style="font-size: 0.85rem">content_copy</span> {{ t("copyToClipboard") }}
            </button>
            <button class="btn btn-slate" type="button" style="padding: 0.4rem 0.8rem; font-size: 0.75rem" @click="copyInstructionText = ''">
              {{ t("dismiss") }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Profile Incomplete Setup Warning Banner -->
    <transition name="slide-down">
      <div v-if="dataLoaded && !settings.companyName && activeTab !== 'settings'" class="setup-warning-banner glass-panel">
        <span class="material-icons warning-icon animate-pulse">warning_amber</span>
        <div class="warning-content">
          <h4 class="warning-title">{{ t("profileWarningTitle") }}</h4>
          <p class="warning-description">
            {{ t("profileWarningDesc") }}
          </p>
        </div>
        <button type="button" class="btn-warning-action" @click="activeTab = 'settings'">
          {{ t("configureProfile") }}
          <span class="material-icons">arrow_forward</span>
        </button>
      </div>
    </transition>

    <!-- Dashboard Content -->
    <main class="dashboard-body">
      <!-- Invoices and Candidates Tab -->
      <div v-if="activeTab === 'invoices'" class="tab-content-grid">
        <!-- List Panel -->
        <div class="lists-column">
          <!-- Draft Billing Candidates -->
          <div class="panel-section glass-panel">
            <h2 class="panel-title">
              <span class="material-icons font-md text-amber-500">pending_actions</span>
              {{ t("draftCandidates") }}
              <span class="badge badge-amber">{{ candidates.length }}</span>
            </h2>

            <div v-if="candidates.length === 0" class="empty-state text-muted">
              <span class="material-icons text-3xl">playlist_add</span>
              <p>{{ t("noDraftCandidates") }}</p>
            </div>

            <ul v-else class="record-list">
              <li
                v-for="cand in candidates"
                :key="cand.candidateId"
                class="record-item"
                :class="{ selected: isCandidate && selectedRecordId === cand.candidateId }"
                role="button"
                tabindex="0"
                :aria-selected="isCandidate && selectedRecordId === cand.candidateId"
                @click="selectRecord(cand, true)"
                @keydown.enter.prevent="selectRecord(cand, true)"
                @keydown.space.prevent="selectRecord(cand, true)"
              >
                <div class="record-meta">
                  <div class="record-client">{{ getClientName(cand.clientId) }}</div>
                  <div class="record-date">{{ formatDate(cand.date) }}</div>
                </div>
                <div class="record-financials">
                  <div class="record-total">{{ yenSign }}{{ cand.total.toLocaleString() }}</div>
                  <span class="status-pill candidate">{{ t("statusDraft") }}</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Committed Invoices -->
          <div class="panel-section glass-panel">
            <h2 class="panel-title">
              <span class="material-icons font-md text-emerald-500">done_all</span>
              {{ t("committedInvoices") }}
              <span class="badge badge-indigo">{{ invoices.length }}</span>
            </h2>

            <div v-if="invoices.length === 0" class="empty-state text-muted">
              <span class="material-icons text-3xl">description</span>
              <p>{{ t("noCommittedInvoices") }}</p>
            </div>

            <ul v-else class="record-list">
              <li
                v-for="inv in invoices"
                :key="inv.id"
                class="record-item"
                :class="{ selected: !isCandidate && selectedRecordId === inv.id }"
                role="button"
                tabindex="0"
                :aria-selected="!isCandidate && selectedRecordId === inv.id"
                @click="selectRecord(inv, false)"
                @keydown.enter.prevent="selectRecord(inv, false)"
                @keydown.space.prevent="selectRecord(inv, false)"
              >
                <div class="record-meta">
                  <div class="record-client">
                    <strong>{{ inv.id }}</strong> {{ emDash }} {{ getClientName(inv.clientId) }}
                  </div>
                  <div class="record-date">{{ formatDate(inv.date) }}</div>
                </div>
                <div class="record-financials">
                  <div class="record-total">{{ yenSign }}{{ inv.total.toLocaleString() }}</div>
                  <span class="status-pill" :class="inv.status">{{ getLocalizedStatus(inv.status) }}</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <!-- Detail Sheet Panel -->
        <div class="detail-column">
          <div v-if="selectedRecord" class="detail-sheet glass-panel">
            <!-- Details Header -->
            <div class="detail-header">
              <div class="detail-header-left">
                <span class="status-pillLarge" :class="recordStatus">
                  {{ getLocalizedStatus(recordStatus) }}
                </span>
                <h3 class="detail-id">{{ recordId }}</h3>
              </div>

              <div class="detail-header-actions">
                <!-- Candidate Actions -->
                <template v-if="isCandidate">
                  <button type="button" class="btn btn-emerald" :disabled="actionPending" @click="approveCandidate">
                    <span class="material-icons">check</span>
                    {{ t("approveAndJournal") }}
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="deleteDraft">
                    <span class="material-icons">delete</span>
                    {{ t("deleteDraft") }}
                  </button>
                </template>

                <!-- Approved Invoices Actions -->
                <template v-else-if="recordStatus === 'approved'">
                  <button type="button" class="btn btn-indigo" :disabled="actionPending" @click="triggerPrintableGeneration">
                    <span class="material-icons">picture_as_pdf</span>
                    {{ t("generatePdf") }}
                  </button>
                  <button type="button" class="btn btn-emerald" :disabled="actionPending" @click="promptMarkPaid">
                    <span class="material-icons">payments</span>
                    {{ t("markPaid") }}
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="promptVoid">
                    <span class="material-icons">block</span>
                    {{ t("void") }}
                  </button>
                </template>

                <!-- Paid Invoices Actions -->
                <template v-else-if="recordStatus === 'paid'">
                  <button type="button" class="btn btn-indigo" :disabled="actionPending" @click="triggerPrintableGeneration">
                    <span class="material-icons">picture_as_pdf</span>
                    {{ t("generatePdf") }}
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="promptVoid">
                    <span class="material-icons">block</span>
                    {{ t("void") }}
                  </button>
                </template>
              </div>
            </div>

            <!-- Detail Meta Rows -->
            <div class="detail-meta-grid">
              <div class="meta-block">
                <span class="meta-label">{{ t("clientRecipient") }}</span>
                <span class="meta-val font-semibold">{{ getClientName(selectedRecord.clientId) }}</span>
              </div>
              <div class="meta-block">
                <span class="meta-label">{{ t("billingDate") }}</span>
                <span class="meta-val">{{ formatDate(selectedRecord.date) }}</span>
              </div>
              <div class="meta-block">
                <span class="meta-label">{{ t("dueDate") }}</span>
                <span class="meta-val">{{ formatDate(selectedRecord.dueDate) }}</span>
              </div>
              <div v-if="recordPaymentRef" class="meta-block">
                <span class="meta-label">{{ t("paymentRef") }}</span>
                <span class="meta-val font-mono">{{ recordPaymentRef }}</span>
              </div>
            </div>

            <!-- Line Items Details Pane -->
            <div class="items-view-pane" style="margin-top: 1rem">
              <table class="items-table">
                <thead>
                  <tr>
                    <th>{{ t("description") }}</th>
                    <th class="text-right">{{ t("qty") }}</th>
                    <th class="text-right">{{ t("rate") }}</th>
                    <th class="text-right">{{ t("amount") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in selectedRecord.items" :key="idx">
                    <td>{{ item.description }}</td>
                    <td class="text-right">{{ item.quantity }}</td>
                    <td class="text-right">{{ yenSign }}{{ item.rate.toLocaleString() }}</td>
                    <td class="text-right font-medium">{{ yenSign }}{{ item.amount.toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>

              <div class="financial-summary-row">
                <div class="financial-summary-box">
                  <div class="summary-line">
                    <span class="line-lbl">{{ t("subtotal") }}</span>
                    <span class="line-val">{{ yenSign }}{{ selectedRecord.subtotal.toLocaleString() }}</span>
                  </div>
                  <div class="summary-line">
                    <span class="line-lbl">{{ t("tax") }}</span>
                    <span class="line-val">{{ yenSign }}{{ selectedRecord.tax.toLocaleString() }}</span>
                  </div>
                  <div class="summary-line total">
                    <span class="line-lbl">{{ t("totalDue") }}</span>
                    <span class="line-val">{{ yenSign }}{{ selectedRecord.total.toLocaleString() }}</span>
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div v-if="selectedRecord.notes" class="notes-section">
                <h4 class="section-title">{{ t("memoNotes") }}</h4>
                <p class="notes-content">{{ selectedRecord.notes }}</p>
              </div>
            </div>
          </div>

          <div v-else class="detail-sheetempty glass-panel">
            <span class="material-icons text-5xl text-slate-300">receipt</span>
            <h3 class="text-slate-400 font-medium mt-2">{{ t("noRecordSelected") }}</h3>
            <p class="text-xs text-slate-400 max-w-xs text-center mt-1">
              {{ t("selectRecordDesc") }}
            </p>
          </div>
        </div>
      </div>

      <!-- Settings Tab -->
      <div v-else class="tab-content-settings glass-panel">
        <h2 class="panel-title border-b border-white/10 pb-4 mb-6">
          <span class="material-icons text-indigo-500 font-md">business</span>
          {{ t("settingsHeader") }}
        </h2>

        <form class="settings-form" @submit.prevent="saveIssuerSettings">
          <div class="form-grid">
            <!-- Company/Legal Name -->
            <div class="form-group col-span-2">
              <label for="companyName">{{ t("legalName") }}</label>
              <input id="companyName" v-model="editSettings.companyName" type="text" placeholder="e.g. 有限会社パーベイシブ" required />
              <span class="help-text">{{ t("legalNameHelp") }}</span>
            </div>

            <!-- T-Number (JP Tax Registration) -->
            <div class="form-group">
              <label for="taxRegistrationId">{{ t("taxId") }}</label>
              <input id="taxRegistrationId" v-model="editSettings.taxRegistrationId" type="text" placeholder="e.g. T1234567890123" />
              <span class="help-text">{{ t("taxIdHelp") }}</span>
            </div>

            <!-- Email Address -->
            <div class="form-group">
              <label for="email">{{ t("email") }}</label>
              <input id="email" v-model="editSettings.email" type="email" placeholder="billing@yourdomain.com" />
              <span class="help-text">{{ t("emailHelp") }}</span>
            </div>

            <!-- Postal/Zip Code -->
            <div class="form-group">
              <label for="postalCode">{{ t("postalCode") }}</label>
              <input id="postalCode" v-model="editSettings.postalCode" type="text" placeholder="100-0001" />
            </div>

            <!-- Detailed Address -->
            <div class="form-group col-span-2">
              <label for="address">{{ t("streetAddress") }}</label>
              <input id="address" v-model="editSettings.address" type="text" placeholder="Chiyoda-ku, Tokyo 1-1-1" />
            </div>

            <!-- Divider -->
            <div class="col-span-3 border-t border-white/10 my-4 pt-4">
              <h3 class="subsection-title">
                <span class="material-icons text-amber-500 font-sm">account_balance</span>
                {{ t("bankTransferHeader") }}
              </h3>
            </div>

            <!-- Bank Name -->
            <div class="form-group">
              <label for="bankName">{{ t("bankName") }}</label>
              <input id="bankName" v-model="editSettings.bankName" type="text" placeholder="e.g. 三菱UFJ銀行" />
            </div>

            <!-- Branch Name -->
            <div class="form-group">
              <label for="bankBranch">{{ t("bankBranch") }}</label>
              <input id="bankBranch" v-model="editSettings.bankBranch" type="text" placeholder="e.g. 本店" />
            </div>

            <!-- Account Type -->
            <div class="form-group">
              <label for="bankAccountType">{{ t("accountType") }}</label>
              <select id="bankAccountType" v-model="editSettings.bankAccountType">
                <option value="ordinary">{{ t("ordinary") }}</option>
                <option value="checking">{{ t("checking") }}</option>
              </select>
            </div>

            <!-- Account Number -->
            <div class="form-group">
              <label for="bankAccountNumber">{{ t("accountNumber") }}</label>
              <input id="bankAccountNumber" v-model="editSettings.bankAccountNumber" type="text" placeholder="1234567" />
            </div>

            <!-- Account Holder -->
            <div class="form-group col-span-2">
              <label for="bankAccountHolder">{{ t("accountHolder") }}</label>
              <input id="bankAccountHolder" v-model="editSettings.bankAccountHolder" type="text" placeholder="e.g. ユウゲンガイシャ パーベイシブ" />
            </div>

            <!-- Ledger Book Integration Divider -->
            <div class="col-span-3 border-t border-white/10 my-4 pt-4">
              <h3 class="subsection-title">
                <span class="material-icons text-indigo-400 font-sm">account_balance_wallet</span>
                {{ t("ledgerIntegrationHeader") }}
              </h3>
            </div>

            <!-- Target Book Dropdown -->
            <div class="form-group col-span-3">
              <label for="accountingBookId">{{ t("targetBook") }}</label>
              <select id="accountingBookId" v-model="editSettings.bookId">
                <option value="">{{ t("autoResolveBook") }}</option>
                <option v-for="bookItem in books" :key="bookItem.id" :value="bookItem.id">
                  {{ bookItem.name }} ({{ bookItem.currency }}{{ commaSep }} {{ bookItem.country || "US" }}{{ rightParenArrow }} {{ bookItem.id }}
                </option>
              </select>
              <span class="help-text">{{ t("targetBookHelp") }}</span>
            </div>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-indigo px-8 py-3 font-semibold shadow-lg">
              <span class="material-icons">save</span>
              {{ t("saveProfile") }}
            </button>
          </div>
        </form>
      </div>
    </main>

    <!-- Payment Prompt Dialog Modal -->
    <transition name="fade">
      <div v-if="showPaymentModal" class="modal-backdrop">
        <div class="modal-card glass-panel">
          <h3 class="modal-title">{{ t("recordSettlement") }}</h3>
          <p class="modal-description">{{ t("recordSettlementDesc", { id: pendingActionId || "" }) }}</p>
          <div class="form-group mt-4">
            <label for="paymentRefInput">{{ t("paymentRefLabel") }}</label>
            <input id="paymentRefInput" v-model="paymentRef" type="text" :placeholder="t('paymentRefPlaceholder')" />
          </div>
          <div class="modal-actions mt-6">
            <button type="button" class="btn btn-slate" @click="showPaymentModal = false">{{ t("cancel") }}</button>
            <button type="button" class="btn btn-emerald" @click="markPaidSubmit">{{ t("markPaid") }}</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Void Prompt Dialog Modal -->
    <transition name="fade">
      <div v-if="showVoidModal" class="modal-backdrop">
        <div class="modal-card glass-panel">
          <h3 class="modal-title text-red-400">{{ t("voidTitle") }}</h3>
          <p class="modal-description">
            {{ t("voidDesc") }}
          </p>
          <div class="form-group mt-4">
            <label for="voidReasonInput">{{ t("voidReasonLabel") }}</label>
            <input id="voidReasonInput" v-model="voidReason" type="text" :placeholder="t('voidReasonPlaceholder')" required />
          </div>
          <div class="modal-actions mt-6">
            <button type="button" class="btn btn-slate" @click="showVoidModal = false">{{ t("cancel") }}</button>
            <button type="button" class="btn btn-danger" @click="voidSubmit">{{ t("confirmVoid") }}</button>
          </div>
        </div>
      </div>
    </transition>
    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { apiPost } from "../../../../src/utils/api";
import { useT, format } from "./lang";
import type { Invoice, InvoiceCandidate, InvoiceSettings, ExtendedToolResultComplete } from "./types";
import type { ParsedClient } from "./io";
import ConfirmModal from "../../shared/components/ConfirmModal.vue";
import { useConfirm } from "../../shared/components/confirm";

interface Book {
  id: string;
  name: string;
  currency: string;
  country?: string;
}

const props = defineProps<{
  selectedResult?: ExtendedToolResultComplete;
  sendTextMessage?: (text?: string) => void;
}>();

const { dispatch, pubsub, log } = useRuntime();
const { openConfirm } = useConfirm();

// Layout symbols to avoid i18n raw text warnings
const timesChar = "×";
const yenSign = "¥";
const emDash = "—";
const commaSep = ",";
const rightParenArrow = ") —";

const messages = useT();

// eslint-disable-next-line id-length
function t(key: keyof typeof messages.value, params?: Record<string, string | number>): string {
  const template = messages.value[key];
  return params ? format(template, params) : template;
}

function getLocalizedStatus(status: string): string {
  switch (status) {
    case "draft":
      return t("statusDraft");
    case "approved":
      return t("statusApproved");
    case "paid":
      return t("statusPaid");
    case "void":
      return t("statusVoid");
    default:
      return status;
  }
}

// UI Navigation and alerts
const activeTab = ref<"invoices" | "settings">("invoices");
const successMsg = ref("");
const errorMsg = ref("");
const copyInstructionText = ref("");
const actionPending = ref(false);
const dataLoaded = ref(false);

// Local DB State
const invoices = ref<Invoice[]>([]);
const candidates = ref<InvoiceCandidate[]>([]);
const settings = ref<InvoiceSettings>({
  companyName: "",
  taxRegistrationId: "",
  postalCode: "",
  address: "",
  email: "",
  bankName: "",
  bankBranch: "",
  bankAccountType: "ordinary",
  bankAccountNumber: "",
  bankAccountHolder: "",
  bookId: "",
  bookName: "",
});

const clients = ref<ParsedClient[]>([]);
const books = ref<Book[]>([]);

// Selection State
const selectedRecordId = ref<string | null>(null);
const isCandidate = ref(false);

// Form / Modal States
const editSettings = ref<InvoiceSettings>({ ...settings.value });
const showPaymentModal = ref(false);
const showVoidModal = ref(false);
const pendingActionId = ref<string | null>(null);
const paymentRef = ref("");
const voidReason = ref("");

// Computed selection mapping
const selectedRecord = computed<Invoice | InvoiceCandidate | null>(() => {
  if (!selectedRecordId.value) return null;
  if (isCandidate.value) {
    return candidates.value.find((cand) => cand.candidateId === selectedRecordId.value) || null;
  }
  return invoices.value.find((inv) => inv.id === selectedRecordId.value) || null;
});

const recordId = computed(() => {
  if (!selectedRecord.value) return "";
  return isCandidate.value ? (selectedRecord.value as InvoiceCandidate).candidateId : (selectedRecord.value as Invoice).id;
});

const recordStatus = computed(() => {
  if (!selectedRecord.value) return "draft";
  return isCandidate.value ? "draft" : (selectedRecord.value as Invoice).status;
});

const recordPaymentRef = computed(() => {
  if (!selectedRecord.value || isCandidate.value) return undefined;
  return (selectedRecord.value as Invoice).paymentRef;
});

// Load all details in one swoop
// eslint-disable-next-line complexity
async function loadData() {
  try {
    const res = (await dispatch({ action: "list" })) as {
      ok: boolean;
      jsonData?: {
        invoices?: Invoice[];
        candidates?: InvoiceCandidate[];
        clients?: ParsedClient[];
        settings?: InvoiceSettings;
      };
    };
    if (res?.ok && res?.jsonData) {
      invoices.value = res.jsonData.invoices || [];
      candidates.value = res.jsonData.candidates || [];
      clients.value = res.jsonData.clients || [];
      settings.value = res.jsonData.settings || {
        companyName: "",
        taxRegistrationId: "",
        postalCode: "",
        address: "",
        email: "",
        bankName: "",
        bankBranch: "",
        bankAccountType: "ordinary",
        bankAccountNumber: "",
        bankAccountHolder: "",
        bookId: "",
        bookName: "",
      };
      editSettings.value = { ...settings.value };
    }

    // Dynamic book fetching via standard API
    try {
      const booksRes = await apiPost<{ ok: boolean; jsonData?: { books?: Book[] } }>("/api/accounting", { action: "getBooks" });
      if (booksRes.ok && booksRes.data?.jsonData?.books) {
        books.value = booksRes.data.jsonData.books;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error("Failed to dynamically fetch available accounting books", { error: errorMessage });
    }
  } catch (err) {
    errorMsg.value = "Failed to load bookkeeping and invoice data.";
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error("Data loading failed", { error: errorMessage });
  } finally {
    dataLoaded.value = true;
  }
}

// Helpers
function getClientName(clientId: string): string {
  const foundClient = clients.value.find((client) => client.id === clientId || client.name === clientId);
  return foundClient ? foundClient.name : clientId;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

function selectRecord(record: Invoice | InvoiceCandidate, candMode: boolean) {
  selectedRecordId.value = candMode ? (record as InvoiceCandidate).candidateId : (record as Invoice).id;
  isCandidate.value = candMode;
}

// Write-actions
async function saveIssuerSettings() {
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const selectedBook = books.value.find((bookItem) => bookItem.id === editSettings.value.bookId);
    editSettings.value.bookName = selectedBook ? selectedBook.name : "";

    const res = (await dispatch({ action: "saveSettings", settings: editSettings.value })) as { ok: boolean; error?: string };
    if (res?.ok) {
      settings.value = { ...editSettings.value };
      successMsg.value = t("settingsSaved");
    } else {
      errorMsg.value = res?.error || t("settingsSaveFailed");
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
  }
}

async function handleBookkeepingInstruction(instruction: string) {
  if (props.sendTextMessage) {
    props.sendTextMessage(instruction);
  } else {
    try {
      const chatRes = (await dispatch({
        action: "startAccountingChat",
        message: instruction,
      })) as { ok: boolean; jsonData?: { chatId?: string }; error?: string };
      if (chatRes?.ok && chatRes?.jsonData?.chatId) {
        successMsg.value += t("redirectingAccounting");
        const nextChatId = chatRes.jsonData.chatId;
        setTimeout(() => {
          window.location.href = `/chat/${nextChatId}`;
        }, 1200);
      } else {
        copyInstructionText.value = instruction;
        errorMsg.value = chatRes?.error || "";
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error("Failed to start accounting chat", { error: errMsg });
      copyInstructionText.value = instruction;
    }
  }
}

async function approveCandidate() {
  if (!selectedRecord.value) return;
  const confirmed = await openConfirm({
    title: t("approveConfirmTitle"),
    message: t("approveConfirmMsg"),
    confirmText: t("approveAndJournal"),
    variant: "success",
  });
  if (!confirmed) return;

  const currentCandId = selectedRecordId.value;
  if (!currentCandId) return;

  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  copyInstructionText.value = "";
  try {
    const res = (await dispatch({ action: "candidateApprove", id: currentCandId })) as {
      ok: boolean;
      jsonData?: { invoice?: Invoice };
      error?: string;
    };
    if (res?.ok && res?.jsonData) {
      const { invoice } = res.jsonData;
      if (invoice) {
        successMsg.value = t("recordSuccess", { id: invoice.id });
        const nextId = invoice.id;
        const clientName = getClientName(invoice.clientId);
        const bookId = settings.value.bookId || "";
        const bookName = settings.value.bookName || "";

        await loadData();
        selectedRecordId.value = nextId;
        isCandidate.value = false;

        const instruction =
          `Please record the double-entry bookkeeping journal entries for approved Invoice ${nextId}.\n` +
          `Total: ¥${invoice.total.toLocaleString()} (Subtotal: ¥${invoice.subtotal.toLocaleString()}, Tax: ¥${invoice.tax.toLocaleString()})\n` +
          `Date: ${invoice.date}\n` +
          `Client: ${clientName}\n` +
          `Book ID: ${bookId} (${bookName})`;

        await handleBookkeepingInstruction(instruction);
      } else {
        errorMsg.value = t("approveFailed");
      }
    } else {
      errorMsg.value = res?.error || t("approveFailed");
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
  }
}

async function deleteDraft() {
  if (!selectedRecord.value) return;
  const confirmed = await openConfirm({
    title: t("discardConfirmTitle"),
    message: t("discardConfirmMsg"),
    confirmText: t("deleteDraft"),
    variant: "danger",
  });
  if (!confirmed) return;

  const currentCandId = selectedRecordId.value;
  if (!currentCandId) return;

  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({ action: "candidateDelete", id: currentCandId })) as { ok: boolean; error?: string };
    if (res?.ok) {
      successMsg.value = t("discardedMsg");
      selectedRecordId.value = null;
      await loadData();
    } else {
      errorMsg.value = res?.error || t("discardedMsg");
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
  }
}

function promptMarkPaid() {
  if (!selectedRecord.value) return;
  pendingActionId.value = selectedRecordId.value;
  paymentRef.value = "Bank Transfer";
  showPaymentModal.value = true;
}

async function markPaidSubmit() {
  if (!pendingActionId.value) return;
  const currentActionId = pendingActionId.value;
  const currentPaymentRef = paymentRef.value;

  showPaymentModal.value = false;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  copyInstructionText.value = "";
  try {
    const res = (await dispatch({
      action: "invoiceMarkPaid",
      id: currentActionId,
      paymentRef: currentPaymentRef,
    })) as {
      ok: boolean;
      jsonData?: { invoice?: Invoice };
      error?: string;
    };
    if (res?.ok && res?.jsonData) {
      const { invoice } = res.jsonData;
      if (invoice) {
        successMsg.value = t("markPaidSuccess", { id: invoice.id });
        const bookId = settings.value.bookId || "";
        const bookName = settings.value.bookName || "";

        await loadData();

        const instruction =
          `Invoice PAID: ${invoice.id}\n` +
          `Total: ¥${invoice.total.toLocaleString()}\n` +
          `Reference: ${currentPaymentRef || "Bank Transfer"}\n\n` +
          `Please record the cash receipt journal entries (debit Checking/Cash, credit Accounts Receivable) for this paid invoice into the ledger book ID: "${bookId}" (Name: ${bookName}).`;

        await handleBookkeepingInstruction(instruction);
      } else {
        errorMsg.value = t("markPaidFailed");
      }
    } else {
      errorMsg.value = res?.error || t("markPaidFailed");
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
    pendingActionId.value = null;
  }
}

function promptVoid() {
  if (!selectedRecord.value) return;
  pendingActionId.value = selectedRecordId.value;
  voidReason.value = "";
  showVoidModal.value = true;
}

async function voidSubmit() {
  if (!pendingActionId.value || !voidReason.value) return;
  const currentActionId = pendingActionId.value;
  const currentVoidReason = voidReason.value;

  showVoidModal.value = false;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  copyInstructionText.value = "";
  try {
    const res = (await dispatch({
      action: "invoiceVoid",
      id: currentActionId,
      voidReason: currentVoidReason,
    })) as {
      ok: boolean;
      jsonData?: { invoice?: Invoice };
      error?: string;
    };
    if (res?.ok && res?.jsonData) {
      const { invoice } = res.jsonData;
      if (invoice) {
        successMsg.value = t("voidSuccess", { id: invoice.id });
        const bookId = settings.value.bookId || "";
        const bookName = settings.value.bookName || "";

        await loadData();

        const instruction =
          `Invoice VOIDED: ${invoice.id}\n` +
          `Reason: ${currentVoidReason || "Duplicate invoice"}\n\n` +
          `Please scan and void all journal entries associated with Invoice ${invoice.id} in the ledger book ID: "${bookId}" (Name: ${bookName}).`;

        await handleBookkeepingInstruction(instruction);
      } else {
        errorMsg.value = t("voidFailed");
      }
    } else {
      errorMsg.value = res?.error || t("voidFailed");
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
    pendingActionId.value = null;
  }
}

// Generate Printable Layout using AI Chat
// eslint-disable-next-line complexity
async function triggerPrintableGeneration() {
  const currentId = selectedRecordId.value;
  if (!currentId) return;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    if (props.sendTextMessage) {
      const res = (await dispatch({
        action: "getPrintablePrompt",
        id: currentId,
      })) as { ok: boolean; jsonData?: { prompt?: string }; error?: string };
      if (res?.ok && res?.jsonData?.prompt) {
        props.sendTextMessage(res.jsonData.prompt);
        successMsg.value = t("pdfSuccess");
      } else {
        errorMsg.value = res?.error || t("pdfFailed");
      }
    } else {
      const res = (await dispatch({
        action: "startPrintableGenerationChat",
        id: currentId,
      })) as { ok: boolean; jsonData?: { chatId?: string }; error?: string };
      if (res?.ok && res?.jsonData?.chatId) {
        successMsg.value = t("pdfSuccessChat");
        const nextChatId = res.jsonData.chatId;
        setTimeout(() => {
          window.location.href = `/chat/${nextChatId}`;
        }, 1200);
      } else {
        errorMsg.value = res?.error || t("pdfFailedChat");
      }
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    actionPending.value = false;
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    successMsg.value = t("clipboardSuccess");
  } catch (err) {
    errorMsg.value = t("clipboardFailed");
    log.error("Clipboard copy failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

// Subscriptions
let unsubSubscribe: (() => void) | null = null;
onMounted(async () => {
  await loadData();

  const args = props.selectedResult?.args;
  // If the dashboard was opened as a result of saving settings, focus the settings tab
  if (args?.action === "saveSettings") {
    activeTab.value = "settings";
  }

  // If opened as the result of a new invoice candidate, automatically select it
  const candidate = props.selectedResult?.jsonData?.candidate as InvoiceCandidate | undefined;
  if (candidate?.candidateId) {
    selectedRecordId.value = candidate.candidateId;
    isCandidate.value = true;
  }

  unsubSubscribe = pubsub.subscribe("changed", () => {
    void loadData();
  });
});

onUnmounted(() => {
  if (unsubSubscribe) unsubSubscribe();
});
</script>

<style scoped>
/* Glassmorphism Design System */
.solopreneur-billing-dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.5rem;
  overflow-y: auto;
  gap: 1.25rem;
  background: radial-gradient(circle at 10% 20%, rgba(26, 54, 93, 0.05) 0%, rgba(255, 255, 255, 0) 90%);
  color: #334155;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.04);
}

.dark .glass-panel {
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Header */
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 2rem;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
}

.header-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
}

.dark .header-title {
  color: #f8fafc;
}

.header-subtitle {
  font-size: 0.8rem;
  margin: 2px 0 0;
  color: #64748b;
}

/* Tabs */
.tab-selectors {
  display: flex;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  background: #ffffff;
}

.dark .tab-selectors {
  border-color: #334155;
  background: #0f172a;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: 2rem;
  padding: 0 0.625rem;
  border: none;
  border-right: 1px solid #cbd5e1;
  background: #ffffff;
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.tab-btn:last-child {
  border-right: none;
}

.tab-btn:hover {
  background: #f8fafc;
  color: #1e293b;
}

.dark .tab-btn {
  background: #0f172a;
  border-right-color: #334155;
  color: #94a3b8;
}

.dark .tab-btn:hover {
  background: #1e293b;
  color: #f8fafc;
}

.tab-btn.active {
  background: #eef2ff;
  color: #4f46e5;
}

.dark .tab-btn.active {
  background: rgba(79, 70, 229, 0.15);
  color: #818cf8;
}

/* Warnings and Alerts */
.setup-warning-banner {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1rem 1.5rem;
  border-left: 4px solid #d97706;
  background: rgba(217, 119, 6, 0.05);
}

.warning-icon {
  font-size: 2rem;
  color: #d97706;
}

.warning-content {
  flex: 1;
}

.warning-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: #b45309;
}

.dark .warning-title {
  color: #fbbf24;
}

.warning-description {
  font-size: 0.825rem;
  margin: 3px 0 0;
  color: #6e4e11;
  line-height: 1.4;
}

.dark .warning-description {
  color: #f3f4f6;
}

.btn-warning-action {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  font-size: 0.825rem;
  font-weight: 600;
  border: none;
  background: #d97706;
  color: white;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-warning-action:hover {
  background: #b55f05;
  transform: translateX(2px);
}

/* Alert Banners */
.alert-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.25rem;
  font-size: 0.875rem;
  position: relative;
}

.alert-banner.success {
  border-left: 4px solid #10b981;
  background: rgba(16, 185, 129, 0.04);
  color: #065f46;
}

.dark .alert-banner.success {
  color: #a7f3d0;
}

.alert-banner.error {
  border-left: 4px solid #ef4444;
  background: rgba(239, 68, 68, 0.04);
  color: #991b1b;
}

.dark .alert-banner.error {
  color: #fca5a5;
}

.alert-text {
  flex: 1;
  font-weight: 500;
}

.alert-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
}

.alert-close:hover {
  opacity: 1;
}

/* Grid Layout */
.tab-content-grid {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 1.25rem;
  align-items: start;
}

.lists-column {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.panel-section {
  padding: 1.25rem;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 1rem;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dark .panel-title {
  color: #cbd5e1;
}

.badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  border-radius: 9999px;
  font-weight: 700;
  margin-left: 0.25rem;
}

.badge-amber {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}

.badge-indigo {
  background: rgba(99, 102, 241, 0.15);
  color: #4f46e5;
}

/* Record Lists */
.record-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.record-item {
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s ease;
}

.dark .record-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.record-item:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.dark .record-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.record-item.selected {
  background: rgba(37, 99, 235, 0.06);
  border-color: rgba(37, 99, 235, 0.25);
}

.dark .record-item.selected {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.2);
}

.record-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.record-client {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
}

.dark .record-client {
  color: #f1f5f9;
}

.record-date {
  font-size: 0.725rem;
  color: #64748b;
}

.record-financials {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.record-total {
  font-size: 0.875rem;
  font-weight: 700;
  color: #0f172a;
}

.dark .record-total {
  color: #f8fafc;
}

/* Status Pills */
.status-pill {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-pill.candidate {
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
}

.status-pill.approved {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}

.status-pill.paid {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.status-pill.void {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

/* Detail Sheet Column */
.detail-column {
  position: sticky;
  top: 1.5rem;
}

.detail-sheet {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 500px;
}

.detail-sheetempty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 3rem;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  padding-bottom: 1rem;
}

.dark .detail-header {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-pillLarge {
  font-size: 0.7rem;
  font-weight: 800;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.status-pillLarge.candidate {
  background: #f59e0b;
  color: white;
}

.status-pillLarge.approved {
  background: #2563eb;
  color: white;
}

.status-pillLarge.paid {
  background: #10b981;
  color: white;
}

.status-pillLarge.void {
  background: #ef4444;
  color: white;
}

.detail-id {
  font-size: 1.15rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
}

.dark .detail-id {
  color: #f1f5f9;
}

.detail-header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn .material-icons {
  font-size: 1rem;
}

.btn-indigo {
  background: #4f46e5;
  color: white;
}

.btn-indigo:hover:not(:disabled) {
  background: #4338ca;
  transform: translateY(-1px);
}

.btn-emerald {
  background: #059669;
  color: white;
}

.btn-emerald:hover:not(:disabled) {
  background: #047857;
  transform: translateY(-1px);
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
  transform: translateY(-1px);
}

.btn-slate {
  background: rgba(0, 0, 0, 0.05);
  color: #475569;
}

.dark .btn-slate {
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
}

.btn-slate:hover {
  background: rgba(0, 0, 0, 0.1);
}

.dark .btn-slate:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Detail Metadata Grid */
.detail-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 1rem;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  padding: 1rem;
}

.dark .detail-meta-grid {
  background: rgba(0, 0, 0, 0.1);
}

.meta-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.meta-label {
  font-size: 0.7rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-val {
  font-size: 0.85rem;
  font-weight: 500;
  color: #334155;
}

.dark .meta-val {
  color: #e2e8f0;
}

/* View Mode Tabs */
.view-mode-tabs {
  display: flex;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  margin-top: 0.5rem;
}

.dark .view-mode-tabs {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.view-mode-btn {
  padding: 0.5rem 1.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #64748b;
  border: none;
  background: none;
  cursor: pointer;
  position: relative;
  transition: color 0.2s ease;
}

.view-mode-btn:hover {
  color: #1e293b;
}

.dark .view-mode-btn:hover {
  color: #f8fafc;
}

.view-mode-btn.active {
  color: #2563eb;
}

.view-mode-btn.active::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #2563eb;
}

/* Line Items Table */
.items-view-pane {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.items-table th {
  padding: 0.75rem 0.5rem;
  text-align: left;
  border-bottom: 2px solid rgba(0, 0, 0, 0.05);
  color: #64748b;
  font-weight: 600;
}

.dark .items-table th {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.items-table td {
  padding: 0.75rem 0.5rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.03);
}

.dark .items-table td {
  border-bottom-color: rgba(255, 255, 255, 0.02);
}

.financial-summary-row {
  display: flex;
  justify-content: flex-end;
}

.financial-summary-box {
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.summary-line {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #64748b;
}

.summary-line.total {
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding-top: 0.5rem;
}

.dark .summary-line.total {
  color: #f8fafc;
  border-top-color: rgba(255, 255, 255, 0.1);
}

.notes-section {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  padding: 0.75rem 1rem;
}

.dark .notes-section {
  background: rgba(255, 255, 255, 0.02);
}

.section-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 0.25rem;
  letter-spacing: 0.5px;
}

.notes-content {
  font-size: 0.8rem;
  margin: 0;
  line-height: 1.4;
  color: #475569;
}

.dark .notes-content {
  color: #cbd5e1;
}

/* Printable Layout Preview Pane */
.preview-view-pane {
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  padding: 1.25rem;
  max-height: 600px;
  overflow-y: auto;
}

.dark .preview-view-pane {
  background: #182235;
  border-color: rgba(255, 255, 255, 0.05);
}

.invoice-markdown-body :deep(h1),
.invoice-markdown-body :deep(h2),
.invoice-markdown-body :deep(h3),
.invoice-markdown-body :deep(h4),
.invoice-markdown-body :deep(p),
.invoice-markdown-body :deep(span),
.invoice-markdown-body :deep(div),
.invoice-markdown-body :deep(td),
.invoice-markdown-body :deep(th) {
  color: #1e293b !important;
}

.invoice-markdown-body :deep(tr[style*="color: white"] td),
.invoice-markdown-body :deep(tr[style*="color:white"] td),
.invoice-markdown-body :deep(tr[style*="color: #ffffff"] td),
.invoice-markdown-body :deep(tr[style*="color:#ffffff"] td) {
  color: #ffffff !important;
}

.dark .invoice-markdown-body :deep(h1),
.dark .invoice-markdown-body :deep(h2),
.dark .invoice-markdown-body :deep(h3),
.dark .invoice-markdown-body :deep(h4),
.dark .invoice-markdown-body :deep(p),
.dark .invoice-markdown-body :deep(span),
.dark .invoice-markdown-body :deep(div),
.dark .invoice-markdown-body :deep(td),
.dark .invoice-markdown-body :deep(th) {
  color: #e2e8f0 !important;
}

.dark .invoice-markdown-body :deep(tr[style*="color: white"] td),
.dark .invoice-markdown-body :deep(tr[style*="color:white"] td),
.dark .invoice-markdown-body :deep(tr[style*="color: #ffffff"] td),
.dark .invoice-markdown-body :deep(tr[style*="color:#ffffff"] td) {
  color: #ffffff !important;
}

/* Settings Form Tab */
.tab-content-settings {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.subsection-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
  color: #475569;
}

.dark .subsection-title {
  color: #cbd5e1;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.col-span-2 {
  grid-span: 2;
  grid-column: span 2 / span 2;
}

.col-span-3 {
  grid-column: span 3 / span 3;
}

.form-group label {
  font-size: 0.775rem;
  font-weight: 700;
  color: #475569;
}

.dark .form-group label {
  color: #cbd5e1;
}

.form-group input,
.form-group select {
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.4);
  font-size: 0.85rem;
  color: #1e293b;
  outline: none;
  transition: all 0.2s ease;
}

.dark .form-group input,
.dark .form-group select {
  background: rgba(0, 0, 0, 0.2);
  border-color: rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
}

.form-group input:focus,
.form-group select:focus {
  border-color: #2563eb;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.dark .form-group input:focus,
.dark .form-group select:focus {
  background: #0f172a;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.help-text {
  font-size: 0.675rem;
  color: #64748b;
}

.settings-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 1rem;
}

/* Modals */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  width: 440px;
  max-width: 90%;
  padding: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

.modal-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
}

.dark .modal-title {
  color: #f1f5f9;
}

.modal-description {
  font-size: 0.825rem;
  color: #475569;
  line-height: 1.4;
  margin: 0;
}

.dark .modal-description {
  color: #cbd5e1;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Animations */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-20px);
  opacity: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  gap: 0.5rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.8rem;
  text-align: center;
}
</style>
