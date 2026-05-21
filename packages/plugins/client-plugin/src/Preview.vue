<template>
  <div
    class="p-3 text-xs font-sans text-slate-700 bg-white/50 backdrop-blur-sm rounded-lg border border-slate-200/60 shadow-sm hover:shadow transition-all duration-200"
  >
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="flex items-center gap-1">
          <span
            >{{ t("activeClients") }}: <strong class="font-extrabold text-slate-900">{{ activeClientsCount }}</strong></span
          >
        </div>
        <span class="text-slate-300">|</span>
        <div class="flex items-center gap-1">
          <span
            >{{ t("activeProjects") }}: <strong class="font-extrabold text-slate-900">{{ activeProjectsCount }}</strong></span
          >
        </div>
      </div>
      <div v-if="pendingReviewCount > 0" class="flex items-center gap-1 shrink-0 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/50 text-[10px]">
        <span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
        <span class="font-semibold text-amber-700">{{ pendingReviewCount }} {{ t("pendingReview") }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useT, format } from "./lang";
import type { Client, Project, ClientCandidate, ProjectCandidate } from "./types";

const messages = useT();

function t(key: keyof typeof messages.value, params?: Record<string, string | number>): string {
  const template = messages.value[key];
  return params ? format(template, params) : template;
}

// Typing for dispatch calls
interface ListClientsResponse {
  ok: boolean;
  // `list` is a narration-only action (worklog convention): the LLM-facing payload
  // lives under `jsonData`; no top-level `clients`/`candidates`, no `data` field.
  jsonData?: {
    clients?: Client[];
    candidates?: ClientCandidate[];
  };
}

interface ListProjectsResponse {
  ok: boolean;
  projects?: Project[];
  candidates?: ProjectCandidate[];
}

const props = defineProps<{ result: ToolResultComplete<any> }>();

const clients = ref<Client[]>([]);
const clientCandidates = ref<ClientCandidate[]>([]);
const projects = ref<Project[]>([]);
const projectCandidates = ref<ProjectCandidate[]>([]);

const { dispatch, pubsub } = useRuntime();

async function refresh(): Promise<void> {
  try {
    const [clientsRes, projectsRes] = await Promise.all([
      dispatch<ListClientsResponse>({ action: "list" }),
      dispatch<ListProjectsResponse>({ action: "listProjects" }),
    ]);

    if (clientsRes?.ok && Array.isArray(clientsRes.jsonData?.clients)) {
      clients.value = clientsRes.jsonData.clients;
    }
    if (clientsRes?.ok && Array.isArray(clientsRes.jsonData?.candidates)) {
      clientCandidates.value = clientsRes.jsonData.candidates;
    }
    if (projectsRes?.ok && Array.isArray(projectsRes.projects)) {
      projects.value = projectsRes.projects;
    }
    if (projectsRes?.ok && Array.isArray(projectsRes.candidates)) {
      projectCandidates.value = projectsRes.candidates;
    }
  } catch {
    // Fail silently since this is just a thumbnail preview
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
});

onUnmounted(() => {
  unsub?.();
});

watch(
  () => props.result.uuid,
  () => {
    void refresh();
  },
);

const activeClientsCount = computed(() => {
  return clients.value.filter((c) => c.status === "active").length;
});

const activeProjectsCount = computed(() => {
  return projects.value.filter((p) => p.status === "active").length;
});

const pendingReviewCount = computed(() => {
  return clientCandidates.value.length + projectCandidates.value.length;
});
</script>
