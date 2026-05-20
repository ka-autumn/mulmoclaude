// Notifier engine — single-process, two-file (active + history),
// single-channel.
//
// API surface: publish / clear / cancel / get / listFor / listAll /
// listHistory. Mutations queue through a writing-flag + waiter-queue
// coordinator so concurrent callers can't race on `writeFileAtomic`'s
// rename. Reads bypass the queue (rename atomicity makes half-reads
// impossible) and trade strict linearisability for simpler code: the
// contract is "after `await publish(x)` resolves, subsequent reads
// see x" — which holds because `publish` awaits the persist before
// returning.
//
// `clear` / `cancel` push to history *before* removing from active.
// History persistence is best-effort: if it fails, the active write
// still wins and the failure is logged. Active is the source of
// truth; history is an audit aid.

import { randomUUID } from "crypto";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { loadActive, loadHistory, saveActive, saveHistory } from "./store.js";
import {
  HISTORY_CAP,
  type NotifierEntry,
  type NotifierEvent,
  type NotifierFile,
  type NotifierHistoryEntry,
  type NotifierSeverity,
  type PublishInput,
} from "./types.js";

// ── Dependency injection (matches server/events/notifications.ts) ──

export interface NotifierDeps {
  publish: (channel: string, payload: unknown) => void;
}

let deps: NotifierDeps | null = null;

export function initNotifier(injected: NotifierDeps): void {
  deps = injected;
}

/** In-process event listeners — separate from the socket.io pubsub
 *  so server-side adapters (bridge / macOS push, future Encore) can
 *  react to state changes without going through a websocket
 *  round-trip. The host's `IPubSub.publish` is fan-out-only with no
 *  server-side subscribe, so this listener registry is the
 *  in-process equivalent. Registered listeners run synchronously
 *  inside `emit`, before the pubsub fan-out. */
type NotifierEventListener = (event: NotifierEvent) => void;
const listeners: NotifierEventListener[] = [];

/** Register an in-process listener for engine events. Returns an
 *  unsubscribe function the caller can use during teardown. */
export function onEvent(listener: NotifierEventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function emit(event: NotifierEvent): void {
  // In-process fan-out first. Each listener is wrapped: a throwing
  // listener must not poison the rest, and must not propagate out of
  // `processBatch` and strand the still-unsettled waiters (their
  // resolve/reject is called *after* this emit loop). Fan-out is
  // best-effort by contract — losing one subscriber must not lose
  // the write that already committed.
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      log.error("notifier", "in-process listener failed", { type: event.type, error: String(err) });
    }
  }
  if (!deps) {
    log.warn("notifier", "emit before init", { type: event.type });
    return;
  }
  try {
    deps.publish(PUBSUB_CHANNELS.notifier, event);
  } catch (err) {
    log.error("notifier", "emit failed", { type: event.type, error: String(err) });
  }
}

// ── Input validation ──────────────────────────────────────────────
//
// Shared by `engine.publish` (throws on error) and the HTTP route
// (returns 400 on error). Single source of truth so plugin-runtime
// callers and HTTP callers can't drift.

/** Hard caps on publish-input fields. The engine reads each entry on
 *  every list/get call (no in-memory cache), so unbounded fields hurt
 *  every reader. Caps chosen to be generous for legitimate UX copy
 *  while bounding active.json growth: a notification fundamentally is
 *  a short blurb, not a document. */
export const NOTIFIER_LIMITS = {
  titleMax: 200,
  bodyMax: 4000,
  navigateTargetMax: 1000,
  pluginDataMaxBytes: 16 * 1024,
} as const;

function validateTitle(title: string): string | null {
  if (typeof title !== "string" || title.length === 0) return "title must be a non-empty string";
  if (title.length > NOTIFIER_LIMITS.titleMax) return `title exceeds max length of ${NOTIFIER_LIMITS.titleMax} chars`;
  return null;
}

function validateBody(body: string | undefined): string | null {
  if (body === undefined) return null;
  if (body.length > NOTIFIER_LIMITS.bodyMax) return `body exceeds max length of ${NOTIFIER_LIMITS.bodyMax} chars`;
  return null;
}

