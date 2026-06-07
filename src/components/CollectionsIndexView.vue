<template>
  <div class="h-full overflow-y-auto bg-slate-50/50 px-6 py-6" data-testid="collections-view-root">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-semibold text-slate-800">
          {{ t("collectionsView.title") }}
        </h1>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-sm"
          data-testid="collections-add-collection"
          @click="startCreateCollectionChat"
        >
          <span class="material-icons text-sm">add</span>
          <span>{{ t("collectionsView.addCollectionLabel") }}</span>
        </button>
      </div>

      <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-sm text-slate-500 gap-3">
        <div class="h-8 w-8 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
        <span>{{ t("common.loading") }}</span>
      </div>

      <div v-else-if="loadError" class="rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3">
        <span class="material-icons text-red-600">error</span>
        <span>{{ t("collectionsView.loadFailed") }}: {{ loadError }}</span>
      </div>

      <div v-else-if="collections.length === 0" class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
        <span class="material-icons text-4xl text-slate-300 mb-2">dashboard_customize</span>
        <p class="font-medium text-slate-700">{{ t("collectionsView.indexEmpty") }}</p>
      </div>

      <div v-else class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="collection in collections"
          :key="collection.slug"
          class="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-300 cursor-pointer flex items-center gap-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          role="button"
          tabindex="0"
          :aria-label="t('collectionsView.openCollection', { title: collection.title })"
          :data-testid="`collections-index-card-${collection.slug}`"
          @click="openCollection(collection.slug)"
          @keydown.enter.self="openCollection(collection.slug)"
          @keydown.space.self.prevent="openCollection(collection.slug)"
        >
          <!-- Left border color line showing source -->
          <div
            class="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-all duration-300 group-hover:w-1.5"
            :class="collection.source === 'project' ? 'bg-indigo-600' : 'bg-violet-600'"
          ></div>

          <!-- Styled icon badge -->
          <div
            class="h-12 w-12 flex items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-105 shadow-sm"
            :class="
              collection.source === 'project'
                ? 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100/80 border border-indigo-100/50'
                : 'bg-violet-50 text-violet-600 group-hover:bg-violet-100/80 border border-violet-100/50'
            "
          >
            <span class="material-symbols-outlined text-2xl">{{ collection.icon }}</span>
          </div>

          <div class="flex-1 min-w-0">
            <span class="block font-semibold text-slate-800 text-[15px] group-hover:text-indigo-950 transition-colors truncate">
              {{ collection.title }}
            </span>
            <span class="block text-[10px] text-slate-400 mt-1 tracking-wider font-semibold uppercase flex items-center gap-1.5">
              <span class="h-1.5 w-1.5 rounded-full" :class="collection.source === 'project' ? 'bg-indigo-500' : 'bg-violet-500'"></span>
              {{ t(`collectionsView.source.${collection.source}`) }} ·
              <code class="text-[10px] bg-slate-100 px-1 rounded lowercase text-slate-500 font-mono font-normal">{{ collection.slug }}</code>
            </span>
          </div>

          <PinToggle kind="collection" :slug="collection.slug" :title="collection.title" :icon="collection.icon" />

          <div
            class="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-50 group-hover:bg-indigo-50 text-slate-400 group-hover:text-indigo-600 transition-all duration-300"
          >
            <span class="material-icons text-lg transition-transform duration-300 group-hover:translate-x-0.5">chevron_right</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { useAppApi } from "../composables/useAppApi";
import { useShortcuts } from "../composables/useShortcuts";
import { BUILTIN_ROLE_IDS } from "../config/roles";
import PinToggle from "./PinToggle.vue";

interface CollectionSummary {
  slug: string;
  title: string;
  icon: string;
  // "feed" = a data-source collection from the <workspace>/feeds/ registry.
  source: "user" | "project" | "feed";
}

interface CollectionsListResponse {
  collections: CollectionSummary[];
}

const { t } = useI18n();
const router = useRouter();
const appApi = useAppApi();
const { reconcile } = useShortcuts();

const collections = ref<CollectionSummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadCollections(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const result = await apiGet<CollectionsListResponse>(API_ROUTES.collections.list);
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  // Feeds (source "feed") have their own /feeds surface — keep the
  // Collections index to skill-backed collections so they don't double-list.
  collections.value = result.data.collections.filter((collection) => collection.source !== "feed");
  // Bulk-reconcile pinned collection shortcuts against this authoritative
  // list (free — we already fetched it): prune dead slugs, refresh stale
  // titles/icons, self-heal the file. Feed shortcuts are left to FeedsView.
  void reconcile(
    "collection",
    collections.value.map((collection) => ({ slug: collection.slug, title: collection.title, icon: collection.icon })),
  );
}

function openCollection(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

function startCreateCollectionChat(): void {
  appApi.startNewChat(t("collectionsView.addCollectionPrompt"), BUILTIN_ROLE_IDS.general);
}

onMounted(loadCollections);
</script>
