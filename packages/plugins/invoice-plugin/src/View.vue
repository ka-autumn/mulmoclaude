<template>
  <div class="solopreneur-billing-dashboard">
    <!-- Header -->
    <header class="dashboard-header glass-panel">
      <div class="header-left">
        <span class="material-icons header-icon">receipt_long</span>
        <div>
          <h1 class="header-title">SOLOPRENEUR BILLING</h1>
          <p class="header-subtitle">Invoice management & automated double-entry bookkeeping</p>
        </div>
      </div>
      <div class="header-right">
        <div class="tab-selectors">
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'invoices' }" @click="activeTab = 'invoices'">
            <span class="material-icons text-sm">list_alt</span>
            Invoices & Candidates
          </button>
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
            <span class="material-icons text-sm">settings_applications</span>
            Issuer Profile
          </button>
        </div>
      </div>
    </header>

    <!-- Global Alerts -->
    <transition name="fade">
      <div v-if="successMsg" class="alert-banner success glass-panel">
        <span class="material-icons">check_circle</span>
        <span class="alert-text">{{ successMsg }}</span>
        <button class="alert-close" @click="successMsg = ''">&times;</button>
      </div>
    </transition>

    <transition name="fade">
      <div v-if="errorMsg" class="alert-banner error glass-panel">
        <span class="material-icons">error</span>
        <span class="alert-text">{{ errorMsg }}</span>
        <button class="alert-close" @click="errorMsg = ''">&times;</button>
      </div>
    </transition>

    <!-- Profile Incomplete Setup Warning Banner -->
    <transition name="slide-down">
      <div v-if="dataLoaded && !settings.companyName && activeTab !== 'settings'" class="setup-warning-banner glass-panel">
        <span class="material-icons warning-icon animate-pulse">warning_amber</span>
        <div class="warning-content">
          <h4 class="warning-title">Issuer Profile Incomplete</h4>
          <p class="warning-description">
            Your billing details and JP T-number are not configured yet. Set up your issuer profile in the
            <strong>Issuer Profile</strong> tab to enable beautiful AI layout generation, correct T-number inclusion, and double-entry books mapping.
          </p>
        </div>
        <button type="button" class="btn-warning-action" @click="activeTab = 'settings'">
          Configure Profile
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
              Draft Candidates
              <span class="badge badge-amber">{{ candidates.length }}</span>
            </h2>

            <div v-if="candidates.length === 0" class="empty-state text-muted">
              <span class="material-icons text-3xl">playlist_add</span>
              <p>No billing drafts. Ask Claude to create one from your worklogs!</p>
            </div>

            <ul v-else class="record-list">
              <li
                v-for="cand in candidates"
                :key="cand.candidateId"
                class="record-item"
                :class="{ selected: isCandidate && selectedRecordId === cand.candidateId }"
                @click="selectRecord(cand, true)"
              >
                <div class="record-meta">
                  <div class="record-client">{{ getClientName(cand.clientId) }}</div>
                  <div class="record-date">{{ formatDate(cand.date) }}</div>
                </div>
                <div class="record-financials">
                  <div class="record-total">¥{{ cand.total.toLocaleString() }}</div>
                  <span class="status-pill candidate">draft</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Committed Invoices -->
          <div class="panel-section glass-panel">
            <h2 class="panel-title">
              <span class="material-icons font-md text-emerald-500">done_all</span>
              Committed Invoices
              <span class="badge badge-indigo">{{ invoices.length }}</span>
            </h2>

            <div v-if="invoices.length === 0" class="empty-state text-muted">
              <span class="material-icons text-3xl">description</span>
              <p>No committed invoices yet.</p>
            </div>

            <ul v-else class="record-list">
              <li
                v-for="inv in invoices"
                :key="inv.id"
                class="record-item"
                :class="{ selected: !isCandidate && selectedRecordId === inv.id }"
                @click="selectRecord(inv, false)"
              >
                <div class="record-meta">
                  <div class="record-client">
                    <strong>{{ inv.id }}</strong> — {{ getClientName(inv.clientId) }}
                  </div>
                  <div class="record-date">{{ formatDate(inv.date) }}</div>
                </div>
                <div class="record-financials">
                  <div class="record-total">¥{{ inv.total.toLocaleString() }}</div>
                  <span class="status-pill" :class="inv.status">{{ inv.status }}</span>
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
                  {{ recordStatus }}
                </span>
                <h3 class="detail-id">{{ recordId }}</h3>
              </div>

              <div class="detail-header-actions">
                <!-- Candidate Actions -->
                <template v-if="isCandidate">
                  <button type="button" class="btn btn-emerald" :disabled="actionPending" @click="approveCandidate">
                    <span class="material-icons">check</span>
                    Approve & Journal
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="deleteDraft">
                    <span class="material-icons">delete</span>
                    Delete Draft
                  </button>
                </template>

                <!-- Approved Invoices Actions -->
                <template v-else-if="recordStatus === 'approved'">
                  <button type="button" class="btn btn-indigo" :disabled="actionPending" @click="triggerPrintableGeneration">
                    <span class="material-icons">auto_awesome</span>
                    Generate Layout (AI)
                  </button>
                  <button type="button" class="btn btn-emerald" :disabled="actionPending" @click="promptMarkPaid">
                    <span class="material-icons">payments</span>
                    Mark Paid
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="promptVoid">
                    <span class="material-icons">block</span>
                    Void
                  </button>
                </template>

                <!-- Paid Invoices Actions -->
                <template v-else-if="recordStatus === 'paid'">
                  <button type="button" class="btn btn-indigo" :disabled="actionPending" @click="triggerPrintableGeneration">
                    <span class="material-icons">auto_awesome</span>
                    Generate Layout (AI)
                  </button>
                  <button type="button" class="btn btn-danger" :disabled="actionPending" @click="promptVoid">
                    <span class="material-icons">block</span>
                    Void
                  </button>
                </template>
              </div>
            </div>

            <!-- Detail Meta Rows -->
            <div class="detail-meta-grid">
              <div class="meta-block">
                <span class="meta-label">Client / Recipient</span>
                <span class="meta-val font-semibold">{{ getClientName(selectedRecord.clientId) }}</span>
              </div>
              <div class="meta-block">
                <span class="meta-label">Billing Date</span>
                <span class="meta-val">{{ formatDate(selectedRecord.date) }}</span>
              </div>
              <div class="meta-block">
                <span class="meta-label">Due Date</span>
                <span class="meta-val">{{ formatDate(selectedRecord.dueDate) }}</span>
              </div>
              <div v-if="recordPaymentRef" class="meta-block">
                <span class="meta-label">Payment Ref</span>
                <span class="meta-val font-mono">{{ recordPaymentRef }}</span>
              </div>
            </div>

            <!-- View Modes Tabs -->
            <div class="view-mode-tabs">
              <button type="button" class="view-mode-btn" :class="{ active: viewMode === 'details' }" @click="viewMode = 'details'">Line Items</button>
              <button type="button" class="view-mode-btn" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">
                Printable Layout Preview
              </button>
            </div>

            <!-- Details Content Mode -->
            <div v-if="viewMode === 'details'" class="items-view-pane">
              <table class="items-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th class="text-right">Qty</th>
                    <th class="text-right">Rate</th>
                    <th class="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in selectedRecord.items" :key="idx">
                    <td>{{ item.description }}</td>
                    <td class="text-right">{{ item.quantity }}</td>
                    <td class="text-right">¥{{ item.rate.toLocaleString() }}</td>
                    <td class="text-right font-medium">¥{{ item.amount.toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>

              <div class="financial-summary-row">
                <div class="financial-summary-box">
                  <div class="summary-line">
                    <span class="line-lbl">Subtotal:</span>
                    <span class="line-val">¥{{ selectedRecord.subtotal.toLocaleString() }}</span>
                  </div>
                  <div class="summary-line">
                    <span class="line-lbl">Tax (10%):</span>
                    <span class="line-val">¥{{ selectedRecord.tax.toLocaleString() }}</span>
                  </div>
                  <div class="summary-line total">
                    <span class="line-lbl">Total Due:</span>
                    <span class="line-val">¥{{ selectedRecord.total.toLocaleString() }}</span>
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div v-if="selectedRecord.notes" class="notes-section">
                <h4 class="section-title">Memo / Internal Notes</h4>
                <p class="notes-content">{{ selectedRecord.notes }}</p>
              </div>
            </div>

            <!-- Printable Layout Preview Mode -->
            <div v-else class="preview-view-pane">
              <div class="markdown-preview-container">
                <!-- eslint-disable-next-line vue/no-v-html -- render compiled template verbatim -->
                <div class="markdown-body invoice-markdown-body" v-html="renderedInvoiceTemplate"></div>
              </div>
            </div>
          </div>

          <div v-else class="detail-sheetempty glass-panel">
            <span class="material-icons text-5xl text-slate-300">receipt</span>
            <h3 class="text-slate-400 font-medium mt-2">No Record Selected</h3>
            <p class="text-xs text-slate-400 max-w-xs text-center mt-1">
              Select any billing candidate draft or committed invoice from the lists on the left to inspect details.
            </p>
          </div>
        </div>
      </div>

      <!-- Settings Tab -->
      <div v-else class="tab-content-settings glass-panel">
        <h2 class="panel-title border-b border-white/10 pb-4 mb-6">
          <span class="material-icons text-indigo-500 font-md">business</span>
          Invoice Issuer Business Profile
        </h2>

        <form @submit.prevent="saveIssuerSettings" class="settings-form">
          <div class="form-grid">
            <!-- Company/Legal Name -->
            <div class="form-group col-span-2">
              <label for="companyName">Legal Issuer Name (Company or Solopreneur)</label>
              <input id="companyName" v-model="editSettings.companyName" type="text" placeholder="e.g. 有限会社パーベイシブ" required />
              <span class="help-text">Your trade or legal company name printed on the invoice header.</span>
            </div>

            <!-- T-Number (JP Tax Registration) -->
            <div class="form-group">
              <label for="taxRegistrationId">JP Tax Registration ID (T-number)</label>
              <input id="taxRegistrationId" v-model="editSettings.taxRegistrationId" type="text" placeholder="e.g. T1234567890123" />
              <span class="help-text">Consumption Tax registration ID under Japanese Invoice System.</span>
            </div>

            <!-- Email Address -->
            <div class="form-group">
              <label for="email">Billing Contact Email</label>
              <input id="email" v-model="editSettings.email" type="email" placeholder="billing@yourdomain.com" />
              <span class="help-text">Where clients can send inquiries regarding this bill.</span>
            </div>

            <!-- Postal/Zip Code -->
            <div class="form-group">
              <label for="postalCode">Postal Code / ZIP</label>
              <input id="postalCode" v-model="editSettings.postalCode" type="text" placeholder="100-0001" />
            </div>

            <!-- Detailed Address -->
            <div class="form-group col-span-2">
              <label for="address">Street Address</label>
              <input id="address" v-model="editSettings.address" type="text" placeholder="Chiyoda-ku, Tokyo 1-1-1" />
            </div>

            <!-- Divider -->
            <div class="col-span-3 border-t border-white/10 my-4 pt-4">
              <h3 class="subsection-title">
                <span class="material-icons text-amber-500 font-sm">account_balance</span>
                Bank Transfer Settlement Details
              </h3>
            </div>

            <!-- Bank Name -->
            <div class="form-group">
              <label for="bankName">Bank Name</label>
              <input id="bankName" v-model="editSettings.bankName" type="text" placeholder="e.g. 三菱UFJ銀行" />
            </div>

            <!-- Branch Name -->
            <div class="form-group">
              <label for="bankBranch">Branch Name</label>
              <input id="bankBranch" v-model="editSettings.bankBranch" type="text" placeholder="e.g. 本店" />
            </div>

            <!-- Account Type -->
            <div class="form-group">
              <label for="bankAccountType">Account Type</label>
              <select id="bankAccountType" v-model="editSettings.bankAccountType">
                <option value="ordinary">普通預金 (Ordinary)</option>
                <option value="checking">当座預金 (Checking)</option>
              </select>
            </div>

            <!-- Account Number -->
            <div class="form-group">
              <label for="bankAccountNumber">Account Number</label>
              <input id="bankAccountNumber" v-model="editSettings.bankAccountNumber" type="text" placeholder="1234567" />
            </div>

            <!-- Account Holder -->
            <div class="form-group col-span-2">
              <label for="bankAccountHolder">Account Holder Name (Katakana/English)</label>
              <input id="bankAccountHolder" v-model="editSettings.bankAccountHolder" type="text" placeholder="e.g. ユウゲンガイシャ パーベイシブ" />
            </div>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-indigo px-8 py-3 font-semibold shadow-lg">
              <span class="material-icons">save</span>
              Save Business Profile
            </button>
          </div>
        </form>
      </div>
    </main>

    <!-- Payment Prompt Dialog Modal -->
    <transition name="fade">
      <div v-if="showPaymentModal" class="modal-backdrop">
        <div class="modal-card glass-panel">
          <h3 class="modal-title">Record Bank Settlement</h3>
          <p class="modal-description">Marking invoice {{ pendingActionId }} as Paid. Enter the payment reference below:</p>
          <div class="form-group mt-4">
            <label for="paymentRefInput">Payment Reference / Txn ID</label>
            <input id="paymentRefInput" v-model="paymentRef" type="text" placeholder="e.g. Bank Transfer 12345" />
          </div>
          <div class="modal-actions mt-6">
            <button type="button" class="btn btn-slate" @click="showPaymentModal = false">Cancel</button>
            <button type="button" class="btn btn-emerald" @click="markPaidSubmit">Mark Paid</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Void Prompt Dialog Modal -->
    <transition name="fade">
      <div v-if="showVoidModal" class="modal-backdrop">
        <div class="modal-card glass-panel">
          <h3 class="modal-title text-red-400">Void Invoiced Record</h3>
          <p class="modal-description">
            This action will reverse the double-entry bookkeeping journal entries in your active ledger. Explain why this invoice is being voided:
          </p>
          <div class="form-group mt-4">
            <label for="voidReasonInput">Reason for Void</label>
            <input id="voidReasonInput" v-model="voidReason" type="text" placeholder="e.g. Incorrect quantity or duplicate invoice" required />
          </div>
          <div class="modal-actions mt-6">
            <button type="button" class="btn btn-slate" @click="showVoidModal = false">Cancel</button>
            <button type="button" class="btn btn-danger" @click="voidSubmit">Confirm Void</button>
          </div>
        </div>
      </div>
    </transition>
    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { marked } from "marked";
import type { Invoice, InvoiceCandidate, InvoiceSettings, ExtendedToolResultComplete } from "./types";
import ConfirmModal from "../../shared/components/ConfirmModal.vue";
import { useConfirm } from "../../shared/components/confirm";

const props = defineProps<{ selectedResult?: ExtendedToolResultComplete }>();

const { dispatch, pubsub, log } = useRuntime();
const { openConfirm } = useConfirm();

// UI Navigation and alerts
const activeTab = ref<"invoices" | "settings">("invoices");
const viewMode = ref<"details" | "preview">("details");
const successMsg = ref("");
const errorMsg = ref("");
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
});