function validateNavigateTarget(target: string | undefined): string | null {
  if (target === undefined) return null;
  if (target.length === 0) return "navigateTarget must be a non-empty relative path when set";
  if (target.length > NOTIFIER_LIMITS.navigateTargetMax) {
    return `navigateTarget exceeds max length of ${NOTIFIER_LIMITS.navigateTargetMax} chars`;
  }
  // Must be a same-origin relative path. Reject schemes
  // (`javascript:`, `https://...`) and scheme-relative URLs
  // (`//evil.com/...`, which an `<a href>` would resolve to the
  // attacker's origin). One leading "/" only.
  if (!target.startsWith("/") || target.startsWith("//")) {
    return "navigateTarget must be a relative path beginning with a single '/' (no scheme, no '//')";
  }
  return null;
}

function validatePluginData(pluginData: unknown): string | null {
  if (pluginData === undefined) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(pluginData);
  } catch (err) {
    return `pluginData is not JSON-serialisable: ${String(err)}`;
  }
  // `JSON.stringify` returns `undefined` for non-serialisable roots
  // (e.g. a bare function or symbol). Treat that as a serialisation
  // failure so it doesn't slip through as an empty-string size.
  if (typeof serialized !== "string") return "pluginData is not JSON-serialisable";
  if (serialized.length > NOTIFIER_LIMITS.pluginDataMaxBytes) {
    return `pluginData JSON exceeds ${NOTIFIER_LIMITS.pluginDataMaxBytes} bytes`;
  }
  return null;
}

function validateActionCoherence(input: PublishInput): string | null {
  if (input.lifecycle !== "action") return null;
  if (input.severity === "info") {
    return "action lifecycle is incompatible with info severity (use fyi for low-priority pings)";
  }
  if (typeof input.navigateTarget !== "string" || input.navigateTarget.length === 0) {
    return "action lifecycle requires a non-empty navigateTarget";
  }
  return null;
}

/** Validate a `PublishInput`. Returns `null` if OK, or a
 *  human-readable error string. Order matters — shape/size errors are
 *  reported before lifecycle/severity coherence errors so the message
 *  the caller sees points at the most fundamental problem first. */
export function validatePublishInput(input: PublishInput): string | null {
  return (
    validateTitle(input.title) ??
    validateBody(input.body) ??
    validateNavigateTarget(input.navigateTarget) ??
    validatePluginData(input.pluginData) ??
    validateActionCoherence(input)
  );
}

// ── Write coordinator ─────────────────────────────────────────────

/** A mutation function applied to the in-memory state object during
 *  drain. Returns either:
 *
 *    - `null` — no state change (e.g., `clear` on an unknown id).
 *      The drainer skips the disk write and the emit if every
 *      mutation in a batch returned `null`.
 *    - `{ event, historyEntry? }` — state changed. The drainer emits
 *      the event after the active write succeeds, and prepends
 *      `historyEntry` to history (best-effort) when present.
 *
 *  Mutations MUST NOT modify state when returning `null`. Violating
 *  this invariant produces a write skip with stale on-disk state. */
type MutationOutcome = { event: NotifierEvent; historyEntry?: NotifierHistoryEntry } | null;
type Mutation = (state: NotifierFile) => MutationOutcome;

interface Waiter {
  mutate: Mutation;
  resolve: () => void;
  reject: (err: unknown) => void;
}

type MutationResult = { ok: true; outcome: MutationOutcome } | { ok: false; error: unknown };

let writing = false;
let waiters: Waiter[] = [];

let activeFilePath: string = WORKSPACE_PATHS.notifierActive;
let historyFilePath: string = WORKSPACE_PATHS.notifierHistory;

/** Test-only: redirect the engine at temp files. Resets the queue too. */
export function _setFilePathsForTesting(paths: { active: string; history: string }): void {
  activeFilePath = paths.active;
  historyFilePath = paths.history;
  writing = false;
  waiters = [];
}

function applyBatchMutations(batch: Waiter[], state: NotifierFile): MutationResult[] {
  return batch.map((waiter) => {
    try {
      return { ok: true, outcome: waiter.mutate(state) };
    } catch (err) {
      return { ok: false, error: err };
    }
  });
}

function collectEvents(results: MutationResult[]): NotifierEvent[] {
  const events: NotifierEvent[] = [];
  for (const result of results) {
    if (result.ok && result.outcome !== null) events.push(result.outcome.event);
  }
  return events;
}

function collectHistoryEntries(results: MutationResult[]): NotifierHistoryEntry[] {
  const entries: NotifierHistoryEntry[] = [];
  for (const result of results) {
    if (result.ok && result.outcome !== null && result.outcome.historyEntry) {
      entries.push(result.outcome.historyEntry);
    }
  }
  return entries;
}

