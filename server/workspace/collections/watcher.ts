// Filesystem watchers that drive collection-completion bell
// notifications. One `fs.watch` per discovered collection's `dataDir`,
// fanned out from a single boot call + a 30-second re-discovery
// interval that catches newly-created / deleted collections (there is
// no in-process "collections changed" event broadcast).
//
// Why a watcher, not just route hooks: the canonical pattern for
// collection-skills (see `helps/collection-skills.md`) has the agent
// Write records directly with the Write tool — that path never hits
// the REST API, so a route-level hook would miss most of the traffic
// the user actually generates. The watcher catches every mutation
// regardless of who wrote the file.
//
// All decisions live in `notifications.ts`; this module is pure
// plumbing: discover, mkdir, fs.watch, debounce-not-yet, forward
// events into the reconciler. Every reconcile call is idempotent so
// fs.watch's well-known quirks (`rename` vs `change`, atomic-write
// coalescence, filename === null on some platforms) don't need
// special handling — re-deriving state from the file on every event
// is the contract.

import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { discoverCollections, loadCollection } from "./discovery.js";
import { reconcileAllItems, reconcileItem, sweepStaleActiveEntries } from "./notifications.js";

// Collections don't get added / removed rapidly; 30 s is a comfortable
// upper bound on how long a new schema can sit before its watcher is
// up. Cheap to run — `discoverCollections` reads a handful of
// `schema.json` files per scope.
const REDISCOVERY_INTERVAL_MS = 30 * ONE_SECOND_MS;

interface CollectionWatcher {
  slug: string;
  dataDir: string;
  watcher: FSWatcher;
}

const watchers = new Map<string, CollectionWatcher>();
let rediscoveryTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Boot entry point: sweep stale active entries, then mount watchers
 *  for every discovered collection and arm the periodic re-discovery
 *  poll. Idempotent — a second call is a no-op so test harnesses and
 *  re-init paths can call it freely. */
export async function startCollectionWatchers(): Promise<void> {
  if (started) return;
  started = true;
  // Boot reconcile is split in two: sweep first (drop bell entries
  // whose files / collections / schemas vanished while the server was
  // down), then `syncWatchers` runs the per-collection forward fill
  // (publish for items added during downtime). Order matters only
  // weakly — sweep's clears can race the forward fill's publishes,
  // but both paths are idempotent and converge on the same end state.
  await sweepStaleActiveEntries();
  await syncWatchers();
  rediscoveryTimer = setInterval(() => {
    syncWatchers().catch((err: unknown) => {
      log.warn("collections", "watcher rediscovery failed", { error: errorMessage(err) });
    });
  }, REDISCOVERY_INTERVAL_MS);
  // `unref` on the timer so a clean process exit isn't blocked
  // waiting for the next tick.
  rediscoveryTimer.unref();
}

/** Tear down every watcher and stop the rediscovery interval. Used by
 *  tests; production never calls this (process exit reclaims the fds).
 *  Resets `started` so a subsequent `startCollectionWatchers` re-mounts. */
export async function stopCollectionWatchers(): Promise<void> {
  if (rediscoveryTimer) {
    clearInterval(rediscoveryTimer);
    rediscoveryTimer = null;
  }
  for (const watcher of watchers.values()) {
    try {
      watcher.watcher.close();
    } catch {
      /* fs.watch close is best-effort */
    }
  }
  watchers.clear();
  started = false;
}

/** Reconcile the watcher set against the currently-discovered
 *  collections. Adds watchers for newly-appeared slugs (including a
 *  boot reconcile of their existing items), drops watchers for slugs
 *  that no longer exist. Called once on start + every
 *  `REDISCOVERY_INTERVAL_MS`. */
async function syncWatchers(): Promise<void> {
  let collections;
  try {
    collections = await discoverCollections();
  } catch (err) {
    log.warn("collections", "watcher discover failed", { error: errorMessage(err) });
    return;
  }
  const liveSlugs = new Set(collections.map((collection) => collection.slug));
  // Stop watchers for vanished collections — their bell entries get
  // dropped on the next sweep, but the immediate concern here is to
  // free the fd and stop forwarding events for a dead slug.
  for (const slug of [...watchers.keys()]) {
    if (liveSlugs.has(slug)) continue;
    const watcher = watchers.get(slug);
    if (watcher) {
      try {
        watcher.watcher.close();
      } catch {
        /* best-effort */
      }
    }
    watchers.delete(slug);
    log.info("collections", "watcher stopped", { slug });
  }
  // Start watchers for newly-appeared collections.
  for (const collection of collections) {
    if (watchers.has(collection.slug)) continue;
    await startWatcherFor(collection.slug, collection.schema, collection.dataDir);
  }
}

