// Reconcile active "urgent / high unchecked" notifications against
// the current todo list. Single source of truth on the plugin side
// is `urgent-tickets.json`: a JSON map `todoId → { notificationId,
// priority, title, body }` written alongside `todos.json` in the
// plugin's data dir. After every mutating dispatch (LLM action or
// UI kind) the plugin runs `reconcilePriorityNotifications(...)` so
// the host notifier's active set converges with the desired set.
//
// Design lifted from `server/encore/reconcile.ts` (post-update-API
// migration):
//
//   - Tickets-on-disk are the source of truth for "what bells we
//     own". The host's `engine.listFor` exists but is not exposed
//     on the plugin-facing `NotifierRuntimeApi`; we don't need it
//     once we keep our own ticket file.
//   - **Drift detection on the trim path.** For every ticket whose
//     item is still notifiable, we recompute the desired title /
//     body / severity from current item state. If anything has
//     drifted, we call `notifier.update(id, patch)` — same
//     notificationId, no `cleared` history record, no flicker. The
//     todo's rename/priority-shift bug ("two notifications for one
//     item") collapses to a single in-place edit on the existing
//     entry.
//   - "No longer applicable" path: item gone / completed / priority
//     dropped below the notifiable threshold — clear the bell, drop
//     the ticket. The clear DOES write to history, which is fine
//     here: the user resolved the obligation and the audit trail
//     reads as "you completed this".
//
// Ghost-ticket recovery: when the host bell is deleted out-of-band
// while the ticket survives (user dismissed via bell UI, crash
// truncated active.json), the reconciler calls `notifier.get` on
// the recorded notificationId, finds nothing, drops the ticket,
// and lets Phase 2 republish a fresh entry. Same pattern Encore
// uses via `engine.get` (`server/encore/notifier.ts:bellExists`).

import type { FileOps } from "gui-chat-protocol";
import type { TodoItem, TodoPriority } from "../types";

// ── Notifier surface this module needs ────────────────────────────
//
// Mirrors the relevant slice of the host's `NotifierRuntimeApi` —
// duplicated here so the plugin doesn't import server-internal
// types. The cast point is in `index.ts`.

export type NotifiablePriority = "urgent" | "high";

export interface PriorityAlertPluginData {
  kind: "todo-priority";
  todoId: string;
  /** Snapshot of the item's priority at the last publish / update.
   *  Duplicated on the notifier entry so a future debugger reading
   *  active.json can see which severity bucket the entry came from
   *  without cross-referencing the plugin's ticket store. */
  priority: NotifiablePriority;
}

export interface PriorityNotifierApi {
  publish(input: {
    severity: "urgent" | "nudge";
    lifecycle: "action";
    title: string;
    body?: string;
    navigateTarget: string;
    pluginData: PriorityAlertPluginData;
  }): Promise<{ id: string }>;
  update(
    id: string,
    patch: {
      severity?: "urgent" | "nudge";
      title?: string;
      body?: string;
      pluginData?: PriorityAlertPluginData;
    },
  ): Promise<void>;
  clear(id: string): Promise<void>;
  /** Returns a truthy entry when the bell still exists and belongs
   *  to this plugin, otherwise undefined. Used for ghost-bell
   *  detection: a ticket whose `notificationId` no longer resolves
   *  here means the bell was wiped (user dismissed via UI, crash
   *  truncated active.json) and reconcile should re-publish rather
   *  than `update` (which would silently no-op). */
  get(id: string): Promise<unknown | undefined>;
}

// ── Constants ─────────────────────────────────────────────────────

const PLUGIN_DATA_KIND = "todo-priority" as const;
const NAVIGATE_TARGET = "/todos";
const TITLE_MAX = 60;
// Matches the host notifier engine's `bodyMax` cap. Clamping in the
// plugin (rather than letting publish/update reject) means
// `safeUpdate` / `safePublish` can't be tricked into committing a
// ticket-as-synced for a patch the engine silently no-op'd — the
// only remaining engine no-op case is unknown id (ghost bell), and
// that's the accepted limitation documented in the file header.
// Codex CHANGES REQUESTED on PR #1451.
const BODY_MAX = 4000;
const TICKETS_FILE = "urgent-tickets.json";

