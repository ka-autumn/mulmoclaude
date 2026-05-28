// Bell-notification side-channel for collections whose schema declares
// `completionField`. Driven by `watcher.ts`, which calls into the
// reconciler functions below on file-system events and on boot.
//
// The model is **convergent**: a watcher event re-reads the record from
// disk and the reconciler enforces the invariant
//
//   bell entry exists for (slug, itemId)  ↔
//     schema has completionField  ∧
//     file exists  ∧
//     `String(item[completionField])` ∉ completionDoneValues
//
// Each reconcile is idempotent (`ensure*` / `clear*` no-op when state
// already matches). This is why event-type quirks of `fs.watch`
// (`rename` vs `change`, missed events, atomic-write coalescence)
// don't matter — every event re-derives the desired state from the
// file, not from the event.
//
// Lookup uses the legacy publisher's caller-supplied `id` stashed on
// `pluginData.legacyId`: every notification this module fires uses
// a deterministic id derived from `<slug>:<itemId>`, so the clear path
// and the dedup check can both find the entry without a side state
// file.

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
import { clear as notifierClear, listAll, publish as notifierPublish } from "../../notifier/engine.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { loadCollection, type DiscoveryOptions } from "./discovery.js";
import { listItems, readItem, type IoOptions } from "./io.js";
import type { CollectionItem, CollectionSchema } from "./types.js";

/** The legacy-id prefix every collection-completion bell entry carries.
 *  Used both to build new ids and to filter sweep candidates from the
 *  active bell. Kept private so external callers can't depend on the
 *  exact format. */
const LEGACY_ID_PREFIX = "collection-completion:";

/** Stable id encoding slug + item. Stashed on the bell entry's
 *  `pluginData.legacyId` so we can find it later without a side state
 *  file. Slug + itemId are upstream-validated via `safeSlugName`, which
 *  forbids the colon separator, so the two-segment parse below is
 *  unambiguous. */
function completionLegacyId(slug: string, itemId: string): string {
  return `${LEGACY_ID_PREFIX}${slug}:${itemId}`;
}

/** Decode a legacy id back into its (slug, itemId) pair, or null if the
 *  string didn't originate from this module. Used by the sweep step. */
function parseCompletionLegacyId(legacyId: string): { slug: string; itemId: string } | null {
  if (!legacyId.startsWith(LEGACY_ID_PREFIX)) return null;
  const body = legacyId.slice(LEGACY_ID_PREFIX.length);
  const colon = body.indexOf(":");
  if (colon < 0) return null;
  return { slug: body.slice(0, colon), itemId: body.slice(colon + 1) };
}

/** The human-readable label shown in a completion notification's
 *  title. Uses the schema's `displayField` value when declared and
 *  non-empty; otherwise falls back to the record's primaryKey
 *  (`itemId`), preserving the historical `{title}: {id}` shape. */
export function resolveDisplayLabel(schema: CollectionSchema, item: CollectionItem, itemId: string): string {
  const { displayField } = schema;
  if (!displayField) return itemId;
  const raw = item[displayField];
  if (raw === undefined || raw === null) return itemId;
  const label = String(raw).trim();
  return label.length > 0 ? label : itemId;
}

/** True iff the schema declares completion tracking AND the item's
 *  `completionField` value (stringified) is in `completionDoneValues`.
 *  Returns false when tracking is disabled. */
export function itemIsDone(schema: CollectionSchema, item: CollectionItem): boolean {
  const { completionField, completionDoneValues } = schema;
  if (!completionField || !completionDoneValues) return false;
  const raw = item[completionField];
  if (raw === undefined || raw === null) return false;
  return completionDoneValues.includes(String(raw));
}

/** Every active bell entry whose legacy id matches this (slug, itemId).
 *  Returns multiple ids when defensive cleanup is needed — a race in
 *  rapid-fire fs.watch events (now closed by single-flighting in
 *  watcher.ts + awaiting publish below) historically produced
 *  duplicate entries, and the clear path needs to drain them all.
 *  Scans `listAll()` — cheap because the active set is bounded. */
async function findActiveEntryIds(slug: string, itemId: string): Promise<string[]> {
  const legacyId = completionLegacyId(slug, itemId);
  const entries = await listAll();
  return entries.filter((entry) => isLegacyNotifierPluginData(entry.pluginData) && entry.pluginData.legacyId === legacyId).map((entry) => entry.id);
}

