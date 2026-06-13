<template>
  <div class="custom-view-container">
    <div v-if="error" class="custom-view-message" role="alert" data-testid="collection-custom-view-error">
      {{ t("collectionsView.customViewError", { error }) }}
    </div>
    <div v-else-if="loading" class="custom-view-message" data-testid="collection-custom-view-loading">
      {{ t("collectionsView.customViewLoading") }}
    </div>
    <!-- Sandboxed: `allow-scripts` only (no `allow-same-origin`), so the view
         has an opaque origin and cannot read the parent's token / localStorage.
         Its data reaches it only via the scoped token injected into __MC_VIEW. -->
    <iframe
      v-else-if="srcdoc"
      :key="view.id"
      data-testid="collection-custom-view-iframe"
      :srcdoc="srcdoc"
      sandbox="allow-scripts"
      class="w-full h-full border-0"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { API_ROUTES } from "../config/apiRoutes";
import { apiPost, apiFetchRaw } from "../utils/api";
import { buildCustomViewSrcdoc } from "../utils/html/customViewSrcdoc";
import { errorMessage } from "../utils/errors";
import type { CollectionCustomView } from "./collectionTypes";

const { t } = useI18n();

const props = defineProps<{
  slug: string;
  view: CollectionCustomView;
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const srcdoc = ref<string | null>(null);

const viewTokenUrl = computed(() => API_ROUTES.collections.viewToken.replace(":slug", encodeURIComponent(props.slug)));
const viewFileUrl = computed(() => API_ROUTES.collections.viewFile.replace(":slug", encodeURIComponent(props.slug)));

interface MintResponse {
  token: string;
  exp: number;
  dataUrl: string;
  capabilities: string[];
}

// The injected token expires (VIEW_TOKEN_TTL_MS, 1h). The sandboxed view can't
// re-mint itself (it has no global bearer), so a view left mounted past expiry
// would 401 on its next read/write. Schedule a re-mint + reload shortly before
// `exp` so the iframe always holds a fresh token.
const REMINT_LEAD_MS = 60_000;
const MIN_REMINT_DELAY_MS = 10_000;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function clearRefresh(): void {
  if (refreshTimer !== undefined) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
}

function scheduleRefresh(expMs: number): void {
  clearRefresh();
  const delay = Math.max(expMs - Date.now() - REMINT_LEAD_MS, MIN_REMINT_DELAY_MS);
  refreshTimer = setTimeout(() => void load(), delay);
}

async function load(): Promise<void> {
  clearRefresh();
  loading.value = true;
  error.value = null;
  srcdoc.value = null;
  try {
    // 1. Mint a scoped token for this view's declared capabilities.
    const mint = await apiPost<MintResponse>(viewTokenUrl.value, { viewId: props.view.id });
    if (!mint.ok) {
      error.value = mint.error;
      return;
    }
    // Re-mint + reload before this token expires (the iframe can't do it itself).
    scheduleRefresh(mint.data.exp);
    // 2. Fetch the view's HTML (global-bearer; attached by apiFetchRaw).
    const resp = await apiFetchRaw(viewFileUrl.value, { query: { id: props.view.id } });
    if (!resp.ok) {
      error.value = `HTTP ${resp.status}`;
      return;
    }
    const html = await resp.text();
    // 3. Render it sandboxed with the token + CSP injected.
    srcdoc.value = buildCustomViewSrcdoc(html, {
      slug: props.slug,
      token: mint.data.token,
      dataUrl: mint.data.dataUrl,
      origin: window.location.origin,
    });
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

// Reload (re-mint + re-fetch) whenever the selected view or collection changes.
watch([() => props.slug, () => props.view.id], () => void load(), { immediate: true });

onBeforeUnmount(clearRefresh);
</script>

<style scoped>
.custom-view-container {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.custom-view-message {
  padding: 1rem;
  font-size: 0.875rem;
  color: #64748b;
}

[role="alert"].custom-view-message {
  color: #b71c1c;
}
</style>