function settleBatch(batch: Waiter[], results: MutationResult[]): void {
  // Resolves come AFTER any emits so subscribers see the event
  // before the caller's `await` returns.
  for (let index = 0; index < batch.length; index += 1) {
    const result = results[index];
    if (result.ok) batch[index].resolve();
    else batch[index].reject(result.error);
  }
}

function rejectBatch(batch: Waiter[], err: unknown): void {
  for (const waiter of batch) waiter.reject(err);
}

async function persistHistory(newEntries: NotifierHistoryEntry[]): Promise<void> {
  const existing = await loadHistory(historyFilePath);
  // Newest-first ordering: a batch contains terminations in arrival
  // order; we want the last one to land at index 0 of history.
  const merged = [...newEntries.slice().reverse(), ...existing.entries].slice(0, HISTORY_CAP);
  await saveHistory(historyFilePath, { entries: merged });
}

async function processBatch(batch: Waiter[]): Promise<void> {
  let state: NotifierFile;
  try {
    state = await loadActive(activeFilePath);
  } catch (err) {
    log.error("notifier", "load failed", { error: String(err) });
    rejectBatch(batch, err);
    return;
  }
  const results = applyBatchMutations(batch, state);
  const events = collectEvents(results);
  const historyEntries = collectHistoryEntries(results);

  if (events.length > 0) {
    try {
      await saveActive(activeFilePath, state);
    } catch (err) {
      log.error("notifier", "active write failed", { error: String(err) });
      rejectBatch(batch, err);
      return;
    }
    if (historyEntries.length > 0) {
      // Best-effort: active is the source of truth, history is an
      // audit aid. A failed history write is logged but doesn't
      // unwind the active commit.
      try {
        await persistHistory(historyEntries);
      } catch (err) {
        log.error("notifier", "history write failed", { error: String(err) });
      }
    }
    for (const event of events) emit(event);
  }
  settleBatch(batch, results);
}

async function drain(): Promise<void> {
  writing = true;
  try {
    while (waiters.length > 0) {
      const batch = waiters;
      waiters = [];
      await processBatch(batch);
    }
  } finally {
    writing = false;
  }
}

function enqueue(mutate: Mutation): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    waiters.push({ mutate, resolve, reject });
    if (!writing) void drain();
  });
}

function removeEntry(state: NotifierFile, entryId: string): NotifierFile["entries"] {
  // The codebase bans dynamic delete; object-rest excludes the key
  // without invoking `delete`.
  const { [entryId]: __removed, ...remaining } = state.entries;
  return remaining;
}

function buildHistoryEntry(entry: NotifierEntry, terminalType: "cleared" | "cancelled"): NotifierHistoryEntry {
  return { ...entry, terminalType, terminalAt: new Date().toISOString() };
}

// ── Public API ────────────────────────────────────────────────────

export async function publish<TPluginData = unknown>(input: PublishInput<TPluginData>): Promise<{ id: string }> {
  // Validate at the engine boundary so plugin-runtime callers and
  // HTTP callers hit the same wall. See `validatePublishInput` above
  // and `feat-notifier-ux.md` for the lifecycle-rule rationale.
  const validationError = validatePublishInput(input as PublishInput);
  if (validationError) {
    throw new Error(`notifier.publish: ${validationError}`);
  }
  const entryId = randomUUID();
  const entry: NotifierEntry<TPluginData> = {
    id: entryId,
    pluginPkg: input.pluginPkg,
    severity: input.severity,
    lifecycle: input.lifecycle,
    title: input.title,
    body: input.body,
    navigateTarget: input.navigateTarget,
    pluginData: input.pluginData,
    createdAt: new Date().toISOString(),
  };
  await enqueue((state) => {
    state.entries[entryId] = entry as NotifierEntry;
    return { event: { type: "published", entry: entry as NotifierEntry } };
  });
  return { id: entryId };
}

export async function clear(entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cleared", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cleared"),
    };
  });
}

export async function cancel(entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cancelled", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cancelled"),
    };
  });
}

