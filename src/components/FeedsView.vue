<template>
  <div class="h-full overflow-y-auto bg-slate-50/50 px-6 py-6" data-testid="feeds-view-root">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-semibold text-slate-800">{{ t("collectionsView.feedsTitle") }}</h1>
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-sm"
          data-testid="feeds-add"
          @click="startAddFeedChat"
        >
          <span class="material-icons text-sm">add</span>
          <span>{{ t("common.add") }}</span>
        </button>
      </div>

      <div
        v-if="refreshError"
        class="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50/50 p-3 text-sm text-red-800 shadow-sm"
        data-testid="feeds-refresh-error"
      >
        <span class="material-icons text-base text-red-600">error</span>
        <span>{{ refreshError }}</span>
      </div>

      <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-sm text-slate-500 gap-3">
        <div class="h-8 w-8 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
        <span>{{ t("common.loading") }}</span>
      </div>

      <div v-else-if="loadError" class="rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm text-red-800 shadow-sm flex items-center gap-3">
        <span class="material-icons text-red-600">error</span>
        <span>{{ t("collectionsView.loadFailed") }}: {{ loadError }}</span>
      </div>

      <div v-else-if="feeds.length === 0" class="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
        <span class="material-icons text-4xl text-slate-300 mb-2">dynamic_feed</span>
        <p class="font-medium text-slate-700">{{ t("collectionsView.feedsEmpty") }}</p>
      </div>

      <div v-else class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="feed in feeds"
          :key="feed.slug"
          class="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-300 cursor-pointer flex items-center gap-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          role="button"
          tabindex="0"
          :data-testid="`feeds-card-${feed.slug}`"
          @click="open(feed.slug)"
          @keydown.enter.self="open(feed.slug)"
          @keydown.space.self.prevent="open(feed.slug)"
        >
          <div class="h-12 w-12 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
            <span class="material-symbols-outlined text-2xl">{{ feed.icon || "dynamic_feed" }}</span>
          </div>

          <div class="flex-1 min-w-0">
            <span class="block font-semibold text-slate-800 text-[15px] truncate">{{ feed.title }}</span>
            <span class="block text-[10px] text-slate-400 mt-1 tracking-wider font-semibold uppercase">
              {{ feed.kind }} · {{ feed.schedule }}
              <template v-if="feed.lastFetchedAt"> · {{ formatTime(feed.lastFetchedAt) }}</template>
            </span>
          </div>

          <PinToggle kind="feed" :slug="feed.slug" :title="feed.title" :icon="feed.icon || 'dynamic_feed'" />

          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-all duration-300 disabled:opacity-50"
            :disabled="refreshingSlug === feed.slug"
            :title="t('collectionsView.refreshFeed')"
            :aria-label="t('collectionsView.refreshFeed')"
            :data-testid="`feeds-refresh-${feed.slug}`"
            @click.stop="refresh(feed.slug)"
          >
            <span class="material-icons text-lg">{{ refreshingSlug === feed.slug ? "hourglass_empty" : "refresh" }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Add-feed prompt: the user supplies only a URL; the agent fetches
         it, infers the title + fields, and registers the feed itself. -->
    <div v-if="addOpen" class="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" @click.self="closeAdd">
      <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 class="text-sm font-semibold text-slate-800 mb-1">{{ t("collectionsView.addFeedTitle") }}</h2>
        <p class="text-xs text-slate-500 mb-3">{{ t("collectionsView.addFeedHint") }}</p>
        <input
          ref="addInputEl"
          v-model="addUrl"
          type="url"
          placeholder="https://example.com/feed.xml"
          class="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          data-testid="feeds-add-url"
          @keydown.enter="submitAdd"
          @keydown.esc="closeAdd"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="h-8 px-3 rounded text-xs font-medium text-slate-600 hover:bg-slate-100" @click="closeAdd">
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="h-8 px-3 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50"
            :disabled="!addUrl.trim()"
            data-testid="feeds-add-submit"
            @click="submitAdd"
          >
            {{ t("common.add") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { apiGet, apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { useAppApi } from "../composables/useAppApi";
import { useShortcuts } from "../composables/useShortcuts";
import { BUILTIN_ROLE_IDS } from "../config/roles";
import PinToggle from "./PinToggle.vue";

interface FeedSummary {
  slug: string;
  title: string;
  icon: string;
  kind: string;
  schedule: string;
  lastFetchedAt: string | null;
}
// GET /api/feeds → { feeds }.
interface FeedsListResponse {
  feeds: FeedSummary[];
}

const { t } = useI18n();
const router = useRouter();
const appApi = useAppApi();
const { reconcile } = useShortcuts();

const feeds = ref<FeedSummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const refreshingSlug = ref<string | null>(null);
/** Non-destructive banner for a per-feed Refresh that failed (the
 *  endpoint reports retriever errors via `errors` even on HTTP 200). */
const refreshError = ref<string | null>(null);

// Add-feed prompt state: the user types a URL, the agent does the rest.
const addOpen = ref(false);
const addUrl = ref("");
const addInputEl = ref<HTMLInputElement | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const result = await apiGet<FeedsListResponse>(API_ROUTES.feeds.list);
  loading.value = false;
  if (!result.ok) {
    loadError.value = result.error;
    return;
  }
  feeds.value = result.data.feeds;
  // Bulk-reconcile pinned feed shortcuts against this authoritative list:
  // prune dead slugs, refresh stale titles/icons, self-heal the file.
  void reconcile(
    "feed",
    feeds.value.map((feed) => ({ slug: feed.slug, title: feed.title, icon: feed.icon || "dynamic_feed" })),
  );
}

function open(slug: string): void {
  router.push({ name: PAGE_ROUTES.feeds, params: { slug } }).catch(() => {});
}

async function refresh(slug: string): Promise<void> {
  refreshingSlug.value = slug;
  refreshError.value = null;
  const url = API_ROUTES.collections.refresh.replace(":slug", encodeURIComponent(slug));
  const result = await apiPost<{ refreshed: boolean; written: number; errors: string[] }>(url, {});
  refreshingSlug.value = null;
  if (!result.ok) {
    refreshError.value = t("collectionsView.refreshFailed", { error: result.error });
    return;
  }
  await load(); // reload to refresh lastFetchedAt
  // refreshOne reports retriever failures via `errors` even on HTTP 200.
  if (result.data.errors.length > 0) {
    refreshError.value = t("collectionsView.refreshFailed", { error: result.data.errors.join("; ") });
  }
}

function startAddFeedChat(): void {
  addUrl.value = "";
  addOpen.value = true;
  void nextTick(() => addInputEl.value?.focus());
}

function closeAdd(): void {
  addOpen.value = false;
}

// Hand the URL to the agent with an autonomous seed prompt: it reads
// config/helps/feeds.md, fetches the URL, infers the schema from the data,
// and writes feeds/<slug>/schema.json — no follow-up questions, no tool.
function submitAdd(): void {
  const url = addUrl.value.trim();
  if (!url) return;
  addOpen.value = false;
  appApi.startNewChat(t("collectionsView.addFeedPrompt", { url }), BUILTIN_ROLE_IDS.personal);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

onMounted(load);
</script>
