<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-gray-700 transition-colors hover:bg-gray-100"
    :title="modelValue ? t('sessionHistoryToggle.hideTooltip') : t('sessionHistoryToggle.showTooltip')"
    :aria-label="modelValue ? t('sessionHistoryToggle.hide') : t('sessionHistoryToggle.show')"
    :aria-pressed="modelValue"
    :data-testid="`session-history-toggle-${modelValue ? 'on' : 'off'}`"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="material-symbols-outlined text-lg" aria-hidden="true">{{ modelValue ? "dock_to_right" : "toolbar" }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
