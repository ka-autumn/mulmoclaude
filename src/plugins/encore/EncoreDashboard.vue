<script setup lang="ts">
// Encore dashboard — read-only landing for /encore.
//
// What this surface IS:
//   - A browser over `obligations/<id>/index.md` + every
//     `obligations/<id>/<cycleId>.md` cycle file on disk.
//   - One row per obligation with cadence / targets / current-cycle
//     status. Expanding the row reveals that obligation's cycle
//     history (reverse-chron).
//
// What this surface IS NOT:
//   - Not editable. There is no "mark done" / "snooze" / "create"
//     button — those are LLM-only verbs. The user reaches them by
//     asking in chat (the bell flow handles notification clicks).
//   - Not a notification surface. The bell stays the channel for
//     "the LLM wants your attention"; this page just lists what
//     Encore is tracking and what already happened.
//
// Data source: a single `kind: "query"` dispatch with `range: "all"`,
// which returns every obligation + every cycle in one round trip.
// No new server endpoint was added for the page.

import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { pluginEndpoints } from "../api";
import { apiCall } from "../../utils/api";
import { META } from "./manageEncoreMeta";
import type { EncoreEndpoints } from "./manageEncoreDefinition";
import type { EncoreDsl, StepDef } from "../../types/encore-dsl/schema";
import type { Cadence } from "../../types/encore-dsl/cadence";

// Wire shape mirrors `server/encore/handlers/query.ts`. The
// per-target record matches `TargetRecord` from `server/encore/cycle.ts`
// — duplicated here because that module lives outside `src/` and
// can't be imported from a Vue component.
interface TargetRecord {
  values?: Record<string, unknown>;
  skipped?: string;
  completedSteps?: Record<string, string>;
  snoozedSteps?: Record<string, string>;
}

interface CycleState {
  cycleId: string;
  cycleStart: string;
  cycleDeadline: string;
  records: Record<string, TargetRecord>;
}

interface QueryCycleResult {
  cycleId: string;
  path: string;
  state: CycleState;
  body: string;
}

interface QueryObligationResult {
  obligationId: string;
  indexPath: string;
  dsl: EncoreDsl;
  body: string;
  cycles: QueryCycleResult[];
}

interface QueryResponse {
  ok: boolean;
  message: string;
  obligations?: QueryObligationResult[];
}

interface TicketSummary {
  pendingId: string;
  obligationId: string;
  cycleId: string;
  notificationId: string;
  stepId: string;
  createdAt: string;
}

interface ListTicketsResponse {
  ok: boolean;
  message: string;
  tickets?: TicketSummary[];
}

const { t } = useI18n();

const loading = ref(true);
const errorMessage = ref<string | null>(null);
const obligations = ref<QueryObligationResult[]>([]);
const tickets = ref<TicketSummary[]>([]);
const expanded = ref<Record<string, boolean>>({});

async function loadObligations(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    const endpoints = pluginEndpoints<EncoreEndpoints>(META.apiNamespace);
    const { method, url } = endpoints.dispatch;
    // Query + listTickets in parallel — they're independent reads
    // and we want them both before the row chips/bell render.
    const [queryResponse, ticketsResponse] = await Promise.all([
      apiCall<QueryResponse>(url, { method, body: { kind: "query", range: "all" } }),
      apiCall<ListTicketsResponse>(url, { method, body: { kind: "listTickets" } }),
    ]);
    if (!queryResponse.ok) {
      errorMessage.value = queryResponse.error;
      return;
    }
    obligations.value = queryResponse.data.obligations ?? [];
    // A ticket-fetch failure shouldn't block the dashboard — degrade
    // gracefully (bells just won't render). Surface the error in the
    // console for debug visibility.
    if (ticketsResponse.ok) {
      tickets.value = ticketsResponse.data.tickets ?? [];
    } else {
      tickets.value = [];
      console.warn("encore-dashboard: listTickets failed —", ticketsResponse.error);
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadObligations();
});

// (obligationId, cycleId) → tickets[] for the per-cycle bell badge.
// Computed so it stays in sync when either the query or the ticket
// list reloads. The key is a composite string because Records can't
// be indexed by a tuple.
const ticketsByCycle = computed<Record<string, TicketSummary[]>>(() => {
  const map: Record<string, TicketSummary[]> = {};
  for (const ticket of tickets.value) {
    const key = `${ticket.obligationId}/${ticket.cycleId}`;
    if (!map[key]) map[key] = [];
    map[key].push(ticket);
  }
  return map;
});

