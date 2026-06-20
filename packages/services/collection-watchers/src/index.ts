// @mulmoclaude/collection-watchers — the collection-completion bell
// subsystem shared by MulmoClaude and MulmoTerminal. fs.watch plumbing
// (watcher.ts) + the convergent reconciler (reconciler.ts) live here; the
// host injects its notification taxonomy + in-app routing via a
// CollectionNotificationAdapter (config.ts). Depends directly on the
// shared @mulmoclaude/notifier singleton and @mulmoclaude/collection-plugin.
export {
  configureCollectionWatchers,
  resetCollectionWatchersConfig,
  type CollectionNotificationAdapter,
  type CollectionWatcherLogger,
  type CompletionPriority,
} from "./config.js";
export {
  reconcileItem,
  reconcileAllItems,
  sweepStaleActiveEntries,
  clearItemNotification,
  resolveDisplayLabel,
  itemIsDone,
  _resetReconcilerLocksForTesting,
} from "./reconciler.js";
export {
  startCollectionWatchers,
  stopCollectionWatchers,
  _syncWatchersForTesting,
  _tickTimeTriggersForTesting,
  _scheduleItemReconcileForTesting,
  type CollectionWatcherOptions,
} from "./watcher.js";
