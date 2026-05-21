<template>
  <div class="p-2 text-xs font-sans text-slate-800">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <!-- Left side: Stats -->
      <div class="flex items-center gap-1.5 flex-wrap">
        <span
          >{{ t.currWeek }}: <strong class="font-extrabold text-slate-950">{{ thisWeekHours.toFixed(1) }}{{ t.hrs }}</strong></span
        >
        <span class="text-slate-300">|</span>
        <span
          >{{ t.prevWeek }}: <strong class="font-extrabold text-slate-950">{{ lastWeekHours.toFixed(1) }}{{ t.hrs }}</strong></span
        >
      </div>
      <!-- Right side: Review Board Alert -->
      <div v-if="candidates.length > 0" class="flex items-center gap-1 shrink-0">
        <span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
        <span class="font-bold text-amber-700"> {{ candidates.length }} {{ t.reviewBoard }} </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WorklogEntry, CandidateEntry } from "./types";
import { useT } from "./lang";

const props = defineProps<{ result: ToolResultComplete<any> }>();
const t = useT();

const committed = ref<WorklogEntry[]>(props.result.data?.committed ?? []);
const candidates = ref<CandidateEntry[]>(props.result.data?.candidates ?? []);

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
    // Keep initialized fallback on failure
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
});
onUnmounted(() => unsub?.());

watch(
  () => props.result.uuid,
  () => {
    committed.value = props.result.data?.committed ?? [];
    candidates.value = props.result.data?.candidates ?? [];
    void refresh();
  },
);

// Date Helpers
function getStartOfWeek(offsetWeeks = 0): Date {
  const d = new Date();
  const day = d.getDay();
  // Adjust Monday as day 1, Sunday as day 7
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offsetWeeks * 7;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

const thisWeekHours = computed(() => {
  const start = getStartOfWeek(0).getTime();
  const end = getStartOfWeek(1).getTime();
  return (
    committed.value
      .filter((e) => {
        const t = new Date(e.startTime).getTime();
        return !isNaN(t) && t >= start && t < end;
      })
      .reduce((sum, e) => sum + e.duration, 0) / 3600
  );
});

const lastWeekHours = computed(() => {
  const start = getStartOfWeek(-1).getTime();
  const end = getStartOfWeek(0).getTime();
  return (
    committed.value
      .filter((e) => {
        const t = new Date(e.startTime).getTime();
        return !isNaN(t) && t >= start && t < end;
      })
      .reduce((sum, e) => sum + e.duration, 0) / 3600
  );
});
</script>
