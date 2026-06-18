// Collection surface types for the list/detail view (CollectionView.vue), the
// record panel (CollectionRecordPanel.vue), the calendar view, and the
// rendering composable (composables/collections/useCollectionRendering.ts).
//
// All of these now live in @mulmoclaude/collection-plugin — the canonical schema
// types AND the UI-only view-state types — the single source of truth shared
// with the server and MulmoTerminal. They are re-exported here under the names
// the frontend has always used (FieldType ← CollectionFieldType, FieldSpec ←
// CollectionFieldSpec) so the importing components keep compiling unchanged.

export type {
  CollectionFieldType as FieldType,
  CollectionFieldSpec as FieldSpec,
  CollectionAction,
  CollectionViewCapability,
  CollectionCustomView,
  CollectionSchema,
  CollectionDetail,
  CollectionItem,
  // UI-only view-state types (no server/storage analog):
  CollectionRecordIssue,
  CollectionDetailResponse,
  ItemMutationResponse,
  TableRowDraft,
  EditState,
  RefDisplayMap,
  RefCache,
  RefRecordMap,
  RefRecordCache,
  EmbedTargetData,
  EmbedCache,
  RefOption,
} from "@mulmoclaude/collection-plugin";