const clients = ref<any[]>([]);

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
const selectedRecord = computed(() => {
  if (!selectedRecordId.value) return null;
  if (isCandidate.value) {
    return candidates.value.find((c) => c.candidateId === selectedRecordId.value) || null;
  }
  return invoices.value.find((i) => i.id === selectedRecordId.value) || null;
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

// Setup dynamic printable invoice compiler preview
const renderedInvoiceTemplate = computed(() => {
  const record = selectedRecord.value;
  if (!record) return "";

  const clientName = getClientName(record.clientId);
  const bankAccountTypeJa = settings.value.bankAccountType === "checking" ? "当座預金" : "普通預金";
  const issueDateJa = formatDateJa(record.date);
  const dueDateJa = formatDateJa(record.dueDate);
  const recordIdVal = isCandidate.value ? "(Draft)" : (record as Invoice).id;

  const markdown = `
<div style="font-family: 'Helvetica Neue', 'Hiragino Sans', sans-serif; padding: 20px; color: #2c3e50;">

<div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1a365d; padding-bottom: 12px; margin-bottom: 24px;">
  <div>
    <h1 style="font-size: 30px; letter-spacing: 6px; margin: 0; color: #1a365d; font-weight: 300;">INVOICE</h1>
    <p style="margin: 2px 0 0; color: #718096; font-size: 12px; letter-spacing: 3px;">請　求　書</p>
  </div>
  <div style="text-align: right; font-size: 12px; color: #4a5568;">
    <div><strong style="color:#1a365d;">No.</strong> ${recordIdVal}</div>
    <div><strong style="color:#1a365d;">発行日:</strong> ${issueDateJa}</div>
    <div><strong style="color:#1a365d;">支払期限:</strong> ${dueDateJa}</div>
  </div>
</div>

<table style="width:100%; border:none; margin-bottom: 24px;">
  <tr style="border:none;">
    <td style="border:none; vertical-align: top; width: 55%; padding: 0;">
      <div style="font-size: 10px; color: #718096; letter-spacing: 1px; margin-bottom: 6px;">BILL TO</div>
      <div style="font-size: 18px; font-weight: 600; color: #1a365d; border-bottom: 1px solid #1a365d; padding-bottom: 4px; display: inline-block;">${clientName}　御中</div>
      <p style="margin-top: 8px; color: #4a5568; font-size: 12px;">下記の通りご請求申し上げます。</p>
    </td>
    <td style="border:none; vertical-align: top; width: 45%; padding: 0 0 0 16px;">
      <div style="background: rgba(255,255,255,0.05); border-left: 3px solid #1a365d; padding: 12px 16px; font-size: 12px; line-height: 1.6;">
        <div style="font-size: 10px; color: #718096; letter-spacing: 1px; margin-bottom: 4px;">FROM</div>
        <div style="font-weight: 600; color: #1a365d; font-size: 14px;">${settings.value.companyName || "(Issuer Name Not Set)"}</div>
        <div style="color: #718096; font-size: 11px;">登録番号: ${settings.value.taxRegistrationId || "未登録"}</div>
        <div style="margin-top: 4px;">〒${settings.value.postalCode || ""}</div>
        <div>${settings.value.address || ""}</div>
        <div style="margin-top: 4px; color: #4a5568;">${settings.value.email || ""}</div>
      </div>
    </td>
  </tr>
</table>

<div style="font-size: 10px; color: #718096; letter-spacing: 1px; margin-bottom: 6px;">DETAILS</div>

<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px;">
  <thead>
    <tr style="border-bottom: 2px solid #1a365d; color: #1a365d;">
      <th style="padding: 8px; text-align: left;">品目 / Description</th>
      <th style="padding: 8px; text-align: center; width: 80px;">数量 / Qty</th>
      <th style="padding: 8px; text-align: right; width: 120px;">金額 / Amount</th>
    </tr>
  </thead>
  <tbody>
    ${record.items
      .map(
        (item: any) => `
      <tr style="border-bottom: 1px solid rgba(0,0,0,0.08);">
        <td style="padding: 8px;">${item.description}</td>
        <td style="padding: 8px; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; text-align: right;">¥${item.amount.toLocaleString()}</td>
      </tr>
    `,
      )
      .join("")}
  </tbody>
</table>

<table style="width:100%; border:none; margin-top: 12px;">
  <tr style="border:none;">
    <td style="border:none; width: 55%;"></td>
    <td style="border:none; width: 45%; padding: 0;">
      <table style="width:100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 6px 12px; color: #718096;">小計</td>
          <td style="padding: 6px 12px; text-align: right;">¥${record.subtotal.toLocaleString()}</td>
        </tr>
        <tr style="border-bottom: 1px solid rgba(0,0,0,0.08);">
          <td style="padding: 6px 12px; color: #718096;">消費税 (10%)</td>
          <td style="padding: 6px 12px; text-align: right;">¥${record.tax.toLocaleString()}</td>
        </tr>
        <tr style="background: #1a365d; color: white;">
          <td style="padding: 10px 12px; font-weight: 600;">合計 / TOTAL</td>
          <td style="padding: 10px 12px; text-align: right; font-size: 16px; font-weight: 600;">¥${record.total.toLocaleString()}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<div style="margin-top: 24px; background: rgba(255,255,255,0.03); padding: 16px 20px; border-radius: 4px; font-size: 12px;">
  <div style="font-size: 10px; color: #718096; letter-spacing: 1px; margin-bottom: 4px;">PAYMENT</div>
  <div style="font-size: 14px; color: #1a365d;"><strong>${settings.value.bankName || ""} ${settings.value.bankBranch || ""}</strong></div>
  <div style="color: #4a5568; margin-top: 2px;">${bankAccountTypeJa}　${settings.value.bankAccountNumber || ""}　／　${settings.value.bankAccountHolder || ""}</div>
</div>

<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.05); font-size: 10px; color: #a0aec0; text-align: center;">
  お振込手数料は貴社にてご負担くださいますようお願い申し上げます。<br>
  ご不明な点がございましたら上記メールアドレスまでご連絡ください。
</div>

</div>
  `;

  return marked.parse(markdown);
});

// Load all details in one swoop
async function loadData() {
  try {
    const res = (await dispatch({ action: "list" })) as any;
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
      };
      editSettings.value = { ...settings.value };
    }
  } catch (err: any) {
    errorMsg.value = "Failed to load bookkeeping and invoice data.";
    log.error("Data loading failed", { error: err.message });
  } finally {
    dataLoaded.value = true;
  }
}

