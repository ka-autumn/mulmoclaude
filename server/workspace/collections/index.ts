export { discoverCollections, loadCollection, toSummary, toDetail, type LoadedCollection } from "./discovery.js";
export {
  listItems,
  readItem,
  writeItem,
  deleteItem,
  generateItemId,
  resolveCreateItemId,
  readSkillTemplate,
  buildActionSeedPrompt,
  type WriteItemResult,
  type DeleteItemResult,
} from "./io.js";
export type {
  CollectionSchema,
  CollectionFieldSpec,
  CollectionFieldType,
  CollectionSummary,
  CollectionDetail,
  CollectionItem,
  CollectionSource,
} from "./types.js";
