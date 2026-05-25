<template>
  <div class="h-full overflow-y-auto p-6">
    <div class="max-w-3xl mx-auto">
      <h1 class="text-xl font-medium text-gray-900 mb-4">{{ t("collectionsView.title") }}</h1>

      <div v-if="loading" class="text-sm text-gray-500">{{ t("common.loading") }}</div>

      <div v-else-if="loadError" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ t("collectionsView.loadFailed") }}: {{ loadError }}
      </div>

      <div v-else-if="collections.length === 0" class="rounded border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
        {{ t("collectionsView.indexEmpty") }}
      </div>

      <ul v-else class="grid gap-2 sm:grid-cols-2">
        <li v-for="collection in collections" :key="collection.slug">
          <button
            class="w-full text-left rounded border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors px-4 py-3 flex items-center gap-3"
            :data-testid="`collections-index-card-${collection.slug}`"
            @click="openCollection(collection.slug)"
          >
            <span class="material-icons text-blue-600">{{ collection.icon }}</span>
            <span class="flex-1 min-w-0">
              <span class="block font-medium text-gray-900 truncate">{{ collection.title }}</span>
              <span class="block text-[11px] uppercase tracking-wide text-gray-400"
                >{{ t(`collectionsView.source.${collection.source}`) }} · {{ collection.slug }}</span
              >
            </span>
            <span class="material-icons text-gray-400 text-base">chevron_right</span>
          </button>
        </li>
      </ul>
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

interface CollectionSummary {
  slug: string;
  title: string;
  icon: string;
  source: "user" | "project";
}

interface CollectionsListResponse {
  collections: CollectionSummary[];
}

const { t } = useI18n();
const router = useRouter();

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
  collections.value = result.data.collections;
}

function openCollection(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

onMounted(loadCollections);
</script>