/** Per-legacyId in-flight lock. Serializes concurrent
 *  `ensureItemNotification` calls for the same (slug, itemId) so the
 *  `findActiveEntryIds → publish` check stays atomic across callers
 *  — not just across watcher events.
 *
 *  Why this matters: the watcher's `scheduleItemReconcile` single-
 *  flights events from `fs.watch`, but reconciles can ALSO reach
 *  `ensureItemNotification` from `reconcileAllItems` (boot + schema-
 *  change). On macOS, `readdir` on a watched dir can itself fire an
 *  fs.watch event, so a reconcileAllItems pass can race a watcher
 *  event for the SAME item. Without this lock, both code paths read
 *  `listAll` (which bypasses the engine's write queue), miss each
 *  other's in-flight publish, and produce duplicate entries.
 *
 *  The map's value is a tiny wrapper rather than a bare Promise so
 *  that the "is this still my lock?" check below is an object-
 *  identity comparison, not a promise-identity comparison — clearer
 *  for both humans and static analyzers reading the cleanup path. */
interface EnsureLock {
  promise: Promise<void>;
}
const ensureLocks = new Map<string, EnsureLock>();

/** Idempotently ensure a bell entry exists for a still-pending item.
 *  No-op if an entry with this (slug, itemId)'s legacy id is already
 *  active.
 *
 *  Awaits the engine's `publish` directly (rather than going through
 *  the fire-and-forget `publishNotification` wrapper) so the next
 *  `findActiveEntryIds` call on the same key sees the committed
 *  entry. The wrapper enqueues and returns immediately, which let
 *  a concurrent reconcile read stale state and publish a duplicate
 *  — see the rapid-fire fs.watch race that motivated this rewrite.
 *
 *  The `pluginData` shape matches what the wrapper would have built
 *  (`LegacyNotifierPluginData`), so the bell preserves icon / dedup
 *  semantics and `findActiveEntryIds` keeps working. */
async function ensureItemNotification(slug: string, schema: CollectionSchema, itemId: string, displayLabel: string): Promise<void> {
  const legacyId = completionLegacyId(slug, itemId);
  // Drain any in-flight publish for this key BEFORE our check + set.
  // The drain + claim runs synchronously between the loop's
  // `ensureLocks.get` and `ensureLocks.set` calls below, so two
  // callers can't both observe an empty slot and both claim it.
  while (true) {
    const inflight = ensureLocks.get(legacyId);
    if (!inflight) break;
    await inflight.promise;
  }
  const lock: EnsureLock = { promise: doEnsureItemNotification(slug, schema, itemId, legacyId, displayLabel) };
  ensureLocks.set(legacyId, lock);
  try {
    await lock.promise;
  } finally {
    // Only clear the slot if it still points at OUR lock — a
    // sufficiently-delayed cleanup must not stomp a later claim.
    if (ensureLocks.get(legacyId) === lock) {
      ensureLocks.delete(legacyId);
    }
  }
}

async function doEnsureItemNotification(slug: string, schema: CollectionSchema, itemId: string, legacyId: string, displayLabel: string): Promise<void> {
  try {
    const existing = await findActiveEntryIds(slug, itemId);
    if (existing.length > 0) return;
    const action: NotificationAction = {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.collections, slug, itemId },
    };
    const pluginData: LegacyNotifierPluginData = {
      legacy: true,
      legacyId,
      kind: NOTIFICATION_KINDS.todo,
      priority: NOTIFICATION_PRIORITIES.normal,
      action,
    };
    // `lifecycle: "action"` — these are state-of-the-world entries
    // mirroring an outstanding obligation (the item is pending), not
    // transient pings. The bell surfaces action entries more
    // prominently and they stay until the obligation resolves, which
    // is exactly the contract our reconciler enforces. Validation
    // requires a non-info severity (we use "nudge") and a non-empty
    // `navigateTarget` (the slug + itemId deep-link below satisfies it).
    await notifierPublish({
      pluginPkg: legacyKindToPluginPkg(NOTIFICATION_KINDS.todo),
      severity: legacyPriorityToSeverity(NOTIFICATION_PRIORITIES.normal),
      lifecycle: "action",
      title: `${schema.title}: ${displayLabel}`,
      navigateTarget: legacyActionToNavigateTarget(action),
      pluginData,
    });
  } catch (err) {
    log.warn("collections", "notify ensure failed", { slug, itemId, error: errorMessage(err) });
  }
}

