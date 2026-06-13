<template>
  <div class="w-full h-full" data-testid="present-collection">
    <CollectionView
      v-if="slug"
      :slug="slug"
      :selected="selected"
      :initial-view="viewState?.view"
      :initial-anchor-field="viewState?.anchorField"
      :initial-group-field="viewState?.groupField"
      :send-text-message="sendTextMessage"
      @select="onSelect"
      @view-state-change="onViewStateChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import CollectionView from "../../components/CollectionView.vue";
import type { PresentCollectionData } from "./types";

/** Card-local UI state persisted in the tool result's `viewState` so it
 *  survives a re-render — same pattern as presentForm. `selected` is the
 *  open record (`null` once explicitly closed); `view` / `anchorField` /
 *  `groupField` keep the table↔calendar↔kanban choice and its axes sticky.
 *  NOTE: the table sort is deliberately NOT here — it's a single shared
 *  per-collection preference in localStorage (read+written by both the
 *  standalone page and chat cards), so it stays consistent everywhere. */
interface PresentCollectionViewState {
  selected?: string | null;
  view?: "table" | "calendar" | "kanban";
  anchorField?: string;
  groupField?: string;
}

const props = defineProps<{
  selectedResult: ToolResult | null;
  /** Host-provided channel into the current chat session. Forwarded to
   *  CollectionView so its chat actions send a message here instead of
   *  spawning a new chat (the card is always rendered inside a chat). */
  sendTextMessage?: (text?: string) => void;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult];
}>();

const data = computed<PresentCollectionData | null>(
  () => (props.selectedResult?.data ?? props.selectedResult?.jsonData ?? null) as PresentCollectionData | null,
);

const slug = computed<string | undefined>(() => data.value?.collectionSlug);

const viewState = computed<PresentCollectionViewState | null>(() => (props.selectedResult?.viewState as PresentCollectionViewState | undefined) ?? null);

/** Open record: the card-local `viewState.selected` once the user has
 *  navigated within the card (including an explicit close → null), else
 *  the tool's initial `itemId`. */
const selected = computed<string | undefined>(() => {
  const state = viewState.value;
  if (state && "selected" in state) return state.selected ?? undefined;
  return data.value?.itemId;
});

function onSelect(itemId: string | null): void {
  if (!props.selectedResult) return;
  emit("updateResult", { ...props.selectedResult, viewState: { ...viewState.value, selected: itemId } });
}

function onViewStateChange(state: { view: "table" | "calendar" | "kanban"; anchorField: string; groupField: string }): void {
  if (!props.selectedResult) return;
  // Skip redundant writes (the anchor/group settling on load fires this once).
  const current = viewState.value;
  if (current?.view === state.view && current?.anchorField === state.anchorField && current?.groupField === state.groupField) return;
  emit("updateResult", {
    ...props.selectedResult,
    viewState: { ...current, view: state.view, anchorField: state.anchorField, groupField: state.groupField },
  });
}
</script>