// Helpers
function getClientName(clientId: string): string {
  const c = clients.value.find((client) => client.id === clientId || client.name === clientId);
  return c ? c.name : clientId;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

function formatDateJa(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  return `${y}年${m}月${d}日`;
}

function selectRecord(record: any, candMode: boolean) {
  selectedRecordId.value = candMode ? record.candidateId : record.id;
  isCandidate.value = candMode;
  viewMode.value = "details";
}

// Write-actions
async function saveIssuerSettings() {
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({ action: "saveSettings", settings: editSettings.value })) as any;
    if (res?.ok) {
      settings.value = { ...editSettings.value };
      successMsg.value = "Business profile successfully saved and locked.";
    } else {
      errorMsg.value = res?.error || "Failed to save settings.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
  } finally {
    actionPending.value = false;
  }
}

async function approveCandidate() {
  if (!selectedRecord.value) return;
  const confirmed = await openConfirm({
    title: "Approve Billing Draft",
    message: "Are you sure you want to approve this candidate and commit it as an invoice? This will dynamically generate double-entry bookkeeping journal entries in your active ledger.",
    confirmText: "Approve & Journal",
    variant: "success",
  });
  if (!confirmed) return;

  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({ action: "candidateApprove", id: selectedRecordId.value! })) as any;
    if (res?.ok && res?.jsonData?.invoice) {
      successMsg.value = `Invoice approved and registered as ${res.jsonData.invoice.id}. Journal entries created.`;
      const nextId = res.jsonData.invoice.id;
      await loadData();
      selectedRecordId.value = nextId;
      isCandidate.value = false;
    } else {
      errorMsg.value = res?.error || "Failed to approve billing draft.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
  } finally {
    actionPending.value = false;
  }
}

