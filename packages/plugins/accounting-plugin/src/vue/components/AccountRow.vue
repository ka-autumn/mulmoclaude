<template>
  <!-- One row in the AccountsModal list. Read-only display + an
       active checkbox (left column) and an Edit button (right) for
       active rows. The editor itself is AccountEditor.vue, mounted
       in place of this row by the parent when editing. -->
  <div :class="['flex items-center gap-2 px-2 py-0.5 text-sm', inactive ? 'opacity-60' : '']" :data-testid="`accounting-accounts-row-${account.code}`">
    <input
      type="checkbox"
      :checked="!inactive"
      :title="inactive ? t('pluginAccounting.accounts.reactivate') : t('pluginAccounting.accounts.deactivate')"
      :aria-label="inactive ? t('pluginAccounting.accounts.reactivate') : t('pluginAccounting.accounts.deactivate')"
      class="h-4 w-4 shrink-0 cursor-pointer"
      :data-testid="`accounting-accounts-toggle-${account.code}`"
      @change="emit('toggleActive')"
    />
    <span class="font-mono text-xs text-gray-500 w-16 shrink-0">{{ account.code }}</span>
    <span
      :class="['grow min-w-0 truncate', inactive ? 'line-through' : '']"
      :data-testid="inactive ? `accounting-accounts-inactive-${account.code}` : undefined"
      >{{ account.name }}</span
    >
    <span v-if="account.note" class="text-xs text-gray-400 truncate max-w-[8rem]" :title="account.note">{{ account.note }}</span>
    <!-- Always rendered (with `invisible` when inactive) so checking
         and unchecking the active box doesn't shift the row width. -->
    <button
      type="button"
      :class="['h-8 px-2.5 rounded text-sm text-blue-600 hover:bg-blue-50', inactive ? 'invisible' : '']"
      :data-testid="`accounting-accounts-edit-${account.code}`"
      :disabled="inactive"
      :aria-hidden="inactive ? 'true' : undefined"
      :tabindex="inactive ? -1 : undefined"
      @click="emit('edit')"
    >
      {{ t("pluginAccounting.accounts.edit") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Account } from "../api";

const { t } = useI18n();

const props = defineProps<{ account: Account }>();
const emit = defineEmits<{ edit: []; toggleActive: [] }>();

const inactive = computed(() => props.account.active === false);
</script>
