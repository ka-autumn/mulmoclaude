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
// Ghost-ticket recovery (host bell deleted out-of-band while ticket
// survives) is NOT implemented: Encore uses `engine.get(id)` for
// that, which a runtime plugin can't reach. If the user dismisses
// via the bell UI, the next reconcile sees no drift and leaves the
// (now phantom) ticket alone. To force a re-publish: toggle the
// item's priority off and back on.

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
}

// ── Constants ─────────────────────────────────────────────────────

const PLUGIN_DATA_KIND = "todo-priority" as const;
const NAVIGATE_TARGET = "/todos";
const TITLE_MAX = 60;
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

async function loadTickets(files: FileOps): Promise<TicketsFile> {
  if (!(await files.exists(TICKETS_FILE))) return { tickets: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(await files.read(TICKETS_FILE));
  } catch {
    return { tickets: {} };
  }
  if (!raw || typeof raw !== "object") return { tickets: {} };
  const rawTickets = (raw as { tickets?: unknown }).tickets;
  if (!rawTickets || typeof rawTickets !== "object") return { tickets: {} };
  const out: Record<string, Ticket> = {};
  for (const [key, value] of Object.entries(rawTickets as Record<string, unknown>)) {
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

function buildBody(item: TodoItem): string | undefined {
  const note = item.note?.trim();
  if (note) return note;
  if (item.dueDate) return `Due ${item.dueDate}`;
  return undefined;
}

// ── Reconcile (the IO-bound entry point) ──────────────────────────

interface ReconcileLog {
  warn: (msg: string, data?: object) => void;
}

async function safeClear(notifier: PriorityNotifierApi, notificationId: string, todoId: string, log?: ReconcileLog): Promise<void> {
  try {
    await notifier.clear(notificationId);
  } catch (err) {
    log?.warn("priority reconcile: clear failed", { notificationId, todoId, error: String(err) });
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
): Promise<void> {
  try {
    await notifier.update(notificationId, patch);
  } catch (err) {
    log?.warn("priority reconcile: update failed", { notificationId, todoId, error: String(err) });
  }
}

async function safePublish(notifier: PriorityNotifierApi, item: TodoItem, priority: NotifiablePriority, log?: ReconcileLog): Promise<string | null> {
  const body = buildBody(item);
  try {
    const { id } = await notifier.publish({
      severity: severityFor(priority),
      lifecycle: "action",
      title: buildTitle(item),
      ...(body !== undefined ? { body } : {}),
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
  const ticketsFile = await loadTickets(files);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let dirty = false;

  // Phase 1: walk existing tickets — clear stale, update in place
  // on drift, leave alone on exact match.
  for (const [todoId, ticket] of Object.entries(ticketsFile.tickets)) {
    const item = itemsById.get(todoId);
    const stillNotifiable = item !== undefined && !item.completed && isNotifiablePriority(item.priority);

    if (!stillNotifiable) {
      await safeClear(notifier, ticket.notificationId, todoId, log);
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

    if (priorityDrift || titleDrift || bodyDrift) {
      // In-place update: same notificationId, no flicker, no
      // history record. The bell's content is rewritten to match
      // the item's current state.
      await safeUpdate(
        notifier,
        ticket.notificationId,
        {
          ...(priorityDrift ? { severity: severityFor(currentPriority) } : {}),
          ...(titleDrift ? { title: desiredTitle } : {}),
          // body drift includes "became undefined" — the engine's
          // update API doesn't honour explicit-undefined-clears
          // today, so when the desired body is absent we just
          // leave the old body on the bell rather than try to
          // un-set it. The on-disk ticket tracks the latest desired
          // body so re-runs don't re-fire this branch.
          ...(bodyDrift && desiredBody !== undefined ? { body: desiredBody } : {}),
          ...(priorityDrift ? { pluginData: { kind: PLUGIN_DATA_KIND, todoId, priority: currentPriority } } : {}),
        },
        todoId,
        log,
      );
      ticketsFile.tickets[todoId] = { todoId, notificationId: ticket.notificationId, priority: currentPriority, title: desiredTitle, body: desiredBody };
      dirty = true;
      continue;
    }

    // Exact match: no work to do.
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
