<template>
  <div
    v-if="!backendReachable"
    data-testid="backend-offline-banner"
    role="alert"
    class="flex items-center gap-2 px-3 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm"
  >
    <span class="material-icons text-base" aria-hidden="true">cloud_off</span>
    <div class="flex-1 min-w-0">
      <div class="font-medium">{{ t("backendOffline.title") }}</div>
      <div class="text-xs text-red-600 truncate">
        <span>{{ t("backendOffline.body") }}</span>
        <span v-if="lastBackendError" class="opacity-70">{{ ` — ${lastBackendError}` }}</span>
      </div>
    </div>
    <button
      type="button"
      data-testid="backend-offline-retry"
      class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-40"
      :disabled="retrying"
      @click="retry"
    >
      <span class="material-icons text-sm" :class="retrying ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
      {{ t("backendOffline.retry") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { backendReachable, lastBackendError } from "../utils/api";

const { t } = useI18n();

const props = defineProps<{
  /** Health-check function injected by the parent (uses the shared
   *  `useHealth` instance so we don't spin up a second poll loop). */
  onRetry: () => Promise<void>;
}>();

const retrying = ref(false);

async function retry(): Promise<void> {
  if (retrying.value) return;
  retrying.value = true;
  try {
    // `fetchHealth` hits `/api/health` through `apiCall`, which on
    // success automatically flips `backendReachable` back to true.
    // We don't need to manage that ourselves.
    await props.onRetry();
  } finally {
    retrying.value = false;
  }
}
</script>