function cycleTickets(obligationId: string, cycleId: string): TicketSummary[] {
  return ticketsByCycle.value[`${obligationId}/${cycleId}`] ?? [];
}

// Bell click: navigate to the same URL the host's NotificationBell
// would build for this ticket (/encore?pendingId=…&notificationId=…),
// then EncoreRedirect handles the resolveNotification dispatch and
// onward redirect to /chat/<chatId>. If the obligation has multiple
// live tickets we route to the first — the dashboard isn't the
// place to triage; resolving one usually unblocks the row.
function openTicket(ticket: TicketSummary): void {
  const params = new URLSearchParams({
    pendingId: ticket.pendingId,
    notificationId: ticket.notificationId,
  });
  window.location.href = `/encore?${params.toString()}`;
}

function toggle(obligationId: string): void {
  expanded.value[obligationId] = !expanded.value[obligationId];
}

// Per-obligation chat button → server-side `startObligationChat`
// kind seeds a fresh chat with the obligation in context, then we
// full-navigate to /chat/<chatId> (same trick the bell-click flow
// uses so the seeded turn renders on first paint). The button
// stops propagation so clicking it doesn't also toggle the row.
const chatStarting = ref<Record<string, boolean>>({});

interface StartObligationChatResult {
  ok: boolean;
  chatId?: string;
  navigateTo?: string;
  error?: string;
  message?: string;
}

async function startChatForObligation(obligationId: string): Promise<void> {
  if (chatStarting.value[obligationId]) return;
  chatStarting.value[obligationId] = true;
  try {
    const endpoints = pluginEndpoints<EncoreEndpoints>(META.apiNamespace);
    const { method, url } = endpoints.dispatch;
    const response = await apiCall<StartObligationChatResult>(url, {
      method,
      body: { kind: "startObligationChat", obligationId },
    });
    if (!response.ok) {
      errorMessage.value = response.error;
      return;
    }
    const result = response.data;
    if (!result.ok || !result.chatId) {
      errorMessage.value = result.error ?? t("encoreDashboard.unexpectedResponse");
      return;
    }
    window.location.href = result.navigateTo ?? `/chat/${result.chatId}`;
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    chatStarting.value[obligationId] = false;
  }
}

// "+ Add" toolbar button → server-side `startSetupChat` kind seeds
// a new chat asking the LLM to walk the user through creating a
// fresh obligation, then full-navigates. Mirrors
// `startChatForObligation` but without an obligationId.
const setupStarting = ref(false);

async function startSetupChat(): Promise<void> {
  if (setupStarting.value) return;
  setupStarting.value = true;
  try {
    const endpoints = pluginEndpoints<EncoreEndpoints>(META.apiNamespace);
    const { method, url } = endpoints.dispatch;
    const response = await apiCall<StartObligationChatResult>(url, {
      method,
      body: { kind: "startSetupChat" },
    });
    if (!response.ok) {
      errorMessage.value = response.error;
      return;
    }
    const result = response.data;
    if (!result.ok || !result.chatId) {
      errorMessage.value = result.error ?? t("encoreDashboard.unexpectedResponse");
      return;
    }
    window.location.href = result.navigateTo ?? `/chat/${result.chatId}`;
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    setupStarting.value = false;
  }
}

// ── derived closure (mirrors server/encore/closure.ts) ──

function isStepClosed(record: TargetRecord | undefined, step: StepDef): boolean {
  if (!record) return false;
  if (record.skipped) return true;
  return Boolean(record.completedSteps?.[step.id]);
}

function isTargetClosed(record: TargetRecord | undefined, dsl: EncoreDsl): boolean {
  if (!record) return false;
  if (record.skipped) return true;
  return dsl.steps.every((step) => isStepClosed(record, step));
}

function isCycleClosed(state: CycleState, dsl: EncoreDsl): boolean {
  return dsl.targets.every((target) => isTargetClosed(state.records[target.id], dsl));
}

// ── display helpers ──

function cadenceLabel(cadence: Cadence): string {
  return t(`encoreDashboard.cadence.${cadence.type}`);
}

function statusLabel(status: EncoreDsl["status"]): string {
  return t(`encoreDashboard.status.${status}`);
}

function statusClasses(status: EncoreDsl["status"]): string {
  if (status === "active") return "bg-green-100 text-green-700";
  if (status === "paused") return "bg-yellow-100 text-yellow-700";
  return "bg-gray-200 text-gray-600";
}

function targetCountLabel(dsl: EncoreDsl): string {
  return t("encoreDashboard.targetCount", { count: dsl.targets.length });
}

function formatDate(iso: string): string {
  // Cycle window timestamps are ISO; show date-only for readability.
  return iso.slice(0, 10);
}