// ── Ticket store (the plugin's own source of truth) ───────────────

interface Ticket {
  todoId: string;
  notificationId: string;
  priority: NotifiablePriority;
  /** Title and body as last rendered to the bell — the drift
   *  baseline. The reconciler's trim path compares these against
   *  `buildTitle` / `buildBody` recomputed from current item state;
   *  if either has drifted (most commonly via an item rename or a
   *  note edit), the path calls `notifier.update` in place. Optional
   *  on the wire so pre-update-API tickets load cleanly — they read
   *  as "always drifted" on first sight, which triggers an
   *  idempotent update + ticket rewrite that backfills the fields. */
  title?: string;
  body?: string;
}

interface TicketsFile {
  tickets: Record<string, Ticket>;
}

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  if (typeof t["todoId"] !== "string") return false;
  if (typeof t["notificationId"] !== "string") return false;
  if (t["priority"] !== "urgent" && t["priority"] !== "high") return false;
  // title / body are optional on the wire (legacy tickets) but if
  // present must be strings — otherwise we drop them on read.
  if (t["title"] !== undefined && typeof t["title"] !== "string") return false;
  if (t["body"] !== undefined && typeof t["body"] !== "string") return false;
  return true;
}

async function loadTickets(files: FileOps, log?: ReconcileLog): Promise<TicketsFile> {
  if (!(await files.exists(TICKETS_FILE))) return { tickets: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(await files.read(TICKETS_FILE));
  } catch (err) {
    // Treat malformed JSON as "no tickets" rather than crashing the
    // reconcile, but log a warning so this is diagnosable from logs
    // if it ever happens (e.g. partial write from a crash, manual
    // hand-edit that broke the syntax).
    log?.warn("priority reconcile: tickets file unparseable; treating as empty", { file: TICKETS_FILE, error: String(err) });
    return { tickets: {} };
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("tickets" in raw) ||
    typeof (raw as { tickets?: unknown }).tickets !== "object" ||
    (raw as { tickets?: unknown }).tickets === null
  ) {
    log?.warn("priority reconcile: tickets file has unexpected shape; treating as empty", { file: TICKETS_FILE });
    return { tickets: {} };
  }
  const rawTickets = (raw as { tickets: Record<string, unknown> }).tickets;
  const out: Record<string, Ticket> = {};
  for (const [key, value] of Object.entries(rawTickets)) {
    if (!isTicket(value)) continue;
    if (value.todoId !== key) continue;
    out[key] = value;
  }
  return { tickets: out };
}

async function saveTickets(files: FileOps, file: TicketsFile): Promise<void> {
  await files.write(TICKETS_FILE, JSON.stringify(file, null, 2));
}

// ── Priority → notification mapping ───────────────────────────────

function isNotifiablePriority(priority: TodoPriority | undefined): priority is NotifiablePriority {
  return priority === "urgent" || priority === "high";
}

function severityFor(priority: NotifiablePriority): "urgent" | "nudge" {
  return priority === "urgent" ? "urgent" : "nudge";
}

// ── Title / body formatting ───────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Title is the todo text verbatim (truncated). Severity is already
// signalled by the bell's color badge and on-disk `pluginData.priority`,
// so adding "Urgent: " / "High priority: " to the title is redundant.
function buildTitle(item: TodoItem): string {
  return truncate(item.text, TITLE_MAX);
}

