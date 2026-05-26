<template>
  <!-- Found: the whole card links to the embedded record's detail view,
       like a normal `ref` link (record → record hop). -->
  <router-link
    v-if="view.found"
    :to="{ path: `/collections/${view.targetSlug}`, query: { selected: view.recordId } }"
    class="block rounded border border-gray-200 bg-gray-50 p-3 space-y-2 hover:bg-gray-100 hover:border-gray-300 transition-colors"
    :data-testid="`collections-embed-${fieldKey}`"
  >
    <div v-for="row in view.rows" :key="row.key" class="space-y-0.5">
      <div class="text-xs font-medium text-gray-500">{{ row.label }}</div>
      <div class="text-sm text-gray-800 break-words" :data-testid="`collections-embed-${fieldKey}-${row.key}`">
        <template v-if="row.type === 'boolean'">
          <span v-if="row.value === true" class="material-icons text-green-600 text-base align-middle">check</span>
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- bare "—" empty-value glyph, same treatment as the other read-only detail branches. -->
          <span v-else class="text-gray-400">—</span>
        </template>
        <p v-else-if="row.type === 'markdown'" class="whitespace-pre-wrap">{{ row.display }}</p>
        <span v-else>{{ row.display }}</span>
      </div>
    </div>
  </router-link>
  <div v-else class="rounded border border-gray-200 bg-gray-50 p-3" :data-testid="`collections-embed-${fieldKey}`">
    <p class="text-sm text-red-700" :data-testid="`collections-embed-missing-${fieldKey}`">
      {{ t("collectionsView.embedMissing", { collection: view.targetSlug, id: view.recordId }) }}
      <router-link v-if="view.targetSlug" :to="{ path: `/collections/${view.targetSlug}` }" class="text-blue-600 hover:underline ml-1">{{
        t("collectionsView.embedCreate")
      }}</router-link>
    </p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { EmbedView } from "./collectionEmbed";

defineProps<{ view: EmbedView; fieldKey: string }>();

const { t } = useI18n();
</script>