async function startWatcherFor(slug: string, schema: import("./types.js").CollectionSchema, dataDir: string): Promise<void> {
  try {
    // `fs.watch` throws on a missing dir, so ensure it exists. New
    // collections legitimately start with no records — mkdir is the
    // canonical first-use bootstrap.
    await mkdir(dataDir, { recursive: true });
    // Boot reconcile this collection's existing items BEFORE mounting
    // the watcher: a pending item the user added during downtime
    // needs to get its bell entry even if no event fires today.
    await reconcileAllItems(slug, schema, dataDir);
    const watcher = watch(dataDir, { persistent: false }, (_eventType, filename) => {
      // Errors from inside the callback would propagate as unhandled
      // rejections — wrap so a single bad event can't unwind the
      // watcher.
      onEvent(slug, filename).catch((err: unknown) => {
        log.warn("collections", "watcher event failed", { slug, filename, error: errorMessage(err) });
      });
    });
    watcher.on("error", (err) => {
      log.warn("collections", "watcher error", { slug, error: errorMessage(err) });
    });
    watchers.set(slug, { slug, dataDir, watcher });
    log.info("collections", "watcher started", { slug, dataDir });
  } catch (err) {
    log.warn("collections", "watcher start failed", { slug, error: errorMessage(err) });
  }
}

/** Per-key single-flight slot. While a reconcile is in flight for a
 *  given (slug, itemId), additional events on the same key set
 *  `pending = true` and return — the running reconcile re-runs once
 *  after it completes, capturing any state change that happened during
 *  execution. This collapses fs.watch's well-known rapid-fire bursts
 *  (atomic rename surfaces as 2-3 events on most platforms) into a
 *  single reconcile + one trailing re-run, preventing concurrent
 *  reads of `active.json` from racing the engine's write queue and
 *  producing duplicate publishes. */
interface ReconcileSlot {
  running: Promise<void>;
  pending: boolean;
}
const itemSlots = new Map<string, ReconcileSlot>();

function scheduleItemReconcile(slug: string, schema: import("./types.js").CollectionSchema, dataDir: string, itemId: string): Promise<void> {
  const key = `${slug}\x00${itemId}`;
  const existing = itemSlots.get(key);
  if (existing) {
    existing.pending = true;
    return existing.running;
  }
  const slot: ReconcileSlot = { running: Promise.resolve(), pending: false };
  slot.running = (async () => {
    try {
      // Re-run while events keep arriving — the trailing re-run
      // captures any state change that landed during a prior pass.
      // After each pass we read `pending` and zero it before the next
      // iteration, so an event that fires *during* the last
      // reconcile's await still triggers one more pass before the
      // slot is freed. Loop guarded by the `if (!slot.pending) break`
      // check so the lint rule's `while(true)` ban doesn't trip.
      let keepGoing = true;
      while (keepGoing) {
        slot.pending = false;
        await reconcileItem(slug, schema, dataDir, itemId);
        keepGoing = slot.pending;
      }
    } finally {
      itemSlots.delete(key);
    }
  })();
  itemSlots.set(key, slot);
  return slot.running;
}

/** Handle a single fs.watch event. Re-loads the collection (schema may
 *  have changed since startup), filters out non-record files, and
 *  forwards to the single-flighted reconciler. `filename === null`
 *  (rare, platform-specific) triggers a full directory rescan to be
 *  safe. */
async function onEvent(slug: string, filename: string | Buffer | null): Promise<void> {
  const collection = await loadCollection(slug);
  if (!collection) return;
  if (filename === null) {
    await reconcileAllItems(slug, collection.schema, collection.dataDir);
    return;
  }
  const name = typeof filename === "string" ? filename : filename.toString("utf-8");
  // Filter: only record files (`*.json`), skip dot-prefixed (atomic
  // writes / OS metadata / editor swap files). The reconciler is
  // idempotent so a stray non-record event would be harmless, but
  // skipping early avoids needless I/O.
  if (!name.endsWith(".json") || name.startsWith(".")) return;
  const itemId = name.slice(0, -".json".length);
  await scheduleItemReconcile(slug, collection.schema, collection.dataDir, itemId);
}
