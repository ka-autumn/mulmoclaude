<template>
  <button
    class="relative flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-gray-700 transition-colors hover:bg-gray-100"
    :title="modelValue ? t('sessionHistoryToggle.hideTooltip') : t('sessionHistoryToggle.showTooltip')"
    :aria-label="modelValue ? t('sessionHistoryToggle.hide') : t('sessionHistoryToggle.show')"
    :aria-pressed="modelValue"
    :data-testid="`session-history-toggle-${modelValue ? 'on' : 'off'}`"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="material-symbols-outlined text-lg" aria-hidden="true">{{ modelValue ? "dock_to_right" : "toolbar" }}</span>
    <span
      v-if="activeSessionCount > 0"
      class="absolute -top-0.5 -left-0.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
      :title="t('sessionTabBar.activeSessions', activeSessionCount, { named: { count: activeSessionCount } })"
      >{{ activeSessionCount }}</span
    >
    <span
      v-if="unreadCount > 0"
      class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
      :title="t('sessionTabBar.unreadReplies', unreadCount, { named: { count: unreadCount } })"
      >{{ unreadCount }}</span
    >
  </button>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  modelValue: boolean;
  activeSessionCount: number;
  unreadCount: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