/** Idempotently clear EVERY bell entry that matches this
 *  (slug, itemId). Silent no-op when nothing matches. The "every" is
 *  defensive: with the single-flighting + awaited publish in place,
 *  duplicates shouldn't appear, but if one ever slips through this
 *  call drains the lot rather than leaving a stuck entry. */
export async function clearItemNotification(slug: string, itemId: string): Promise<void> {
  try {
    const ids = await findActiveEntryIds(slug, itemId);
    for (const entryId of ids) {
      await notifierClear(entryId);
    }
  } catch (err) {
    log.warn("collections", "notify clear failed", { slug, itemId, error: errorMessage(err) });
  }
}

/** Reconcile one item to the desired bell state. Re-reads the record
 *  from disk so the decision is grounded in current truth, not in the
 *  event payload. Safe to call when the file is missing (delete path)
 *  — `readItem` returns null and we clear.
 *
 *  `ioOpts` flows into `readItem`'s workspace-containment check —
 *  production callers (the watcher) pass nothing and rely on the live
 *  `workspacePath`; tests pass `{ workspaceRoot: <tmpdir> }` so the
 *  containment check accepts a fixture dataDir outside the real
 *  workspace. */
export async function reconcileItem(slug: string, schema: CollectionSchema, dataDir: string, itemId: string, ioOpts: IoOptions = {}): Promise<void> {
  if (!schema.completionField) {
    // Schema doesn't track completion — make sure no stale entry sticks
    // around from a previous schema state.
    await clearItemNotification(slug, itemId);
    return;
  }
  const item = await readItem(dataDir, itemId, ioOpts);
  if (item === null) {
    await clearItemNotification(slug, itemId);
    return;
  }
  if (itemIsDone(schema, item)) {
    await clearItemNotification(slug, itemId);
    return;
  }
  await ensureItemNotification(slug, schema, itemId, resolveDisplayLabel(schema, item, itemId));
}

/** Boot-time reconcile: walk every record under `dataDir` once and
 *  reconcile it. Catches up changes that happened while the server was
 *  down — items added (need to publish), items marked done (need to
 *  clear), items deleted (covered by `sweepStaleActiveEntries` below,
 *  not this function — this only sees files that exist).
 *
 *  See `reconcileItem` for the `ioOpts` test-seam rationale. */
export async function reconcileAllItems(slug: string, schema: CollectionSchema, dataDir: string, ioOpts: IoOptions = {}): Promise<void> {
  if (!schema.completionField) return;
  let items: CollectionItem[];
  try {
    items = await listItems(dataDir, ioOpts);
  } catch (err) {
    log.warn("collections", "reconcile list failed", { slug, dataDir, error: errorMessage(err) });
    return;
  }
  const { primaryKey } = schema;
  for (const item of items) {
    const raw = item[primaryKey];
    if (typeof raw !== "string" || raw.length === 0) continue;
    await reconcileItem(slug, schema, dataDir, raw, ioOpts);
  }
}

/** Boot-time sweep over the active bell: drop any entries whose
 *  underlying file is gone, whose collection was deleted, whose schema
 *  no longer tracks completion, or whose item is now done. Required to
 *  reverse-cover the cases `reconcileAllItems` misses (it only walks
 *  files that exist on disk; a bell entry whose file vanished would be
 *  invisible to it).
 *
 *  Accepts `DiscoveryOptions` so tests can point at a tmpdir workspace
 *  without touching `~/mulmoclaude/`. Production callers pass nothing
 *  and get the live workspace defaults. */
export async function sweepStaleActiveEntries(opts: DiscoveryOptions = {}): Promise<void> {
  let entries;
  try {
    entries = await listAll();
  } catch (err) {
    log.warn("collections", "sweep list failed", { error: errorMessage(err) });
    return;
  }
  for (const entry of entries) {
    if (!isLegacyNotifierPluginData(entry.pluginData)) continue;
    const parsed = parseCompletionLegacyId(entry.pluginData.legacyId);
    if (!parsed) continue;
    const { slug, itemId } = parsed;
    try {
      const collection = await loadCollection(slug, opts);
      if (!collection || !collection.schema.completionField) {
        await notifierClear(entry.id);
        continue;
      }
      const item = await readItem(collection.dataDir, itemId, opts);
      if (item === null || itemIsDone(collection.schema, item)) {
        await notifierClear(entry.id);
      }
    } catch (err) {
      log.warn("collections", "sweep entry failed", { slug, itemId, error: errorMessage(err) });
    }
  }
}
