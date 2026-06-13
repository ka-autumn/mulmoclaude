<template>
  <!-- Per-collection config. v1 manages custom views (delete only; the header
       "+" stays the discoverable add entry point). Reuses the shared record
       modal shell for the overlay, focus trap, and Escape handling. -->
  <CollectionRecordModal @close="emit('close')">
    <div data-testid="collection-config-modal" class="flex flex-col overflow-hidden">
      <header class="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2 class="text-sm font-bold text-slate-700">{{ t("collectionsView.config.title", { title }) }}</h2>
        <button
          type="button"
          class="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          data-testid="collection-config-close"
          @click="emit('close')"
        >
          <span class="material-icons text-sm">close</span>
        </button>
      </header>

      <div class="overflow-y-auto px-5 py-4">
        <h3 class="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ t("collectionsView.config.viewsHeading") }}</h3>

        <p
          v-if="error"
          class="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600"
          data-testid="collection-config-error"
        >
          {{ error }}
        </p>

        <ul v-if="views.length > 0" class="flex flex-col gap-1">
          <li v-for="view in views" :key="view.id" class="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <span class="material-icons text-base text-slate-400">{{ view.icon || "dashboard_customize" }}</span>
            <span class="flex-1 truncate text-sm font-semibold text-slate-700">{{ view.label }}</span>
            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center rounded border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              :title="t('collectionsView.config.deleteView', { label: view.label })"
              :aria-label="t('collectionsView.config.deleteView', { label: view.label })"
              :data-testid="`collection-view-delete-${view.id}`"
              :disabled="deleting !== null"
              @click="onDelete(view)"
            >
              <span class="material-icons text-sm">delete_forever</span>
            </button>
          </li>
        </ul>

        <p v-else class="text-xs text-slate-400" data-testid="collection-config-empty">{{ t("collectionsView.config.empty") }}</p>
      </div>
    </div>
  </CollectionRecordModal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import CollectionRecordModal from "./CollectionRecordModal.vue";
import type { CollectionCustomView } from "./collectionTypes";
import { apiDelete } from "../utils/api";
import { errorMessage } from "../utils/errors";
import { useConfirm } from "../composables/useConfirm";
import { API_ROUTES } from "../config/apiRoutes";

const props = defineProps<{ slug: string; title: string; views: CollectionCustomView[] }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const { t } = useI18n();
const { openConfirm } = useConfirm();

// The id of the view whose delete is in flight (disables the other buttons),
// and the last delete error (HTTP or network), shown inline.
const deleting = ref<string | null>(null);
const error = ref<string | null>(null);

function viewDeleteUrl(viewId: string): string {
  return API_ROUTES.collections.viewDelete.replace(":slug", encodeURIComponent(props.slug)).replace(":viewId", encodeURIComponent(viewId));
}

async function onDelete(view: CollectionCustomView): Promise<void> {
  const ok = await openConfirm({
    message: t("collectionsView.config.confirmDelete", { label: view.label }),
    confirmText: t("common.remove"),
    cancelText: t("common.cancel"),
    variant: "danger",
  });
  if (!ok) return;
  error.value = null;
  deleting.value = view.id;
  try {
    const result = await apiDelete(viewDeleteUrl(view.id));
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    // Parent reloads the collection detail; the `views` prop updates reactively.
    emit("changed");
  } catch (err) {
    // apiDelete normalises network/HTTP errors into a result, so this only
    // catches the unexpected — but a `finally` guarantees the row never stays
    // stuck disabled.
    error.value = errorMessage(err);
  } finally {
    deleting.value = null;
  }
}
</script>