/** In-place update for an active entry. Only the fields present on
 *  `patch` are rewritten; `id`, `pluginPkg`, `lifecycle`, and
 *  `createdAt` stay fixed. Emits a single `"updated"` event with
 *  the post-mutation entry — no history record is written because
 *  the entry is still active, just with refreshed content.
 *
 *  This is the missing primitive for "state-of-the-world"
 *  notifications: action-lifecycle entries that mirror an
 *  ongoing obligation whose presentation drifts (e.g. a renamed
 *  todo, an Encore obligation's `displayName` amended). Callers
 *  used to clear-then-publish to refresh, which polluted history
 *  with `cleared` records and assigned new ids — both wrong for a
 *  same-obligation refresh.
 *
 *  No-ops (no throw) when:
 *    - the id is unknown,
 *    - the entry belongs to a different plugin,
 *    - the merged shape would violate `validatePublishInput` (e.g.
 *      action + info severity, empty title, oversized body). The
 *      silent skip matches `clearForPlugin`'s isolation semantics —
 *      the plugin can't distinguish "id never existed" from "id
 *      belongs to another plugin" from "patch would invalidate", so
 *      we never throw across that line. Validation failures are
 *      logged for diagnosis.
 *
 *  Passing only fields you want to change is the contract — omit a
 *  field to leave it alone. There is no "clear this field" affordance
 *  (e.g. removing a body once set); a future caller that needs it
 *  can add an explicit sentinel. */
export async function updateForPlugin<TPluginData = unknown>(
  pluginPkg: string,
  entryId: string,
  patch: {
    severity?: NotifierSeverity;
    title?: string;
    body?: string;
    navigateTarget?: string;
    pluginData?: TPluginData;
  },
): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    if (entry.pluginPkg !== pluginPkg) return null;
    const next: NotifierEntry = {
      ...entry,
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.navigateTarget !== undefined ? { navigateTarget: patch.navigateTarget } : {}),
      ...(patch.pluginData !== undefined ? { pluginData: patch.pluginData } : {}),
    };
    // Re-validate the merged shape so an update can't degrade the
    // entry below publish-time invariants. Mirrors the
    // `validatePublishInput` call in `publish` — same audit, just
    // applied post-merge.
    const validationError = validatePublishInput({
      pluginPkg: next.pluginPkg,
      severity: next.severity,
      title: next.title,
      body: next.body,
      lifecycle: next.lifecycle,
      navigateTarget: next.navigateTarget,
      pluginData: next.pluginData,
    });
    if (validationError) {
      log.warn("notifier", "update rejected by validation", { entryId, pluginPkg, error: validationError });
      return null;
    }
    state.entries[entryId] = next;
    return { event: { type: "updated", entry: next } };
  });
}

/** Plugin-scoped point lookup. Returns the entry by id, but only if
 *  it belongs to the caller's plugin; otherwise undefined. Used by
 *  runtime plugins to detect ghost-bell ids (entry was dismissed
 *  out-of-band via the bell UI or wiped by a crash) so the
 *  reconciler can fall back to a fresh publish instead of
 *  rewriting a ticket as if a silent-no-op update succeeded.
 *
 *  Cross-plugin reads return undefined for isolation — same
 *  property as `clearForPlugin` / `updateForPlugin`. The plugin
 *  can't distinguish "id never existed" from "belongs to another
 *  plugin" from the caller side, which is the intended behaviour. */
export async function getForPlugin(pluginPkg: string, entryId: string): Promise<NotifierEntry | undefined> {
  const state = await loadActive(activeFilePath);
  const entry = state.entries[entryId];
  if (!entry) return undefined;
  if (entry.pluginPkg !== pluginPkg) return undefined;
  return entry;
}

/** Plugin-scoped clear. Same as `clear` but no-ops if the entry's
 *  `pluginPkg` doesn't match the caller's. Used by the per-plugin
 *  `runtime.notifier.clear` so a plugin can't dismiss another
 *  plugin's notification by guessing or scraping its id. The
 *  silent no-op (rather than a throw) matches `clear(unknown id)`
 *  semantics — the plugin can't distinguish "id never existed"
 *  from "id belongs to another plugin", which is the intended
 *  isolation property. */
export async function clearForPlugin(pluginPkg: string, entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    if (entry.pluginPkg !== pluginPkg) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cleared", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cleared"),
    };
  });
}

export async function get(entryId: string): Promise<NotifierEntry | undefined> {
  const state = await loadActive(activeFilePath);
  return state.entries[entryId];
}

export async function listFor(pluginPkg: string): Promise<NotifierEntry[]> {
  const state = await loadActive(activeFilePath);
  return Object.values(state.entries).filter((entry) => entry.pluginPkg === pluginPkg);
}

export async function listAll(): Promise<NotifierEntry[]> {
  const state = await loadActive(activeFilePath);
  return Object.values(state.entries);
}

export async function listHistory(): Promise<NotifierHistoryEntry[]> {
  const state = await loadHistory(historyFilePath);
  return state.entries;
}