type StepStatus = "done" | "skipped" | "open";

function cycleStepStatus(state: CycleState, target: { id: string }, step: StepDef): StepStatus {
  const record = state.records[target.id];
  if (record?.skipped) return "skipped";
  if (record?.completedSteps?.[step.id]) return "done";
  return "open";
}

function stepStatusIcon(status: StepStatus): string {
  if (status === "done") return "check_circle";
  if (status === "skipped") return "remove_circle_outline";
  return "radio_button_unchecked";
}

function stepStatusClasses(status: StepStatus): string {
  // Done is settled history — grey, same theme as the "Closed" chip.
  // Skipped sits a touch lighter; open is the live state, so it
  // keeps the blue accent.
  if (status === "done") return "text-gray-500";
  if (status === "skipped") return "text-gray-400";
  return "text-blue-500";
}

// Cycles to display under an obligation header, reverse-chron.
//   - When the row is expanded: full history.
//   - When the row is collapsed: only cycles that have a live ticket.
//     This is the always-visible "pending" surface — the user sees
//     what needs attention without clicking expand.
// Server returns cycles ascending; we reverse for newest-first.
function visibleCycles(item: QueryObligationResult): QueryCycleResult[] {
  const all = [...item.cycles].reverse();
  if (expanded.value[item.obligationId]) return all;
  return all.filter((cycle) => cycleTickets(item.obligationId, cycle.cycleId).length > 0);
}

// Sort: active first, then paused, then retired. Within each
// status, alphabetical by displayName.
const sortedObligations = computed<QueryObligationResult[]>(() => {
  const statusRank: Record<EncoreDsl["status"], number> = { active: 0, paused: 1, retired: 2 };
  return [...obligations.value].sort((lhs, rhs) => {
    const statusDiff = statusRank[lhs.dsl.status] - statusRank[rhs.dsl.status];
    if (statusDiff !== 0) return statusDiff;
    return lhs.dsl.displayName.localeCompare(rhs.dsl.displayName);
  });
});

interface RecordedValue {
  key: string;
  value: string;
}

function recordedValuesForTarget(state: CycleState, targetId: string): RecordedValue[] {
  const values = state.records[targetId]?.values;
  if (!values) return [];
  return Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value),
    }));
}
</script>

