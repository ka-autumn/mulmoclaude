<template>
  <div class="h-full overflow-y-auto p-6">
    <div class="max-w-3xl mx-auto">
      <h1 class="text-xl font-medium text-gray-900 mb-4">{{ t("appsView.title") }}</h1>

      <div v-if="loading" class="text-sm text-gray-500">{{ t("common.loading") }}</div>

      <div v-else-if="loadError" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ t("appsView.loadFailed") }}: {{ loadError }}
      </div>

      <div v-else-if="apps.length === 0" class="rounded border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
        {{ t("appsView.indexEmpty") }}
      </div>

      <ul v-else class="grid gap-2 sm:grid-cols-2">
        <li v-for="app in apps" :key="app.slug">
          <button
            class="w-full text-left rounded border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors px-4 py-3 flex items-center gap-3"
            :data-testid="`apps-index-card-${app.slug}`"
            @click="openApp(app.slug)"
          >
            <span class="material-icons text-blue-600">{{ app.icon }}</span>
            <span class="flex-1 min-w-0">
              <span class="block font-medium text-gray-900 truncate">{{ app.title }}</span>
              <span class="block text-[11px] uppercase tracking-wide text-gray-400">{{ app.source }} · {{ app.slug }}</span>
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

interface AppSummary {
  slug: string;
  title: string;
  icon: string;
  source: "user" | "project";
}

interface AppsListResponse {
  apps: AppSummary[];
}

const { t } = useI18n();
const router = useRouter();

const apps = ref<AppSummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadApps(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const result = await apiGet<AppsListResponse>(API_ROUTES.apps.list);
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  apps.value = result.data.apps;
}

function openApp(slug: string): void {
  router.push({ name: PAGE_ROUTES.apps, params: { slug } }).catch(() => {});
}

onMounted(loadApps);
</script>
