// Collection-completion bell reconciler — thin host binding over
// @mulmoclaude/collection-watchers. The convergent reconcile logic lives
// in the shared package; this file supplies MulmoClaude's notification
// taxonomy (publish under "todo", priority→severity mapping) and in-app
// routing (the `/collections/<slug>?selected=<itemId>` deep-link) via a
// CollectionNotificationAdapter, and re-exports the reconciler surface
// existing callers + tests import from `./notifications.js`.

import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_VIEWS,
  type NotificationAction,
} from "../../../src/types/notification.js";
import {
  isLegacyNotifierPluginData,
  legacyActionToNavigateTarget,
  legacyKindToPluginPkg,
  legacyPriorityToSeverity,
  type LegacyNotifierPluginData,
} from "../../events/notifications.js";
import { log } from "../../system/logger/index.js";
import { configureCollectionWatchers, type CollectionNotificationAdapter, type CompletionPriority } from "@mulmoclaude/collection-watchers";

// Re-export the reconciler surface verbatim from the package.
export {
  reconcileItem,
  reconcileAllItems,
  sweepStaleActiveEntries,
  clearItemNotification,
  resolveDisplayLabel,
  itemIsDone,
} from "@mulmoclaude/collection-watchers";

const COLLECTION_PLUGIN_PKG = legacyKindToPluginPkg(NOTIFICATION_KINDS.todo);

function collectionAction(slug: string, itemId: string): NotificationAction {
  return { type: NOTIFICATION_ACTION_TYPES.navigate, target: { view: NOTIFICATION_VIEWS.collections, slug, itemId } };
}

/** MulmoClaude's adapter: collection-completion bells publish under the
 *  legacy "todo" namespace, map two-level completion priority onto the
 *  legacy severity scale, deep-link into the collections view, and stash
 *  the reconciler's key in a `LegacyNotifierPluginData` so the bell
 *  preserves icon / dedup semantics. */
const hostCollectionAdapter: CollectionNotificationAdapter = {
  pluginPkg: COLLECTION_PLUGIN_PKG,
  priorityToSeverity: (priority) => legacyPriorityToSeverity(priority === "high" ? NOTIFICATION_PRIORITIES.high : NOTIFICATION_PRIORITIES.normal),
  // `legacyActionToNavigateTarget` returns a string for every collections
  // navigate (slug is validated upstream); the `?? ""` is a defensive
  // floor that, if it ever hit, makes the action-lifecycle publish throw
  // and get caught+logged in the reconciler — same as the old undefined path.
  buildNavigateTarget: (slug, itemId) => legacyActionToNavigateTarget(collectionAction(slug, itemId)) ?? "",
  buildPluginData: ({ legacyId, slug, itemId, priority }): LegacyNotifierPluginData => ({
    legacy: true,
    legacyId,
    kind: NOTIFICATION_KINDS.todo,
    priority: priority === "high" ? NOTIFICATION_PRIORITIES.high : NOTIFICATION_PRIORITIES.normal,
    action: collectionAction(slug, itemId),
  }),
  readEntry: (pluginData) => {
    if (!isLegacyNotifierPluginData(pluginData)) return null;
    const priority: CompletionPriority = pluginData.priority === NOTIFICATION_PRIORITIES.high ? "high" : "normal";
    return { legacyId: pluginData.legacyId, priority };
  },
};

// Configure the package at module load — before `startCollectionWatchers`
// or any direct reconcile call. The logger prefixes the "collections"
// scope the package's host-agnostic log() calls omit.
configureCollectionWatchers({
  adapter: hostCollectionAdapter,
  log: {
    info: (message, data) => log.info("collections", message, data),
    warn: (message, data) => log.warn("collections", message, data),
  },
});