// Returns the empty string (NOT undefined) when there is no note /
// dueDate. The empty-string contract is what lets "removed body"
// flow through the notifier's patch API: the engine treats an
// absent patch field as "leave alone", so we need a concrete value
// to push. Empty body renders identically to no body in the bell
// UI's v-if templates, so this is a presentation-equivalent
// representation we can compare and persist without ambiguity.
//
// Output is clamped to `BODY_MAX` so the engine's publish/update
// validation can never reject for body length — see the BODY_MAX
// rationale above.
function buildBody(item: TodoItem): string {
  const note = item.note?.trim();
  let body = "";
  if (note) body = note;
  else if (item.dueDate) body = `Due ${item.dueDate}`;
  return body.length <= BODY_MAX ? body : `${body.slice(0, BODY_MAX - 1)}…`;
}

// ── Reconcile (the IO-bound entry point) ──────────────────────────

interface ReconcileLog {
  warn: (msg: string, data?: object) => void;
}

async function safeClear(notifier: PriorityNotifierApi, notificationId: string, todoId: string, log?: ReconcileLog): Promise<boolean> {
  try {
    await notifier.clear(notificationId);
    return true;
  } catch (err) {
    // Caller MUST consult the return value before destructive ticket
    // cleanup — swallowing a clear failure and dropping the ticket
    // would orphan the bell forever (no ticket means the next
    // reconcile has nothing to retry).
    log?.warn("priority reconcile: clear failed", { notificationId, todoId, error: String(err) });
    return false;
  }
}

async function safeUpdate(
  notifier: PriorityNotifierApi,
  notificationId: string,
  patch: {
    severity?: "urgent" | "nudge";
    title?: string;
    body?: string;
    pluginData?: PriorityAlertPluginData;
  },
  todoId: string,
  log?: ReconcileLog,
): Promise<boolean> {
  try {
    await notifier.update(notificationId, patch);
    // `notifier.update` is silent on three engine-level no-ops:
    //   1. unknown id (ghost bell),
    //   2. cross-plugin id,
    //   3. merged-shape validation failure.
    // Each is either caught upstream or structurally impossible by
    // the time we reach this call:
    //   - (1) is filtered by the `notifier.get` ghost-check in
    //     `reconcilePriorityNotifications` BEFORE this function is
    //     invoked, so the entry was alive at check-time. A TOCTOU
    //     race could in theory dismiss it between check and update;
    //     the worst case is the next reconcile catches it and
    //     drops the now-ghost ticket for Phase-2 republish.
    //   - (2) can't happen by construction: every id we hold came
    //     from our own `notifier.publish`.
    //   - (3) can't happen either: title is clamped to TITLE_MAX,
    //     body to BODY_MAX, severity is always urgent/nudge,
    //     navigateTarget is "/todos", and lifecycle is action.
    // So a non-throwing call means the bell really did update.
    return true;
  } catch (err) {
    // Caller MUST consult the return value — committing a ticket
    // rewrite after a failed update would erase the drift signal,
    // so the next reconcile would think the bell is in sync while
    // it's actually still stale.
    log?.warn("priority reconcile: update failed", { notificationId, todoId, error: String(err) });
    return false;
  }
}

async function safePublish(notifier: PriorityNotifierApi, item: TodoItem, priority: NotifiablePriority, log?: ReconcileLog): Promise<string | null> {
  try {
    const { id } = await notifier.publish({
      severity: severityFor(priority),
      lifecycle: "action",
      title: buildTitle(item),
      body: buildBody(item),
      navigateTarget: NAVIGATE_TARGET,
      pluginData: { kind: PLUGIN_DATA_KIND, todoId: item.id, priority },
    });
    return id;
  } catch (err) {
    log?.warn("priority reconcile: publish failed", { todoId: item.id, error: String(err) });
    return null;
  }
}

/** Reconcile the plugin's tickets and the host's bell entries with
 *  the current item list. After this resolves:
 *
 *    - every notifiable item has a ticket and a live bell, with the
 *      bell's severity / title / body matching the item's current
 *      state;
 *    - no ticket references a non-notifiable item.
 *
 *  Idempotent and tolerant of partial state. Drift is detected per-
 *  ticket against the title / body / priority stored at last publish
 *  or update; an item rename flows through `notifier.update` rather
 *  than clear-then-publish, preserving the notificationId. */
