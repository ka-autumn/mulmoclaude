<template>
  <!-- Plugin-seeded first user turn (e.g. Encore): render the same
       one-line extension-icon + label preview the skill plugin uses,
       so the chat-history sidebar reads it as "seeded by a plugin"
       rather than a wall-of-text user message. -->
  <div v-if="isSeededUserTurn" class="flex items-center gap-1.5 text-sm text-gray-700 p-2" data-testid="text-response-preview-seeded">
    <span class="material-icons text-purple-500 text-sm shrink-0">extension</span>
    <span class="truncate font-medium">{{ t("pluginTextResponse.seededByPlugin", { pkg: seededByPlugin }) }}</span>
  </div>
  <div v-else class="p-2">
    <div class="preview-text text-sm leading-snug" :class="textColorClass">{{ previewText }}</div>
    <div v-if="attachments.length > 0" class="flex flex-wrap gap-1 mt-1.5" data-testid="text-response-preview-attachments">
      <SentAttachmentChip v-for="path in attachments" :key="path" :path="path" variant="thumb" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "./types";
import SentAttachmentChip from "../../components/SentAttachmentChip.vue";

const { t } = useI18n();

const props = defineProps<{
  result: ToolResultComplete<TextResponseData>;
}>();

const messageRole = computed(() => props.result.data?.role ?? "assistant");
const seededByPlugin = computed<string>(() => props.result.data?.seededByPlugin ?? "");
const isSeededUserTurn = computed(() => Boolean(seededByPlugin.value) && messageRole.value === "user");

const textColorClass = computed(() => {
  switch (messageRole.value) {
    case "system":
      return "text-blue-700";
    case "user":
      return "text-green-700 font-medium";
    default:
      return "text-gray-700";
  }
});

const previewText = computed(() => markdownToPlainText(props.result.data?.text ?? ""));

const attachments = computed<string[]>(() => props.result.data?.attachments ?? []);

function markdownToPlainText(markdown: string): string {
  const html = marked(markdown, { breaks: true, gfm: true }) as string;
  const spaced = html
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|tr|blockquote|pre|div)>/gi, "$&\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  const text = doc.body.textContent ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
</script>

<style scoped>
.preview-text {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
