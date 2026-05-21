<template>
  <div class="h-full bg-white flex flex-col font-sans text-gray-800 overflow-hidden">
    <!-- Header: Clean, border-b divided, light-theme panel header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-bold text-gray-900 tracking-tight">{{ t.title }}</h2>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex border border-gray-300 rounded overflow-hidden">
        <button
          type="button"
          @click="activeTab = 'rollup'"
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors text-xs font-semibold',
            activeTab === 'rollup' ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
        >
          <span class="material-icons text-sm leading-none">bar_chart</span>
          <span>{{ t.weeklyRollup }}</span>
        </button>
        <button
          type="button"
          @click="activeTab = 'review'"
          :class="[
            'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors text-xs font-semibold',
            activeTab === 'review' ? 'bg-indigo-50 text-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
        >
          <span class="material-icons text-sm leading-none">rate_review</span>
          <span>{{ t.reviewBoard }}</span>
          <span v-if="candidates.length > 0" class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800">
            {{ candidates.length }}
          </span>
        </button>
      </div>
    </div>

    <!-- MAIN BODY TABS (Internal Scroll Area) -->
    <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <!-- TAB 1: WEEKLY SUMMARY ROLLUP GRID -->
      <div v-if="activeTab === 'rollup'" class="flex flex-col gap-6 animate-fadeIn">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <h2 class="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span class="material-icons text-base text-gray-500">analytics</span>
            <span>{{ t.weeklyRollup }} {{ t.summary }}</span>
          </h2>

          <div class="flex items-center gap-3">
            <!-- Reset to current week on the left (future navigation) -->
            <button
              v-if="weekOffset > 0"
              type="button"
              @click="weekOffset = 0"
              class="h-7 px-2.5 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/40 active:scale-95 transition-all duration-150 uppercase tracking-wider shadow-sm"
              :title="t.thisWeek"
              :aria-label="t.thisWeek"
            >
              {{ t.thisWeek }}
            </button>

            <div class="flex items-center gap-1.5">
              <button
                type="button"
                @click="weekOffset--"
                class="h-7 w-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/40 active:scale-95 transition-all duration-150"
                :title="t.prevWeekTooltip"
                :aria-label="t.prevWeekTooltip"
              >
                <span class="material-icons text-base leading-none">chevron_left</span>
              </button>

              <span class="text-xs text-gray-600 font-semibold bg-gray-50 border border-gray-200/60 px-3 py-1 rounded-lg shadow-sm">
                {{ formatWeekRange() }}
              </span>

              <button
                type="button"
                @click="weekOffset++"
                class="h-7 w-7 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/40 active:scale-95 transition-all duration-150"
                :title="t.nextWeekTooltip"
                :aria-label="t.nextWeekTooltip"
              >
                <span class="material-icons text-base leading-none">chevron_right</span>
              </button>
            </div>

            <!-- Reset to current week on the right (past navigation) -->
            <button
              v-if="weekOffset < 0"
              type="button"
              @click="weekOffset = 0"
              class="h-7 px-2.5 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/40 active:scale-95 transition-all duration-150 uppercase tracking-wider shadow-sm"
              :title="t.thisWeek"
              :aria-label="t.thisWeek"
            >
              {{ t.thisWeek }}
            </button>
          </div>
        </div>

        <!-- Spreadsheet rollup grid -->
        <div class="overflow-x-auto rounded-xl border border-gray-200/60 shadow-sm bg-gray-50/50">
          <table class="min-w-full divide-y divide-gray-200 text-xs">
            <thead class="bg-gray-50">
              <tr>
                <th scope="col" class="px-4 py-3 text-left font-bold text-gray-600 w-1/3">{{ t.client }} / {{ t.project }}</th>
                <th v-for="day in weekDays" :key="day.dateStr" scope="col" class="px-3 py-3 text-center font-bold text-gray-600">
                  {{ day.label }}
                  <span class="block text-[10px] font-normal text-gray-400">{{ formatDateLabel(day.dateStr) }}</span>
                </th>
                <th scope="col" class="px-4 py-3 text-center font-bold text-indigo-600">
                  {{ t.total }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 bg-white">
              <tr v-if="rollupRows.length === 0">
                <td :colspan="9" class="px-4 py-8 text-center text-gray-400">
                  {{ t.noCommitted }}
                </td>
              </tr>
              <tr v-for="row in rollupRows" :key="row.key" class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 font-semibold text-gray-900">
                  {{ row.key }}
                </td>
                <td v-for="day in weekDays" :key="day.dateStr" class="px-3 py-3 text-center">
                  <span v-if="row.hours[day.dateStr] > 0" class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                    {{ row.hours[day.dateStr].toFixed(1) }}{{ t.hrs }}
                  </span>
                  <span v-else class="text-gray-300">-</span>
                </td>
                <td class="px-4 py-3 text-center font-bold text-indigo-600 bg-indigo-50/10">{{ row.total.toFixed(1) }}{{ t.hrs }}</td>
              </tr>
              <!-- Totals row -->
              <tr v-if="rollupRows.length > 0" class="bg-gray-50 font-bold border-t-2 border-gray-200">
                <td class="px-4 py-3 text-gray-700">
                  {{ t.total }}
                </td>
                <td v-for="day in weekDays" :key="day.dateStr" class="px-3 py-3 text-center text-gray-900">
                  {{ dayTotals.totals[day.dateStr] > 0 ? dayTotals.totals[day.dateStr].toFixed(1) + t.hrs : "-" }}
                </td>
                <td class="px-4 py-3 text-center text-indigo-600 bg-indigo-500/10 text-sm">{{ dayTotals.grandTotal.toFixed(1) }}{{ t.hrs }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Detailed list of committed entries with inline editing and deletion -->
        <div class="flex flex-col gap-3 mt-2">
          <h3 class="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span class="material-icons text-base text-gray-500">list</span>
            <span>{{ t.details }}</span>
          </h3>

          <div class="flex flex-col gap-3">
            <div
              v-for="entry in thisWeekCommitted"
              :key="entry.id"
              class="p-4 rounded-xl border border-gray-100 bg-white hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <!-- Editing Entry State -->
              <div v-if="editingEntryId === entry.id" class="flex-1 flex flex-col gap-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.client }}</label>
                    <input
                      v-model="editForm.clientId"
                      type="text"
                      :aria-label="t.client"
                      class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.project }}</label>
                    <input
                      v-model="editForm.projectId"
                      type="text"
                      :aria-label="t.project"
                      class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.billable }}</label>
                    <label class="inline-flex items-center mt-1 cursor-pointer">
                      <input v-model="editForm.billable" type="checkbox" class="sr-only peer" :aria-label="t.billable" />
                      <div
                        class="relative w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"
                      ></div>
                    </label>
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.startTime }}</label>
                    <input
                      v-model="editForm.startTime"
                      type="text"
                      :aria-label="t.startTime"
                      class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.endTime }}</label>
                    <input
                      v-model="editForm.endTime"
                      type="text"
                      :aria-label="t.endTime"
                      class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] uppercase font-bold text-gray-400 mb-1">{{ t.notes }}</label>
                  <textarea
                    v-model="editForm.notes"
                    rows="2"
                    :aria-label="t.notes"
                    class="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  ></textarea>
                </div>
                <div class="flex justify-end gap-2 mt-2">
                  <button
                    @click="editingEntryId = null"
                    class="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 text-gray-600"
                  >
                    <span class="material-icons text-xs leading-none">close</span>
                    <span>{{ t.cancel }}</span>
                  </button>
                  <button
                    @click="saveEditCommitted(entry.id)"
                    class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                  >
                    <span class="material-icons text-xs leading-none">save</span>
                    <span>{{ t.save }}</span>
                  </button>
                </div>
              </div>

              <!-- Standard View Committed State -->
              <div v-else class="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex-1 flex flex-col gap-1.5">
                  <div class="flex items-center flex-wrap gap-2 text-xs">
                    <span class="font-bold text-gray-900 text-sm">{{ entry.clientId }}</span>
                    <span v-if="entry.projectId" class="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500 font-medium">
                      {{ entry.projectId }}
                    </span>
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      :class="entry.billable ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'"
                    >
                      {{ entry.billable ? t.billable : t.nonBillable }}
                    </span>
                  </div>
                  <div class="text-xs text-gray-400 flex items-center gap-1.5">
                    <span>{{ formatTimeRange(entry.startTime, entry.endTime) }}</span>
                    <span>•</span>
                    <span class="font-bold text-gray-600">{{ (entry.duration / 3600).toFixed(2) }} {{ t.hrs }}</span>
                  </div>
                  <p v-if="entry.notes" class="text-xs text-gray-600 mt-1 pl-2 border-l border-gray-200">
                    {{ entry.notes }}
                  </p>
                </div>

                <!-- Edit and Delete Actions -->
                <div class="flex items-center gap-2 self-end sm:self-center">
                  <button
                    @click="startEditCommitted(entry)"
                    class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:bg-gray-50 transition-all flex items-center justify-center"
                    :title="t.edit"
                    :aria-label="t.edit"
                  >
                    <span class="material-icons text-base">edit</span>
                  </button>
                  <button
                    @click="deleteCommitted(entry.id)"
                    class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 hover:bg-gray-50 transition-all flex items-center justify-center"
                    :title="t.delete"
                    :aria-label="t.delete"
                  >
                    <span class="material-icons text-base">delete</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: CANDIDATE REVIEW BOARD -->
      <div v-if="activeTab === 'review'" class="flex flex-col gap-6 animate-fadeIn">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span class="material-icons text-base text-gray-500">rate_review</span>
            <span>{{ t.reviewBoard }}</span>
          </h2>
        </div>

        <div
          v-if="candidates.length === 0"
          class="px-6 py-12 text-center text-gray-400 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 flex flex-col items-center justify-center gap-2"
        >
          <span class="material-icons text-3xl">assignment</span>
          <p class="text-sm">{{ t.noCandidates }}</p>
        </div>

        <div v-else class="flex flex-wrap gap-4">
          <div
            v-for="candidate in candidates"
            :key="candidate.id"
            class="flex-1 min-w-[280px] max-w-[550px] p-5 rounded-xl border border-gray-200 bg-white flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
          >
            <!-- Inferred confidence tag -->
            <div class="absolute top-0 right-0 w-24 h-24 pointer-events-none overflow-hidden">
              <div
                class="absolute transform rotate-45 bg-indigo-500/10 text-indigo-600 font-bold text-[9px] text-center py-1 w-[120px] top-4 -right-6 uppercase tracking-wider border-b border-indigo-200/20"
              >
                {{ t.confidence }}: {{ Math.round(candidate.confidence * 100) }}%
              </div>
            </div>

            <!-- Card Heading / Identity -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center flex-wrap gap-2 pr-12">
                <input
                  v-model="candidate.clientId"
                  type="text"
                  class="font-bold text-gray-900 bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-500 focus:outline-none text-sm px-1 py-0.5"
                  :placeholder="t.clientPlaceholder"
                  :aria-label="t.clientPlaceholder"
                />
                <input
                  v-model="candidate.projectId"
                  type="text"
                  class="text-xs text-gray-500 bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-500 focus:outline-none px-1 py-0.5 w-32"
                  :placeholder="t.projectOptionalPlaceholder"
                  :aria-label="t.projectOptionalPlaceholder"
                />
              </div>

              <!-- Inline Billable checkbox -->
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                <input
                  v-model="candidate.billable"
                  type="checkbox"
                  :id="'bill-' + candidate.id"
                  class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label :for="'bill-' + candidate.id" class="cursor-pointer">{{ t.billable }}</label>
              </div>
            </div>

            <!-- Time Ranges block -->
            <div class="flex flex-wrap gap-3 text-xs bg-gray-50 p-3 rounded-xl border border-gray-100">
              <div class="flex-1 min-w-[140px]">
                <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{{ t.startTime }}</label>
                <input
                  v-model="candidate.startTime"
                  type="text"
                  :aria-label="t.startTime"
                  class="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none font-medium px-0.5 text-gray-800"
                  @change="updateCandidateDuration(candidate)"
                />
              </div>
              <div class="flex-1 min-w-[140px]">
                <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{{ t.endTime }}</label>
                <input
                  v-model="candidate.endTime"
                  type="text"
                  :aria-label="t.endTime"
                  class="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none font-medium px-0.5 text-gray-800"
                  @change="updateCandidateDuration(candidate)"
                />
              </div>
              <div class="w-full pt-1 border-t border-gray-200/20 flex justify-between items-center text-[10px] text-gray-400 font-medium">
                <span>{{ t.duration }}:</span>
                <span class="font-bold text-indigo-600 text-xs"> {{ (candidate.duration / 3600).toFixed(2) }} {{ t.hours }} </span>
              </div>
            </div>

            <!-- Detailed Notes -->
            <div class="flex flex-col gap-1">
              <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider">{{ t.notes }}</label>
              <textarea
                v-model="candidate.notes"
                rows="2"
                :aria-label="t.notes"
                class="w-full bg-gray-50/50 border border-gray-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800"
              ></textarea>
            </div>

            <!-- Evidence section (if present) -->
            <div v-if="candidate.evidence && candidate.evidence.length > 0" class="flex flex-col gap-1.5">
              <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider">{{ t.evidence }}</label>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(ev, idx) in candidate.evidence"
                  :key="idx"
                  class="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100"
                >
                  {{ ev.kind || t.activity }}
                </span>
              </div>
            </div>

            <!-- Action Buttons inside Card -->
            <div class="flex flex-wrap justify-between items-center gap-3 mt-2 pt-3 border-t border-gray-100">
              <button
                @click="deleteCandidateDraft(candidate.id)"
                class="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-all duration-200 flex items-center gap-1 shrink-0"
              >
                <span class="material-icons text-xs leading-none">delete</span>
                <span>{{ t.delete }}</span>
              </button>

              <div class="flex flex-wrap items-center gap-2">
                <button
                  @click="saveCandidateDraft(candidate)"
                  class="px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 text-xs font-semibold transition-all duration-200 flex items-center gap-1 shrink-0"
                >
                  <span class="material-icons text-xs leading-none">save</span>
                  <span>{{ t.save }}</span>
                </button>
                <button
                  @click="approveCandidateDraft(candidate.id)"
                  class="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all duration-200 flex items-center gap-1 shrink-0"
                >
                  <span class="material-icons text-xs leading-none">check</span>
                  <span>{{ t.approve }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { WorklogEntry, CandidateEntry, ExtendedToolResultComplete } from "./types";
import { useT } from "./lang";

const props = defineProps<{ selectedResult: ExtendedToolResultComplete }>();
const t = useT();

// Tabs: 'rollup' (Weekly summary) or 'review' (Candidate board)
const activeTab = ref("rollup");
const weekOffset = ref(0);

const committed = ref<WorklogEntry[]>(props.selectedResult.data?.committed ?? []);
const candidates = ref<CandidateEntry[]>(props.selectedResult.data?.candidates ?? []);

// Editcommitted entry form state
const editingEntryId = ref<string | null>(null);
const editForm = ref({
  clientId: "",
  projectId: "",
  startTime: "",
  endTime: "",
  notes: "",
  billable: true,
});

const { dispatch, pubsub } = useRuntime();

interface RefreshResponse {
  data?: {
    committed?: WorklogEntry[];
    candidates?: CandidateEntry[];
  };
}

async function refresh(): Promise<void> {
  try {
    const result = await dispatch<RefreshResponse>({ kind: "listAll" });
    if (Array.isArray(result.data?.committed)) {
      committed.value = result.data.committed;
    }
    if (Array.isArray(result.data?.candidates)) {
      candidates.value = result.data.candidates;
    }
  } catch {
    // Keep snapshot on error
  }
}

function syncActiveTab(action: string | undefined, candidateCount: number) {
  activeTab.value = action === "create" || candidateCount > 0 ? "review" : "rollup";
}

let unsub: (() => void) | undefined;
onMounted(() => {
  syncActiveTab(props.selectedResult?.args?.action, candidates.value.length);

  void refresh().then(() => {
    syncActiveTab(props.selectedResult?.args?.action, candidates.value.length);
  });

  unsub = pubsub.subscribe("changed", () => {
    void refresh().then(() => {
      syncActiveTab(props.selectedResult?.args?.action, candidates.value.length);
    });
  });
});
onUnmounted(() => unsub?.());

watch(
  () => props.selectedResult.uuid,
  () => {
    committed.value = props.selectedResult.data?.committed ?? [];
    candidates.value = props.selectedResult.data?.candidates ?? [];
    weekOffset.value = 0;

    syncActiveTab(props.selectedResult?.args?.action, candidates.value.length);

    void refresh().then(() => {
      syncActiveTab(props.selectedResult?.args?.action, candidates.value.length);
    });
  },
);

// Date Helpers
function toLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartOfWeek(offsetWeeks = 0): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offsetWeeks * 7;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildWeekdayLabels(base: Date, tVal: any): { dateStr: string; label: string }[] {
  const weekdays = [tVal.mon || "Mon", tVal.tue || "Tue", tVal.wed || "Wed", tVal.thu || "Thu", tVal.fri || "Fri", tVal.sat || "Sat", tVal.sun || "Sun"];
  const days: { dateStr: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push({
      dateStr: toLocalYMD(d),
      label: weekdays[i],
    });
  }
  return days;
}

const weekDays = computed(() => {
  return buildWeekdayLabels(getStartOfWeek(weekOffset.value), t.value);
});

function formatDateLabel(dateStr: string): string {
  // Return e.g. "05/20"
  return dateStr.substring(5).replace("-", "/");
}

// Watch week offset to trigger fetch or local calculations if needed
// Note: We also refresh the whole dataset from store whenever they navigate
watch(weekOffset, () => {
  void refresh();
});

function formatWeekRange(): string {
  const start = getStartOfWeek(weekOffset.value);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const dateStr = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const sTime = s.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const eTime = e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${dateStr}, ${sTime} - ${eTime}`;
}

// Group entries in current week
const thisWeekCommitted = computed(() => {
  const start = toLocalYMD(getStartOfWeek(weekOffset.value));
  const endRaw = getStartOfWeek(weekOffset.value);
  endRaw.setDate(endRaw.getDate() + 7);
  const end = toLocalYMD(endRaw);
  return committed.value
    .filter((e) => {
      const d = new Date(e.startTime);
      if (isNaN(d.getTime())) return false;
      const dStr = toLocalYMD(d);
      return dStr >= start && dStr < end;
    })
    .sort((a, b) => {
      const tA = new Date(a.startTime).getTime();
      const tB = new Date(b.startTime).getTime();
      if (isNaN(tA) || isNaN(tB)) {
        return b.startTime.localeCompare(a.startTime);
      }
      return tB - tA;
    });
});

// Grouped rollup row calculations for sheet view
interface RollupRow {
  key: string;
  hours: Record<string, number>;
  total: number;
}

const rollupRows = computed(() => {
  const days = weekDays.value;
  const start = days[0].dateStr;
  const endRaw = getStartOfWeek(weekOffset.value);
  endRaw.setDate(endRaw.getDate() + 7);
  const end = toLocalYMD(endRaw);

  const weekEntries = committed.value.filter((e) => {
    const d = new Date(e.startTime);
    if (isNaN(d.getTime())) return false;
    const dStr = toLocalYMD(d);
    return dStr >= start && dStr < end;
  });

  const rowMap = new Map<string, RollupRow>();

  for (const e of weekEntries) {
    const key = e.projectId ? `${e.clientId} / ${e.projectId}` : e.clientId;
    const d = new Date(e.startTime);
    if (isNaN(d.getTime())) continue;
    const dateStr = toLocalYMD(d);
    const hrs = e.duration / 3600;

    if (!rowMap.has(key)) {
      rowMap.set(key, {
        key,
        hours: {},
        total: 0,
      });
    }

    const row = rowMap.get(key)!;
    row.hours[dateStr] = (row.hours[dateStr] || 0) + hrs;
    row.total += hrs;
  }

  return Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
});

const dayTotals = computed(() => {
  const totals: Record<string, number> = {};
  let grandTotal = 0;
  for (const day of weekDays.value) {
    let daySum = 0;
    for (const row of rollupRows.value) {
      daySum += row.hours[day.dateStr] || 0;
    }
    totals[day.dateStr] = daySum;
    grandTotal += daySum;
  }
  return { totals, grandTotal };
});

// Action Dispatches

// 1. Candidate Actions
function updateCandidateDuration(candidate: CandidateEntry) {
  try {
    const startMs = new Date(candidate.startTime).getTime();
    const endMs = new Date(candidate.endTime).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      candidate.duration = Math.floor((endMs - startMs) / 1000);
    }
  } catch {
    // Ignore invalid dates during typing
  }
}

async function saveCandidateDraft(candidate: CandidateEntry) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateSave",
    candidate: { ...candidate },
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

async function deleteCandidateDraft(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateDelete",
    id,
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

async function approveCandidateDraft(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateApprove",
    id,
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

// 2. Committed Actions
function startEditCommitted(entry: WorklogEntry) {
  editingEntryId.value = entry.id;
  editForm.value = {
    clientId: entry.clientId,
    projectId: entry.projectId || "",
    startTime: entry.startTime,
    endTime: entry.endTime,
    notes: entry.notes || "",
    billable: entry.billable,
  };
}

async function saveEditCommitted(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "committedEdit",
    id,
    entry: {
      clientId: editForm.value.clientId,
      projectId: editForm.value.projectId || undefined,
      startTime: editForm.value.startTime,
      endTime: editForm.value.endTime,
      notes: editForm.value.notes,
      billable: editForm.value.billable,
    },
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
  editingEntryId.value = null;
}

async function deleteCommitted(id: string) {
  if (confirm(t.value.confirmDelete)) {
    const result = await dispatch<RefreshResponse>({
      kind: "committedDelete",
      id,
    });
    if (result.data) {
      if (result.data.candidates) candidates.value = result.data.candidates;
      if (result.data.committed) committed.value = result.data.committed;
    }
  }
}
</script>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.animate-fadeIn {
  animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