<template>
  <div class="h-full overflow-y-auto" data-testid="encore-dashboard">
    <div class="max-w-4xl mx-auto px-4 py-6">
      <div class="flex items-center justify-between mb-1">
        <h1 class="text-xl font-semibold text-gray-800">{{ t("encoreDashboard.title") }}</h1>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-wait"
          :disabled="setupStarting"
          data-testid="encore-add-button"
          @click="startSetupChat()"
        >
          <span class="material-icons text-base">{{ setupStarting ? "hourglass_empty" : "add" }}</span>
          <span>{{ t("encoreDashboard.addButtonLabel") }}</span>
        </button>
      </div>
      <p class="text-sm text-gray-500 mb-6">{{ t("encoreDashboard.subtitle") }}</p>

      <div v-if="loading" class="text-sm text-gray-500">{{ t("encoreDashboard.loading") }}</div>

      <div v-else-if="errorMessage" class="text-sm text-red-600">{{ t("encoreDashboard.errorPrefix") }}{{ errorMessage }}</div>

      <div v-else-if="sortedObligations.length === 0" class="text-sm text-gray-500 border border-dashed border-gray-300 rounded p-6 text-center">
        {{ t("encoreDashboard.empty") }}
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="item in sortedObligations"
          :key="item.obligationId"
          class="border border-gray-200 rounded bg-white"
          :data-testid="`encore-obligation-${item.obligationId}`"
        >
          <div class="flex items-stretch hover:bg-gray-50 transition-colors">
            <button
              type="button"
              class="flex-1 min-w-0 px-4 py-3 flex items-center gap-3 text-left"
              :aria-expanded="!!expanded[item.obligationId]"
              @click="toggle(item.obligationId)"
            >
              <span class="material-icons text-gray-400 text-base">{{ expanded[item.obligationId] ? "expand_more" : "chevron_right" }}</span>
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-gray-800 truncate">{{ item.dsl.displayName }}</span>
                <span class="block text-xs text-gray-500 mt-0.5">
                  {{ cadenceLabel(item.dsl.cadence) }} · {{ targetCountLabel(item.dsl) }} · {{ item.cycles.length }} {{ t("encoreDashboard.cyclesSuffix") }}
                </span>
              </span>
              <!-- "Active" is the default and would just be noise on
                   every row — show the chip only for the off-normal
                   states (paused / retired). -->
              <span
                v-if="item.dsl.status !== 'active'"
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                :class="statusClasses(item.dsl.status)"
              >
                {{ statusLabel(item.dsl.status) }}
              </span>
            </button>
            <button
              type="button"
              class="px-3 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
              :title="t('encoreDashboard.chatButtonTitle')"
              :aria-label="t('encoreDashboard.chatButtonTitle')"
              :disabled="!!chatStarting[item.obligationId]"
              :data-testid="`encore-obligation-chat-${item.obligationId}`"
              @click="startChatForObligation(item.obligationId)"
            >
              <span class="material-icons text-base">{{ chatStarting[item.obligationId] ? "hourglass_empty" : "chat_bubble_outline" }}</span>
            </button>
          </div>

          <div v-if="visibleCycles(item).length > 0" class="border-t border-gray-100 px-4 py-3 bg-gray-50">
            <ul class="space-y-3">
              <li
                v-for="cycle in visibleCycles(item)"
                :key="cycle.cycleId"
                class="bg-white border border-gray-200 rounded p-3"
                :data-testid="`encore-cycle-${item.obligationId}-${cycle.cycleId}`"
              >
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-sm font-mono text-gray-700">{{ cycle.cycleId }}</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- decorative arrow between two date values, language-neutral -->
                  <span class="text-xs text-gray-400">{{ formatDate(cycle.state.cycleStart) }} → {{ formatDate(cycle.state.cycleDeadline) }}</span>
                  <!-- Right-aligned group so the layout still pins to
                       the right when the "closed" chip is hidden
                       (open cycles render no chip, only the per-step
                       icons inside the row signal what's left). -->
                  <span class="ml-auto inline-flex items-center gap-2">
                    <!-- Light grey signals "settled history, nothing to do." -->
                    <span
                      v-if="isCycleClosed(cycle.state, item.dsl)"
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500"
                    >
                      {{ t("encoreDashboard.cycleClosed") }}
                    </span>
                    <button
                      v-if="cycleTickets(item.obligationId, cycle.cycleId).length > 0"
                      type="button"
                      class="relative inline-flex items-center justify-center w-6 h-6 rounded text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      :title="t('encoreDashboard.bellButtonTitle')"
                      :aria-label="t('encoreDashboard.bellButtonTitle')"
                      :data-testid="`encore-cycle-bell-${item.obligationId}-${cycle.cycleId}`"
                      @click="openTicket(cycleTickets(item.obligationId, cycle.cycleId)[0])"
                    >
                      <span class="material-icons text-base">notifications_active</span>
                      <span
                        v-if="cycleTickets(item.obligationId, cycle.cycleId).length > 1"
                        class="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-red-500 text-white text-[9px] leading-[14px] text-center font-semibold"
                      >
                        {{ cycleTickets(item.obligationId, cycle.cycleId).length }}
                      </span>
                    </button>
                  </span>
                </div>
                <div class="space-y-1">
                  <div v-for="target in item.dsl.targets" :key="target.id" class="text-xs">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-gray-600 min-w-[6rem] truncate">{{ target.displayName ?? target.id }}</span>
                      <span
                        v-for="step in item.dsl.steps"
                        :key="step.id"
                        class="inline-flex items-center gap-1 text-gray-500"
                        :title="step.displayName ?? step.id"
                      >
                        <span class="material-icons text-xs" :class="stepStatusClasses(cycleStepStatus(cycle.state, target, step))">{{
                          stepStatusIcon(cycleStepStatus(cycle.state, target, step))
                        }}</span>
                        <span class="truncate max-w-[10rem]">{{ step.displayName ?? step.id }}</span>
                      </span>
                    </div>
                    <div v-if="recordedValuesForTarget(cycle.state, target.id).length > 0" class="ml-[6.5rem] mt-1 flex flex-wrap gap-1">
                      <span
                        v-for="entry in recordedValuesForTarget(cycle.state, target.id)"
                        :key="entry.key"
                        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-[11px] text-gray-600"
                      >
                        <span class="text-gray-400">{{ entry.key }}:</span>
                        <span class="font-mono">{{ entry.value }}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </div>
          <!-- Expanded by the user, but the obligation has no cycles
               on disk yet. Falls outside the visibleCycles section
               because that section is hidden when the list is empty. -->
          <div v-else-if="expanded[item.obligationId]" class="border-t border-gray-100 px-4 py-3 bg-gray-50 text-xs text-gray-500">
            {{ t("encoreDashboard.noCycles") }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
