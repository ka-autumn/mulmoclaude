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
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../utils/time.js";
import { discoverCollections, loadCollection, type DiscoveryOptions, type LoadedCollection } from "./discovery.js";
import { reconcileAllItems, reconcileItem, sweepStaleActiveEntries } from "./notifications.js";
import type { CollectionSchema } from "./types.js";

// Collections don't get added / removed rapidly; 30 s is a comfortable
// upper bound on how long a new schema can sit before its watcher is
// up. Cheap to run — `discoverCollections` reads a handful of
// `schema.json` files per scope.
const REDISCOVERY_INTERVAL_MS = 30 * ONE_SECOND_MS;

// Wall-clock tick that re-reconciles time-dependent collections (those
// declaring `triggerField` and/or `spawn`). The fs.watcher only re-runs
// the reconciler on FILE changes; a `triggerField` bell that should fire
// "when the clock reaches date X" — and a `spawn` whose successor's own
// trigger later comes due — change no file at that moment, so a periodic
// re-derivation is required. 1 minute is fine: the reconciler is
// idempotent and only reads a bounded set of small JSON files.
const TRIGGER_TICK_INTERVAL_MS = ONE_MINUTE_MS;

interface CollectionWatcher {
  slug: string;
  dataDir: string;
  watcher: FSWatcher;
  /** Last-seen serialized schema for change detection. When a
   *  rediscovery tick observes a different value, the watcher's items
   *  are reconciled and the cache is refreshed — this catches
   *  schema-only edits (e.g. flipping `completionField` on or off)
   *  that don't touch any record file and would otherwise leave bell
   *  state stale indefinitely. */
  schemaJson: string;
}

const watchers = new Map<string, CollectionWatcher>();
let rediscoveryTimer: ReturnType<typeof setInterval> | null = null;
let triggerTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
/** Discovery options threaded into every `discoverCollections` /
 *  `loadCollection` / `sweepStaleActiveEntries` call this module
 *  makes. Production: empty (live workspace). Tests:
 *  `{ workspaceRoot, userSkillsDir }` pointing at a `mkdtempSync`
 *  tree. Stored at module level so per-event handlers can read it
 *  without threading through every signature. */
let discoveryOpts: DiscoveryOptions = {};

/** Per-key single-flight slot. Declared here (before
 *  `stopCollectionWatchers`, which needs to clear it during teardown)
 *  rather than next to `scheduleItemReconcile` below; the consumer is
 *  documented at that call site. */
interface ReconcileSlot {
  running: Promise<void>;
  pending: boolean;
}
const itemSlots = new Map<string, ReconcileSlot>();

/** Test-only configuration knobs. Production callers pass nothing and
 *  get the live workspace defaults; tests pass a tmpdir-rooted
 *  `discoveryOpts` so the watcher reads schemas from the test fixture,
 *  and override `rediscoveryIntervalMs` (or set it to `null` to
 *  disable the auto-tick entirely so the test drives sync manually). */
export interface CollectionWatcherOptions {
  discoveryOpts?: DiscoveryOptions;
  rediscoveryIntervalMs?: number | null;
  /** Wall-clock tick cadence for time-dependent collections
   *  (`triggerField` / `spawn`). `null` disables the tick so a test can
   *  drive `_tickTimeTriggersForTesting` manually. Default 1 minute. */
  triggerTickIntervalMs?: number | null;
}

/** Boot entry point: sweep stale active entries, then mount watchers
 *  for every discovered collection and arm the periodic re-discovery
 *  poll. Idempotent — a second call is a no-op so test harnesses and
 *  re-init paths can call it freely. */