async function deleteDraft() {
  if (!selectedRecord.value) return;
  const confirmed = await openConfirm({
    title: "Discard Billing Draft",
    message: "Are you sure you want to discard this billing draft?",
    confirmText: "Discard",
    variant: "danger",
  });
  if (!confirmed) return;

  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({ action: "candidateDelete", id: selectedRecordId.value! })) as any;
    if (res?.ok) {
      successMsg.value = "Billing draft discarded.";
      selectedRecordId.value = null;
      await loadData();
    } else {
      errorMsg.value = res?.error || "Failed to delete candidate.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
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
  showPaymentModal.value = false;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({
      action: "invoiceMarkPaid",
      id: pendingActionId.value,
      paymentRef: paymentRef.value,
    })) as any;
    if (res?.ok) {
      successMsg.value = `Invoice ${pendingActionId.value} marked as paid. Bank deposit entries logged.`;
      await loadData();
    } else {
      errorMsg.value = res?.error || "Failed to record payment.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
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
  showVoidModal.value = false;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({
      action: "invoiceVoid",
      id: pendingActionId.value,
      voidReason: voidReason.value,
    })) as any;
    if (res?.ok) {
      successMsg.value = `Invoice ${pendingActionId.value} voided. Journal reversing entries recorded.`;
      await loadData();
    } else {
      errorMsg.value = res?.error || "Failed to void invoice.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
  } finally {
    actionPending.value = false;
    pendingActionId.value = null;
  }
}

