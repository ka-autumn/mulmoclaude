<template>
  <!-- Active-session + unread-reply count badges. Presentational only;
       the parent element must be `position: relative` so the absolute
       offsets anchor to it. Extracted from SessionHistoryToggleButton so
       the counts can ride the top-bar Chat button (always visible) while
       the history toggle itself is chat-only. -->
  <span
    v-if="activeSessionCount > 0"
    class="absolute -top-0.5 -left-0.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
    data-testid="session-count-active"
    :title="t('sessionTabBar.activeSessions', activeSessionCount, { named: { count: activeSessionCount } })"
    >{{ activeSessionCount }}</span
  >
  <span
    v-if="unreadCount > 0"
    class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
    data-testid="session-count-unread"
    :title="t('sessionTabBar.unreadReplies', unreadCount, { named: { count: unreadCount } })"
    >{{ unreadCount }}</span
  >
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  activeSessionCount: number;
  unreadCount: number;
}>();
</script>
