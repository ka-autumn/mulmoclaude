// @mulmoclaude/collection-plugin/vue — browser UI layer.
//
// The host frontend imports from here (the UI host binding, the rendering
// composable, and — as they move in — the View components). Configure the host
// binding once at app startup:
//   import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
//   configureCollectionUi({ fetchCollectionDetail, fileAssetUrl });
//
// Importing this entry also pulls the package's compiled Tailwind classes
// (style.css) into the host bundle — node_modules isn't in the host's Tailwind
// content scan, so the package ships its own. Hosts that only use the
// composable API should also `import "@mulmoclaude/collection-plugin/style.css"`.
import "../style.css";

export { configureCollectionUi, collectionUi, type CollectionUi } from "./uiContext";
export { useCollectionRendering, type CollectionRendering } from "./useCollectionRendering";
export { default as CollectionRecordModal } from "./components/CollectionRecordModal.vue";
export { default as CollectionEmbedView } from "./components/CollectionEmbedView.vue";
export { default as CollectionCalendarView } from "./components/CollectionCalendarView.vue";
export { default as CollectionDayView } from "./components/CollectionDayView.vue";
export { default as CollectionKanbanView } from "./components/CollectionKanbanView.vue";
export { default as CollectionRecordPanel } from "./components/CollectionRecordPanel.vue";