export async function startCollectionWatchers(opts: CollectionWatcherOptions = {}): Promise<void> {
  if (started) return;
  // `started` only flips on AFTER boot finishes. If sweep or
  // syncWatchers throws mid-boot, an earlier latch-then-await pattern
  // would leave the flag stuck at `true`, permanently disabling
  // subsequent boot attempts until process restart. Reset state on
  // failure so a supervisor / test harness can retry.
  discoveryOpts = opts.discoveryOpts ?? {};
  try {
    // Boot reconcile is split in two: sweep first (drop bell entries
    // whose files / collections / schemas vanished while the server
    // was down), then `syncWatchers` runs the per-collection forward
    // fill (publish for items added during downtime). Order matters
    // only weakly — sweep's clears can race the forward fill's
    // publishes, but both paths are idempotent and converge on the
    // same end state.
    await sweepStaleActiveEntries(discoveryOpts);
    await syncWatchers();
    const intervalMs = opts.rediscoveryIntervalMs === undefined ? REDISCOVERY_INTERVAL_MS : opts.rediscoveryIntervalMs;
    if (intervalMs !== null) {
      rediscoveryTimer = setInterval(() => {
        syncWatchers().catch((err: unknown) => {
          log.warn("collections", "watcher rediscovery failed", { error: errorMessage(err) });
        });
      }, intervalMs);
      // `unref` on the timer so a clean process exit isn't blocked
      // waiting for the next tick.
      rediscoveryTimer.unref();
    }
    const triggerMs = opts.triggerTickIntervalMs === undefined ? TRIGGER_TICK_INTERVAL_MS : opts.triggerTickIntervalMs;
    if (triggerMs !== null) {
      triggerTimer = setInterval(() => {
        tickTimeTriggers().catch((err: unknown) => {
          log.warn("collections", "watcher trigger tick failed", { error: errorMessage(err) });
        });
      }, triggerMs);
      triggerTimer.unref();
    }
    started = true;
  } catch (err) {
    discoveryOpts = {};
    throw err;
  }
}

/** Tear down every watcher and stop the rediscovery interval. Used by
 *  tests; production never calls this (process exit reclaims the fds).
 *  Resets `started` so a subsequent `startCollectionWatchers` re-mounts. */
export async function stopCollectionWatchers(): Promise<void> {
  if (rediscoveryTimer) {
    clearInterval(rediscoveryTimer);
    rediscoveryTimer = null;
  }
  if (triggerTimer) {
    clearInterval(triggerTimer);
    triggerTimer = null;
  }
  for (const watcher of watchers.values()) {
    try {
      watcher.watcher.close();
    } catch {
      /* fs.watch close is best-effort */
    }
  }
  watchers.clear();
  itemSlots.clear();
  discoveryOpts = {};
  started = false;
}

/** Test-only: manually trigger one rediscovery + reconcile pass. Lets
 *  tests drive the syncWatchers flow synchronously instead of waiting
 *  for the auto-tick (which they disable via
 *  `rediscoveryIntervalMs: null` in `startCollectionWatchers`). */
export async function _syncWatchersForTesting(): Promise<void> {
  await syncWatchers();
}

/** Test-only: drive one wall-clock tick synchronously, with an optional
 *  injected clock (tests disable the auto-tick via
 *  `triggerTickIntervalMs: null` and call this with a fixed `now`). */
export async function _tickTimeTriggersForTesting(now?: Date): Promise<void> {
  await tickTimeTriggers(now);
}

/** Re-reconcile every watched collection that depends on the clock —
 *  i.e. declares `triggerField` (a bell that fires at a date) and/or
 *  `spawn` (recurrence whose successors come due over time). Collections
 *  with neither are skipped: their bell state changes only on file
 *  events, which the fs.watcher already covers, so a periodic
 *  re-reconcile would be pure waste. Idempotent, so a tick that races a
 *  file event simply converges. The schema is parsed back from the
 *  watcher's cached `schemaJson` to avoid a per-tick disk read. */
async function tickTimeTriggers(now: Date = new Date()): Promise<void> {
  for (const entry of watchers.values()) {
    let schema: CollectionSchema;
    try {
      schema = JSON.parse(entry.schemaJson) as CollectionSchema;
    } catch (err) {
      log.warn("collections", "trigger tick: bad cached schema", { slug: entry.slug, error: errorMessage(err) });
      continue;
    }
    if (!schema.triggerField && !schema.spawn) continue;
    await reconcileAllItems(entry.slug, schema, entry.dataDir, discoveryOpts, now);
  }
}

/** Reconcile the watcher set against the currently-discovered
 *  collections. Adds watchers for newly-appeared slugs (including a
 *  boot reconcile of their existing items), drops watchers for slugs
 *  that no longer exist, and re-reconciles items for collections
 *  whose schema changed since the last tick. Called once on start +
 *  every `REDISCOVERY_INTERVAL_MS`.
 *
 *  When the watcher set or any schema changed in this tick, runs
 *  `sweepStaleActiveEntries()` at the end to drop bell entries that
 *  no longer have a backing collection / schema / file. Without this
 *  sweep, a collection deleted at runtime would leak its entries
 *  until process restart, and a schema with `completionField` flipped
 *  off would keep its old entries indefinitely — both cases the boot
 *  sweep alone wouldn't catch. */