export async function reconcilePriorityNotifications(items: TodoItem[], notifier: PriorityNotifierApi, files: FileOps, log?: ReconcileLog): Promise<void> {
  const ticketsFile = await loadTickets(files, log);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let dirty = false;

  // Phase 1: walk existing tickets — clear stale, update in place
  // on drift, leave alone on exact match. Each notifier op is gated
  // on success: a failed clear/update keeps the ticket as-is so the
  // next reconcile retries from the same drift signal.
  for (const [todoId, ticket] of Object.entries(ticketsFile.tickets)) {
    const item = itemsById.get(todoId);
    const stillNotifiable = item !== undefined && !item.completed && isNotifiablePriority(item.priority);

    if (!stillNotifiable) {
      const cleared = await safeClear(notifier, ticket.notificationId, todoId, log);
      if (cleared) {
        delete ticketsFile.tickets[todoId];
        dirty = true;
      }
      continue;
    }

    // Ghost-bell check: if the host no longer has this entry (user
    // dismissed via the bell UI, or a crash wiped active.json),
    // `notifier.update` would silently no-op and our ticket would
    // converge to a fake "in-sync" state — the bell would never
    // come back. Drop the ticket here so Phase 2's "publish for
    // unticketed notifiable item" branch re-fires fresh, same
    // shape Encore uses (`server/encore/reconcile.ts`'s
    // `refreshGhostTicket`). Codex CHANGES REQUESTED, PR #1451.
    const bellAlive = (await notifier.get(ticket.notificationId)) !== undefined;
    if (!bellAlive) {
      log?.warn("priority reconcile: ghost ticket dropped; Phase 2 will re-publish", { notificationId: ticket.notificationId, todoId });
      delete ticketsFile.tickets[todoId];
      dirty = true;
      continue;
    }

    const currentPriority: NotifiablePriority = item.priority as NotifiablePriority;
    const desiredTitle = buildTitle(item);
    const desiredBody = buildBody(item);

    const priorityDrift = currentPriority !== ticket.priority;
    const titleDrift = ticket.title !== desiredTitle;
    const bodyDrift = ticket.body !== desiredBody;

    if (!priorityDrift && !titleDrift && !bodyDrift) continue;

    // In-place update: same notificationId, no flicker, no history
    // record. Body is sent on every drift (including the "note
    // removed" case): `buildBody` returns "" rather than undefined
    // so this branch can always push a concrete value through the
    // notifier's patch API.
    const updated = await safeUpdate(
      notifier,
      ticket.notificationId,
      {
        ...(priorityDrift ? { severity: severityFor(currentPriority) } : {}),
        ...(titleDrift ? { title: desiredTitle } : {}),
        ...(bodyDrift ? { body: desiredBody } : {}),
        ...(priorityDrift ? { pluginData: { kind: PLUGIN_DATA_KIND, todoId, priority: currentPriority } } : {}),
      },
      todoId,
      log,
    );
    if (updated) {
      ticketsFile.tickets[todoId] = { todoId, notificationId: ticket.notificationId, priority: currentPriority, title: desiredTitle, body: desiredBody };
      dirty = true;
    }
  }

  // Phase 2: publish bells for notifiable items that don't have a
  // ticket yet.
  for (const item of items) {
    if (item.completed || !isNotifiablePriority(item.priority)) continue;
    if (ticketsFile.tickets[item.id]) continue;
    const newId = await safePublish(notifier, item, item.priority, log);
    if (newId === null) continue;
    ticketsFile.tickets[item.id] = {
      todoId: item.id,
      notificationId: newId,
      priority: item.priority,
      title: buildTitle(item),
      body: buildBody(item),
    };
    dirty = true;
  }

  if (dirty) {
    try {
      await saveTickets(files, ticketsFile);
    } catch (err) {
      log?.warn("priority reconcile: tickets save failed", { error: String(err) });
    }
  }
}