// Generate Printable Layout using AI Chat
async function triggerPrintableGeneration() {
  if (!selectedRecordId.value) return;
  actionPending.value = true;
  successMsg.value = "";
  errorMsg.value = "";
  try {
    const res = (await dispatch({
      action: "startPrintableGenerationChat",
      id: selectedRecordId.value,
    })) as any;
    if (res?.ok && res?.jsonData?.chatId) {
      successMsg.value = "Generative invoice layout session started. Redirecting to chat...";
      setTimeout(() => {
        window.location.href = `/chat/${res.jsonData.chatId}`;
      }, 1200);
    } else {
      errorMsg.value = res?.error || "Failed to spin up layout generation chat.";
    }
  } catch (err: any) {
    errorMsg.value = err.message || "An unexpected error occurred.";
  } finally {
    actionPending.value = false;
  }
}

// Subscriptions
let unsub: (() => void) | null = null;
onMounted(async () => {
  await loadData();

  // If the dashboard was opened as a result of saving settings, focus the settings tab
  const args = props.selectedResult?.args as any;
  if (args?.action === "saveSettings") {
    activeTab.value = "settings";
  }

  unsub = pubsub.subscribe("changed", () => {
    loadData();
  });
});

onUnmounted(() => {
  if (unsub) unsub();
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
  align-items: center;
  gap: 1rem;
}

.header-icon {
  font-size: 2.25rem;
  color: #2563eb;
  padding: 0.5rem;
  border-radius: 12px;
  background: rgba(37, 99, 235, 0.08);
}

.header-title {
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: 2px;
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
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.03);
  padding: 0.25rem;
  border-radius: 12px;
}

.dark .tab-selectors {
  background: rgba(255, 255, 255, 0.04);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  font-size: 0.85rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  border-radius: 9px;
  transition: all 0.25s ease;
}

.tab-btn:hover {
  color: #1e293b;
}

.dark .tab-btn:hover {
  color: #f8fafc;
}

.tab-btn.active {
  background: #ffffff;
  color: #2563eb;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.dark .tab-btn.active {
  background: #1e293b;
  color: #3b82f6;
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