async function syncWatchers(): Promise<void> {
  let collections;
  try {
    collections = await discoverCollections(discoveryOpts);
  } catch (err) {
    log.warn("collections", "watcher discover failed", { error: errorMessage(err) });
    return;
  }
  const liveSlugs = new Set(collections.map((collection) => collection.slug));
  // The three passes below are split into helpers so this function
  // stays under the `sonarjs/cognitive-complexity` threshold; each
  // returns a boolean for whether it mutated state, OR-ed into a
  // single `mutated` flag that gates the end-of-tick sweep.
  const vanishedMutated = stopVanishedWatchers(liveSlugs);
  const schemaMutated = await reconcileChangedSchemas(collections);
  const addedMutated = await startNewWatchers(collections);
  // Final sweep — catches anything the per-watcher paths above
  // couldn't reach (vanished slugs' entries, removed-completionField
  // entries). Bounded by the active set size; only runs when this
  // tick actually changed something.
  if (vanishedMutated || schemaMutated || addedMutated) {
    await sweepStaleActiveEntries(discoveryOpts);
  }
}

function stopVanishedWatchers(liveSlugs: Set<string>): boolean {
  let mutated = false;
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
    mutated = true;
    log.info("collections", "watcher stopped", { slug });
  }
  return mutated;
}

/** Re-reconcile already-watched collections whose schema changed
 *  since the last tick. New collections fall through to
 *  `startNewWatchers` (whose start path calls `reconcileAllItems`
 *  internally), so this pass only handles already-watched slugs. */
async function reconcileChangedSchemas(collections: readonly LoadedCollection[]): Promise<boolean> {
  let mutated = false;
  for (const collection of collections) {
    const existing = watchers.get(collection.slug);
    if (!existing) continue;
    const nextJson = JSON.stringify(collection.schema);
    if (existing.schemaJson === nextJson) continue;
    existing.schemaJson = nextJson;
    log.info("collections", "watcher schema changed, re-reconciling", { slug: collection.slug });
    await reconcileAllItems(collection.slug, collection.schema, collection.dataDir, discoveryOpts);
    mutated = true;
  }
  return mutated;
}

async function startNewWatchers(collections: readonly LoadedCollection[]): Promise<boolean> {
  let mutated = false;
  for (const collection of collections) {
    if (watchers.has(collection.slug)) continue;
    await startWatcherFor(collection.slug, collection.schema, collection.dataDir);
    mutated = true;
  }
  return mutated;
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
    await reconcileAllItems(slug, schema, dataDir, discoveryOpts);
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
    watchers.set(slug, { slug, dataDir, watcher, schemaJson: JSON.stringify(schema) });
    log.info("collections", "watcher started", { slug, dataDir });
  } catch (err) {
    log.warn("collections", "watcher start failed", { slug, error: errorMessage(err) });
  }
}

/** Test-only: the per-key single-flight scheduler. Exported via the
 *  `_` prefix so test code can drive rapid-fire calls directly and
 *  observe the trailing coalesce — `fs.watch` event timing is too
 *  flaky to assert against.
 *
 *  Single-flight semantics: while a reconcile is in flight for a
 *  given (slug, itemId), additional events on the same key set
 *  `pending = true` and return — the running reconcile re-runs once
 *  after it completes, capturing any state change that happened during
 *  execution. This collapses fs.watch's well-known rapid-fire bursts
 *  (atomic rename surfaces as 2-3 events on most platforms) into a
 *  single reconcile + one trailing re-run, preventing concurrent
 *  reads of `active.json` from racing the engine's write queue and
 *  producing duplicate publishes. */
export function _scheduleItemReconcileForTesting(slug: string, schema: import("./types.js").CollectionSchema, dataDir: string, itemId: string): Promise<void> {
  return scheduleItemReconcile(slug, schema, dataDir, itemId);
}

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
        await reconcileItem(slug, schema, dataDir, itemId, discoveryOpts);
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
  const collection = await loadCollection(slug, discoveryOpts);
  if (!collection) return;
  if (filename === null) {
    // Some platforms (older Linux kernels, certain network mounts)
    // omit the filename on a watch event — we don't know which record
    // changed. `reconcileAllItems` covers items whose file still
    // exists; pair it with a sweep so any record deleted inside the
    // same opaque event has its stale bell entry cleared too. Without
    // the sweep, a delete that fires with filename === null would
    // persist as a phantom entry until the next rediscovery tick.
    await reconcileAllItems(slug, collection.schema, collection.dataDir, discoveryOpts);
    await sweepStaleActiveEntries(discoveryOpts);
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
