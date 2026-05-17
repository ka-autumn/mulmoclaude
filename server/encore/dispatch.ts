// Encore plugin — server-side handler module.
//
// Data-only on-disk model (PR #1416 follow-up): cycle files hold
// only what the user recorded (values / skipped / completedSteps).
// Closure is derived. Bell-entry tracking lives in pending-clear
// tickets, not in the cycle file.
//
// `dispatch(body)` is the single entry point; the Express adapter in
// `server/api/routes/encore.ts` calls it. The dispatch wrapper
// acquires the per-plugin mutex before each handler runs so two
// concurrent mutations can't race on writeFileAtomic, and so a
// kick-the-tick from a handler can't double-publish with the hourly
// heartbeat. State-mutating handlers kick the tick after persisting
// — the tick re-evaluates the obligation, derives closure, and
// surfaces newly-due notifications within the same SSE turn.
//
// Next-cycle provisioning happens INSIDE the tick when it detects
// the latest cycle is closed (via closure.ts) — no separate
// provisionNextCycle path from dispatch.

import { z } from "zod";

import { EncoreDslInput, type EncoreDsl } from "./dsl/schema.js";
import {
  applyValues,
  buildCycleState,
  parseCycleFile,
  recordStepDone,
  recordStepSnooze,
  recordTargetSkip,
  serializeCycleFile,
  type CycleState,
} from "./cycle.js";
import { ONE_HOUR_MS } from "../utils/time.js";
import { isCycleClosed, isStepClosed } from "./closure.js";
import { parseIndexFile, serializeIndexFile } from "./obligation.js";
import { currentCycleSlot } from "./dsl/cadence.js";
import path from "node:path";
import { obligationDir, obligationIndexPath, cycleFilePath, pendingClearPath, slugify, OBLIGATIONS_DIRNAME, PENDING_CLEAR_DIRNAME } from "./paths.js";
import { exists, readDir, readTextOrNull, writeText, unlink } from "../utils/files/encore-io.js";
import { WORKSPACE_DIRS } from "../workspace/paths.js";
import { log } from "../system/logger/index.js";
import { tickUnlocked, withLock } from "./lock.js";
import * as encoreNotifier from "./notifier.js";
import { ENCORE_PLUGIN_PKG } from "./notifier.js";
import type { PendingClearTicket } from "./tick.js";
import { startChat } from "../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../src/config/roles.js";
import { randomUUID } from "node:crypto";

function makeUuid(): string {
  return randomUUID();
}

// ── error types + envelope ────────────────────────────────────────

export interface EncoreDispatchBody {
  kind: string;
  [key: string]: unknown;
}

export interface EncoreDispatchResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export class EncoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "EncoreError";
  }
}

// ── per-kind Zod arg schemas ──────────────────────────────────────

const SetupArgs = z.object({
  kind: z.literal("setup"),
  definition: z.unknown(),
});

const AmendArgs = z.object({
  kind: z.literal("amendDefinition"),
  obligationId: z.string(),
  definition: z.record(z.string(), z.unknown()),
});

const QueryArgs = z.object({
  kind: z.literal("query"),
  obligationId: z.string().optional(),
  range: z.union([z.literal("current"), z.literal("all"), z.number().int().positive()]).optional(),
  targetId: z.string().optional(),
});

const AppendNoteArgs = z.object({
  kind: z.literal("appendNote"),
  obligationId: z.string(),
  cycleId: z.string().optional(),
  body: z.string().min(1),
});

const MarkStepDoneArgs = z.object({
  kind: z.literal("markStepDone"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  stepId: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
  pendingId: z.string().optional(),
});

const MarkTargetSkippedArgs = z.object({
  kind: z.literal("markTargetSkipped"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  pendingId: z.string().optional(),
});

const RecordValuesArgs = z.object({
  kind: z.literal("recordValues"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  values: z.record(z.string(), z.unknown()),
  pendingId: z.string().optional(),
});

const SnoozeArgs = z.object({
  kind: z.literal("snooze"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  stepId: z.string(),
  pendingId: z.string().optional(),
});

const ResolveNotificationArgs = z.object({
  kind: z.literal("resolveNotification"),
  pendingId: z.string(),
  /** Bell entry id, spliced onto the navigateTarget at click time
   *  by the host's NotificationBell.vue. Lets us clear orphan bell
   *  entries whose pending-clear ticket was already swept. */
  notificationId: z.string().optional(),
});

// ── path / id helpers ─────────────────────────────────────────────

async function generateUniqueObligationId(displayName: string): Promise<string> {
  const base = slugify(displayName);
  if (!(await exists(obligationIndexPath(base)))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(obligationIndexPath(candidate)))) return candidate;
  }
  throw new EncoreError(500, `failed to generate a unique obligation id from displayName ${JSON.stringify(displayName)} (tried ${base} through ${base}-999)`);
}

// ── handlers ──────────────────────────────────────────────────────

async function handleSetup(args: z.infer<typeof SetupArgs>): Promise<EncoreDispatchResult> {
  let dsl: EncoreDsl;
  try {
    dsl = EncoreDslInput.parse(args.definition);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, formatZodError(err), { issues: err.issues });
    }
    throw err;
  }

  const obligationId = await generateUniqueObligationId(dsl.displayName);
  const fullDsl: EncoreDsl = {
    ...dsl,
    id: obligationId,
    createdAt: new Date().toISOString(),
  };

  // Provision the first cycle synchronously so the obligation has
  // something to fire against on the very next tick.
  const slot = currentCycleSlot(fullDsl.cadence, new Date());
  const cycle = buildCycleState(fullDsl, slot);

  await writeText(obligationIndexPath(obligationId), serializeIndexFile(fullDsl, ""));
  await writeText(cycleFilePath(obligationId, cycle.cycleId), serializeCycleFile(cycle, ""));

  // Kick the tick so that if the firingPlan's first phase is
  // already due (cycle-start with no offset, for example), the bell
  // surfaces the notification within the same SSE turn.
  await tickUnlocked({ now: new Date() }, `setup ${obligationId}`);

  log.info("encore", "setup: obligation created", { obligationId, cycleId: cycle.cycleId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(dsl.displayName)} created (id: ${obligationId}, first cycle: ${cycle.cycleId}, deadline: ${cycle.cycleDeadline}).`,
    obligationId,
    cycleId: cycle.cycleId,
    cyclePath: workspaceRelativePath(cycleFilePath(obligationId, cycle.cycleId)),
    indexPath: workspaceRelativePath(obligationIndexPath(obligationId)),
  };
}

async function handleAmend(args: z.infer<typeof AmendArgs>): Promise<EncoreDispatchResult> {
  const indexPath = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexPath);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl: existing, body } = parseIndexFile(raw);
  const patch = args.definition;

  // Immutable fields per Resolved #15 / #10: type, currency, and
  // cadence.type. Changing them would invalidate prior cycle records
  // (currency mid-life), break cycle-file naming (cadence.type), or
  // change the validation discriminator (type). Path: retire + new.
  if ("type" in patch && patch.type !== existing.type) {
    throw new EncoreError(400, "amendDefinition: changing `type` is not allowed — retire and create a new obligation");
  }
  if (existing.type === "payment" && "currency" in patch && patch.currency !== existing.currency) {
    throw new EncoreError(400, "amendDefinition: changing `currency` is not allowed — retire and create a new obligation");
  }
  if ("cadence" in patch) {
    const newCadence = patch.cadence as { type?: string } | undefined;
    if (newCadence && typeof newCadence.type === "string" && newCadence.type !== existing.cadence.type) {
      throw new EncoreError(400, "amendDefinition: changing `cadence.type` is not allowed — retire and create a new obligation");
    }
  }

  // Shallow merge at the top level, array fields replace whole.
  const merged: Record<string, unknown> = { ...(existing as unknown as Record<string, unknown>), ...patch };
  // Server-generated identity fields are always immutable. Even if
  // the LLM includes `id` or `createdAt` in the patch (mistake),
  // force them back to the existing values — letting `id` change
  // would desync the directory name (`obligations/<args.obligationId>/`)
  // from `dsl.id`, and tickets / queries written under the new id
  // would point at files that aren't there.
  merged.id = existing.id;
  merged.createdAt = existing.createdAt;

  let validated: EncoreDsl;
  try {
    validated = EncoreDslInput.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, `amendDefinition: ${formatZodError(err)}`, { issues: err.issues });
    }
    throw err;
  }

  await writeText(indexPath, serializeIndexFile(validated, body));

  // Force-refresh every active bell entry for this obligation:
  // clear the current bell entries, null out the cycle file's
  // activeNotificationId / lastPublishedSeverity, then kick the
  // tick. The tick will see the un-fired entries and publish fresh
  // notifications carrying the new displayName / step labels.
  // Without this step, a title-only amend leaves the old bell in
  // place (or worse — if the bell entry was already cleared but the
  // cycle file still holds the id, no new notification fires at all
  // because the tick thinks one is already active).
  await resetActiveNotificationsForObligation(args.obligationId, `amendDefinition`);
  await tickUnlocked({ now: new Date() }, `amendDefinition ${args.obligationId}`);
  log.info("encore", "amendDefinition: obligation updated", { obligationId: args.obligationId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(validated.displayName)} updated (id: ${args.obligationId}).`,
    obligationId: args.obligationId,
    indexPath: workspaceRelativePath(indexPath),
  };
}

interface QueryCycleResult {
  cycleId: string;
  path: string;
  state: CycleState;
  body: string;
}

interface QueryObligationResult {
  obligationId: string;
  indexPath: string;
  dsl: EncoreDsl;
  body: string;
  cycles: QueryCycleResult[];
}

async function handleQuery(args: z.infer<typeof QueryArgs>): Promise<EncoreDispatchResult> {
  const range = args.range ?? "current";

  // List of obligations to inspect: either the named one, or all of
  // them (when no obligationId is passed).
  let obligationIds: string[];
  if (args.obligationId) {
    obligationIds = [args.obligationId];
  } else {
    obligationIds = (await readDir(OBLIGATIONS_DIRNAME)).sort();
  }

  const results: QueryObligationResult[] = [];
  for (const obligationId of obligationIds) {
    const indexRel = obligationIndexPath(obligationId);
    const indexRaw = await readTextOrNull(indexRel);
    if (indexRaw === null) {
      if (args.obligationId) {
        throw new EncoreError(404, `obligation ${JSON.stringify(obligationId)} not found`);
      }
      continue;
    }
    const { dsl, body } = parseIndexFile(indexRaw);
    const cycles = await readCyclesForObligation(obligationId, range);
    results.push({
      obligationId,
      indexPath: workspaceRelativePath(indexRel),
      dsl,
      body,
      cycles,
    });
  }

  return {
    ok: true,
    message: queryMessage(results, range),
    obligations: results,
  };
}

async function readCyclesForObligation(obligationId: string, range: "current" | "all" | number): Promise<QueryCycleResult[]> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  // Sorted ascending; the most recent cycle is the last entry. For
  // "current" we return the single latest open cycle (or the latest
  // entry if none are open); for "all" we return everything; for a
  // numeric range we return the last N entries.
  const slice = range === "all" ? cycleFiles : cycleFiles.slice(-(range === "current" ? 1 : range));
  const out: QueryCycleResult[] = [];
  for (const filename of slice) {
    const rel = path.join(obligationDir(obligationId), filename);
    const raw = await readTextOrNull(rel);
    if (raw === null) continue;
    try {
      const parsed = parseCycleFile(raw);
      out.push({
        cycleId: filename.replace(/\.md$/, ""),
        path: workspaceRelativePath(rel),
        state: parsed.state,
        body: parsed.body,
      });
    } catch (err) {
      log.warn("encore", "query: skipping unparsable cycle file", {
        obligationId,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function queryMessage(results: QueryObligationResult[], range: "current" | "all" | number): string {
  if (results.length === 0) {
    return "Encore: no obligations found.";
  }
  const lines: string[] = [];
  const rangeLabel = typeof range === "number" ? `last ${range}` : range;
  for (const result of results) {
    lines.push(`- ${result.dsl.displayName} (${result.obligationId}, status: ${result.dsl.status}): ${result.cycles.length} cycle(s) in ${rangeLabel}`);
    for (const cycle of result.cycles) {
      const status = isCycleClosed(cycle.state, result.dsl) ? "closed" : "open";
      lines.push(`  - ${cycle.cycleId} [${status}] start=${cycle.state.cycleStart} deadline=${cycle.state.cycleDeadline} path=${cycle.path}`);
    }
  }
  return lines.join("\n");
}

async function handleAppendNote(args: z.infer<typeof AppendNoteArgs>): Promise<EncoreDispatchResult> {
  if (args.cycleId) {
    const rel = cycleFilePath(args.obligationId, args.cycleId);
    const raw = await readTextOrNull(rel);
    if (raw === null) {
      throw new EncoreError(404, `cycle file ${args.obligationId}/${args.cycleId}.md not found`);
    }
    const { state, body } = parseCycleFile(raw);
    const newBody = appendBody(body, args.body);
    await writeText(rel, serializeCycleFile(state, newBody));
    log.info("encore", "appendNote: cycle body updated", { obligationId: args.obligationId, cycleId: args.cycleId });
    return {
      ok: true,
      message: `Note appended to cycle ${args.cycleId} of ${args.obligationId}.`,
      obligationId: args.obligationId,
      cycleId: args.cycleId,
      path: workspaceRelativePath(rel),
    };
  }

  const indexRel = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexRel);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl, body } = parseIndexFile(raw);
  const newBody = appendBody(body, args.body);
  await writeText(indexRel, serializeIndexFile(dsl, newBody));
  log.info("encore", "appendNote: obligation body updated", { obligationId: args.obligationId });
  return {
    ok: true,
    message: `Note appended to obligation ${args.obligationId}.`,
    obligationId: args.obligationId,
    path: workspaceRelativePath(indexRel),
  };
}

function appendBody(existing: string, addition: string): string {
  if (existing.trim().length === 0) return addition.endsWith("\n") ? addition : `${addition}\n`;
  const sep = existing.endsWith("\n") ? "" : "\n";
  const tail = addition.endsWith("\n") ? addition : `${addition}\n`;
  return `${existing}${sep}\n${tail}`;
}

// ── per-cycle mutating handlers ───────────────────────────────────

/** Find every pending-clear ticket for this obligation+cycle, clear
 *  its host bell entry, and unlink the ticket. Used by
 *  amendDefinition so a title (or any other amend) produces a
 *  freshly-published notification carrying the updated text — and
 *  to recover from "ticket exists but the bell is empty" stuck
 *  states. */
async function resetActiveNotificationsForObligation(obligationId: string, reason: string): Promise<void> {
  const cycleId = await currentCycleIdFor(obligationId);
  if (!cycleId) return;
  const matchingTickets = await ticketsForObligationCycle(obligationId, cycleId);
  let cleared = 0;
  for (const { rel, ticket } of matchingTickets) {
    await safeClearBell(ticket.notificationId, `${reason}:reset`);
    await unlink(rel);
    cleared += 1;
  }
  if (cleared > 0) log.info("encore", `${reason}: reset active notifications`, { obligationId, cleared });
}

interface LocatedTicket {
  rel: string;
  ticket: PendingClearTicket;
}

async function ticketsForObligationCycle(obligationId: string, cycleId: string): Promise<LocatedTicket[]> {
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  const out: LocatedTicket[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(PENDING_CLEAR_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    try {
      const ticket = JSON.parse(raw) as PendingClearTicket;
      if (ticket.obligationId === obligationId && ticket.cycleId === cycleId) {
        out.push({ rel, ticket });
      }
    } catch {
      // skip unparsable
    }
  }
  return out;
}

async function currentCycleIdFor(obligationId: string): Promise<string | null> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  if (cycleFiles.length === 0) return null;
  return cycleFiles[cycleFiles.length - 1].replace(/\.md$/, "");
}

// `removeTicketsForNotifications` was used by the old
// reset-by-notificationId path; the new reset walks tickets by
// obligation+cycle directly. Kept (with the lint-required `__`
// prefix) in case a future caller needs it.
async function __removeTicketsForNotifications(ids: Set<string>): Promise<void> {
  if (ids.size === 0) return;
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(PENDING_CLEAR_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    try {
      const ticket = JSON.parse(raw) as { notificationId?: string };
      if (ticket.notificationId && ids.has(ticket.notificationId)) {
        await unlink(rel);
      }
    } catch {
      // Unparsable ticket — leave it; the orphan sweep handles
      // those by age.
    }
  }
}

async function loadDsl(obligationId: string): Promise<EncoreDsl | null> {
  const raw = await readTextOrNull(obligationIndexPath(obligationId));
  if (raw === null) return null;
  try {
    return parseIndexFile(raw).dsl;
  } catch {
    return null;
  }
}

async function loadCycle(obligationId: string, cycleId: string): Promise<{ rel: string; raw: string; state: CycleState; body: string }> {
  const rel = cycleFilePath(obligationId, cycleId);
  const raw = await readTextOrNull(rel);
  if (raw === null) {
    throw new EncoreError(404, `cycle file ${obligationId}/${cycleId}.md not found`);
  }
  const { state, body } = parseCycleFile(raw);
  return { rel, raw, state, body };
}

/** When a handler is the resolution of a notification-seeded chat,
 *  the pending-clear ticket carries the bell-entry id and the set
 *  of targets it covers (a bundle when length > 1).
 *
 *  Bundle-aware semantics: closing one target inside a multi-target
 *  bundle must NOT clear the shared bell entry — the other targets
 *  in the bundle still need a chat to resolve them. We drop the
 *  closed target(s) from `ticket.targets`; only when the set
 *  becomes empty do we clear the bell and unlink the ticket. This
 *  also covers the single-target case as a degenerate (one
 *  remaining target → close it → set empties → clear).
 *
 *  "Closed" here means the target's step (the one named in the
 *  ticket) is no longer `open` AND no longer references this
 *  notificationId — set to null by closeStep/skipTarget/snoozeStep
 *  via cycle.ts. */
interface ExpectedTicketScope {
  obligationId: string;
  cycleId: string;
}

async function clearPendingNotification(
  pendingId: string | undefined,
  dsl: EncoreDsl | null,
  expectedScope: ExpectedTicketScope | null,
  mutatedState?: CycleState,
): Promise<void> {
  if (!pendingId) return;
  const ticketRel = pendingClearPath(pendingId);
  const ticket = await readTicketOrCleanup(ticketRel, pendingId);
  if (!ticket) return;

  // Verify the ticket belongs to the obligation+cycle that was
  // just mutated. A mismatched pendingId (LLM passes the wrong
  // one) would otherwise let us trim/clear an unrelated bundle.
  if (expectedScope && (ticket.obligationId !== expectedScope.obligationId || ticket.cycleId !== expectedScope.cycleId)) {
    log.warn("encore", "clearPendingNotification: pendingId scope mismatch; ignoring", {
      pendingId,
      ticketScope: { obligationId: ticket.obligationId, cycleId: ticket.cycleId },
      expectedScope,
    });
    return;
  }

  const state = await loadStateForTicket(ticket, mutatedState);
  if (!state) {
    // Cycle file gone → orphan. Clear and unlink.
    await safeClearBell(ticket.notificationId, pendingId);
    await unlink(ticketRel);
    return;
  }
  const stepDef = await resolveStepDef(ticket, dsl);
  if (!stepDef) {
    // Can't derive closure without the step definition; clear so
    // the bundle doesn't get stuck.
    await safeClearBell(ticket.notificationId, pendingId);
    await unlink(ticketRel);
    return;
  }

  const stillOpenTargets = ticket.targets.filter((targetId) => !isStepClosed(state.records[targetId], stepDef));

  if (stillOpenTargets.length > 0) {
    await writeText(ticketRel, JSON.stringify({ ...ticket, targets: stillOpenTargets }, null, 2));
    log.info("encore", "pending-clear: partial resolution; bell kept", {
      pendingId,
      notificationId: ticket.notificationId,
      remaining: stillOpenTargets,
    });
    return;
  }

  // No targets left open on this bundle — clear the bell and the ticket.
  await safeClearBell(ticket.notificationId, pendingId);
  await unlink(ticketRel);
}

async function readTicketOrCleanup(ticketRel: string, pendingId: string): Promise<PendingClearTicket | null> {
  const raw = await readTextOrNull(ticketRel);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingClearTicket;
  } catch (err) {
    log.warn("encore", "pending-clear ticket unparseable; removing", { pendingId, error: err instanceof Error ? err.message : String(err) });
    await unlink(ticketRel);
    return null;
  }
}

async function loadStateForTicket(ticket: PendingClearTicket, mutatedState?: CycleState): Promise<CycleState | null> {
  if (mutatedState) return mutatedState;
  const cycleRaw = await readTextOrNull(cycleFilePath(ticket.obligationId, ticket.cycleId));
  if (cycleRaw === null) return null;
  return parseCycleFile(cycleRaw).state;
}

async function resolveStepDef(ticket: PendingClearTicket, dsl: EncoreDsl | null): Promise<EncoreDsl["steps"][number] | undefined> {
  const direct = dsl?.steps.find((step) => step.id === ticket.stepId);
  if (direct) return direct;
  const indexRaw = await readTextOrNull(obligationIndexPath(ticket.obligationId));
  if (indexRaw === null) return undefined;
  try {
    return parseIndexFile(indexRaw).dsl.steps.find((step) => step.id === ticket.stepId);
  } catch {
    return undefined;
  }
}

async function safeClearBell(notificationId: string, pendingId: string): Promise<void> {
  try {
    await encoreNotifier.clear(notificationId);
  } catch (err) {
    log.warn("encore", "notifier.clear failed", { pendingId, notificationId, error: err instanceof Error ? err.message : String(err) });
  }
}

async function persistAndKickTick(rel: string, state: CycleState, body: string, reason: string): Promise<void> {
  await writeText(rel, serializeCycleFile(state, body));
  // The tick itself derives closure via closure.ts and provisions
  // the next cycle file when the current one is closed (see
  // ensureOpenCycle in tick.ts). The handler doesn't need to
  // detect close here.
  //
  // Run the tick inside the SAME lock that wraps the dispatch
  // (we use `tickUnlocked`, not `kickTickLocked` — the latter
  // would deadlock by trying to re-acquire the lock we already
  // hold).
  await tickUnlocked({ now: new Date() }, reason);
}

/** Reject calls referencing target/step ids that don't exist in
 *  the DSL. Without this, a typo (`pat` vs `pay`) would succeed
 *  silently — writing a record under the bogus id, leaving the
 *  real step still un-closed, and surfacing as "I told the LLM
 *  I paid but the bell didn't clear". */
function assertKnownTargetAndStep(dsl: EncoreDsl | null, args: { obligationId: string; targetId: string; stepId?: string }): void {
  if (!dsl) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  if (!dsl.targets.some((target) => target.id === args.targetId)) {
    const known = dsl.targets.map((target) => target.id).join(", ");
    throw new EncoreError(400, `unknown targetId ${JSON.stringify(args.targetId)} for obligation ${JSON.stringify(args.obligationId)}. Known: [${known}]`);
  }
  if (args.stepId !== undefined && !dsl.steps.some((step) => step.id === args.stepId)) {
    const known = dsl.steps.map((step) => step.id).join(", ");
    throw new EncoreError(400, `unknown stepId ${JSON.stringify(args.stepId)} for obligation ${JSON.stringify(args.obligationId)}. Known: [${known}]`);
  }
}

async function handleMarkStepDone(args: z.infer<typeof MarkStepDoneArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepDone(state, args.targetId, args.stepId, args.values);
  await persistAndKickTick(rel, nextState, body, `markStepDone ${args.obligationId}/${args.cycleId}/${args.targetId}/${args.stepId}`);
  await clearPendingNotification(args.pendingId, dsl, { obligationId: args.obligationId, cycleId: args.cycleId }, nextState);
  log.info("encore", "markStepDone: step recorded", { obligationId: args.obligationId, cycleId: args.cycleId, targetId: args.targetId, stepId: args.stepId });
  return {
    ok: true,
    message: `Encore: marked ${args.stepId} done for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
    cyclePath: workspaceRelativePath(rel),
  };
}

async function handleMarkTargetSkipped(args: z.infer<typeof MarkTargetSkippedArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordTargetSkip(state, args.targetId);
  await persistAndKickTick(rel, nextState, body, `markTargetSkipped ${args.obligationId}/${args.cycleId}/${args.targetId}`);
  await clearPendingNotification(args.pendingId, dsl, { obligationId: args.obligationId, cycleId: args.cycleId }, nextState);
  log.info("encore", "markTargetSkipped: target skipped", { obligationId: args.obligationId, cycleId: args.cycleId, targetId: args.targetId });
  return {
    ok: true,
    message: `Encore: skipped ${args.targetId} for cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    cyclePath: workspaceRelativePath(rel),
  };
}

async function handleRecordValues(args: z.infer<typeof RecordValuesArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = applyValues(state, args.targetId, args.values);
  // No tick kick — recording partial values doesn't close anything
  // and doesn't change firing eligibility.
  await writeText(rel, serializeCycleFile(nextState, body));
  log.info("encore", "recordValues: values recorded", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    keys: Object.keys(args.values),
  });
  return {
    ok: true,
    message: `Encore: recorded ${Object.keys(args.values).length} value(s) on ${args.targetId} in cycle ${args.cycleId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    cyclePath: workspaceRelativePath(rel),
  };
}

async function handleOrphanResolve(args: z.infer<typeof ResolveNotificationArgs>): Promise<EncoreDispatchResult> {
  // The ticket was already swept (e.g. the LLM resolved the
  // obligation in another chat before this click). Clear the bell
  // entry so it disappears.
  if (args.notificationId) {
    try {
      await encoreNotifier.clear(args.notificationId);
    } catch (err) {
      log.warn("encore", "resolveNotification: orphan clear failed", {
        notificationId: args.notificationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    ok: false,
    orphan: true,
    message: `Encore: this notification has already been resolved (the pending-clear ticket is gone). Bell entry cleared.`,
    error: "pending-clear ticket not found",
  };
}

async function seedChatForTicket(ticket: PendingClearTicket, ticketRel: string, pendingId: string): Promise<string> {
  const chatSessionId = makeUuid();
  const result = await startChat({
    message: ticket.seedPrompt,
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
  if (result.kind === "error") {
    throw new EncoreError(result.status ?? 500, `resolveNotification: startChat failed — ${result.error}`);
  }
  await writeText(ticketRel, JSON.stringify({ ...ticket, chatSessionId }, null, 2));
  log.info("encore", "resolveNotification: chat seeded", {
    pendingId,
    chatSessionId,
    obligationId: ticket.obligationId,
    cycleId: ticket.cycleId,
  });
  return chatSessionId;
}

async function handleResolveNotification(args: z.infer<typeof ResolveNotificationArgs>): Promise<EncoreDispatchResult> {
  const ticketRel = pendingClearPath(args.pendingId);
  const raw = await readTextOrNull(ticketRel);
  if (raw === null) return handleOrphanResolve(args);

  let ticket: PendingClearTicket;
  try {
    ticket = JSON.parse(raw) as PendingClearTicket;
  } catch (err) {
    throw new EncoreError(500, `pending-clear ticket ${JSON.stringify(args.pendingId)} is unparseable`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Idempotency: if this ticket already has a chat session, reuse
  // it rather than spawning a duplicate on double-click.
  const { chatSessionId: existing } = ticket;
  const chatSessionId = existing ?? (await seedChatForTicket(ticket, ticketRel, args.pendingId));
  if (existing) {
    log.info("encore", "resolveNotification: reusing existing chat", { pendingId: args.pendingId, chatSessionId });
  }

  return {
    ok: true,
    message: `Encore: opened chat ${chatSessionId} for ${ticket.obligationId}/${ticket.cycleId}.`,
    chatId: chatSessionId,
    navigateTo: `/chat/${chatSessionId}`,
  };
}

async function dropTargetFromMatchingTickets(obligationId: string, cycleId: string, stepId: string, targetId: string): Promise<number> {
  const matchingTickets = await ticketsForObligationCycle(obligationId, cycleId);
  let dropped = 0;
  for (const { rel, ticket } of matchingTickets) {
    if (ticket.stepId !== stepId) continue;
    if (!ticket.targets.includes(targetId)) continue;
    const remaining = ticket.targets.filter((entry) => entry !== targetId);
    if (remaining.length === 0) {
      await safeClearBell(ticket.notificationId, "snooze");
      await unlink(rel);
    } else {
      await writeText(rel, JSON.stringify({ ...ticket, targets: remaining }, null, 2));
    }
    dropped += 1;
  }
  return dropped;
}

async function handleSnooze(args: z.infer<typeof SnoozeArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  // Snooze under the data-only model:
  //   1. Clear the matching bell entry (the user clicked snooze;
  //      the bell should go away now).
  //   2. Write `snoozedSteps[stepId]` on the cycle file so the
  //      tick skips this step until the snooze expires. Without
  //      this marker the next tick would see "open step, no
  //      ticket" → un-fired → republish the same bell entry
  //      immediately. Default snooze = 24 hours; tunable later if
  //      a real use case emerges.
  //   3. DO NOT kick the tick — the bell is cleared and the
  //      snooze marker is in place; running runTick now would
  //      just check the marker and skip, so it's wasted work.
  const droppedCount = await dropTargetFromMatchingTickets(args.obligationId, args.cycleId, args.stepId, args.targetId);

  const snoozeUntilIso = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepSnooze(state, args.targetId, args.stepId, snoozeUntilIso);
  await writeText(rel, serializeCycleFile(nextState, body));

  await clearPendingNotification(args.pendingId, null, { obligationId: args.obligationId, cycleId: args.cycleId });
  log.info("encore", "snooze: step snoozed", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
    droppedCount,
  });
  return {
    ok: true,
    message: `Encore: snoozed ${args.stepId} for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  };
}

// ── shared helpers ────────────────────────────────────────────────

function formatZodError(err: z.ZodError): string {
  // First issue's path + message — Claude reads this and either
  // self-corrects or asks the user. The full issues list is in
  // `details` for clients that want the structured form.
  const [first] = err.issues;
  const pathStr = first.path.length > 0 ? first.path.map((segment) => String(segment)).join(".") : "(root)";
  return `DSL validation failed at ${pathStr}: ${first.message}. Read config/helps/encore-dsl.md for the full grammar.`;
}

function workspaceRelativePath(rel: string): string {
  return `${WORKSPACE_DIRS.encore}/${rel}`;
}

// ── dispatch ──────────────────────────────────────────────────────

/** Wrap a Zod parse to convert validation failures into a 400
 *  `EncoreError` with a field-path-aware message. Without this, the
 *  caller sees a generic 500 ("encore dispatch failed") and has no
 *  way to know whether the shape was wrong or the server actually
 *  crashed — Claude in particular tends to spiral with retries on
 *  generic errors. */
function safeParse<T>(schema: z.ZodType<T>, body: unknown, kind: string): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join(".") : "(root)";
    return `${fieldPath}: ${issue.message}`;
  });
  const summary = issues.join("; ");
  throw new EncoreError(400, `manageEncore(${kind}): invalid args — ${summary}. See helps/encore-dsl.md for the call shape.`, { issues: result.error.issues });
}

async function dispatchInner(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  const { kind } = body;
  if (kind === "setup") return handleSetup(safeParse(SetupArgs, body, kind));
  if (kind === "amendDefinition") return handleAmend(safeParse(AmendArgs, body, kind));
  if (kind === "query") return handleQuery(safeParse(QueryArgs, body, kind));
  if (kind === "appendNote") return handleAppendNote(safeParse(AppendNoteArgs, body, kind));
  if (kind === "markStepDone") return handleMarkStepDone(safeParse(MarkStepDoneArgs, body, kind));
  if (kind === "markTargetSkipped") return handleMarkTargetSkipped(safeParse(MarkTargetSkippedArgs, body, kind));
  if (kind === "recordValues") return handleRecordValues(safeParse(RecordValuesArgs, body, kind));
  if (kind === "snooze") return handleSnooze(safeParse(SnoozeArgs, body, kind));
  if (kind === "resolveNotification") return handleResolveNotification(safeParse(ResolveNotificationArgs, body, kind));
  throw new EncoreError(400, `unknown kind ${JSON.stringify(kind)}`);
}

export async function dispatch(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  if (!body || typeof body !== "object") {
    throw new EncoreError(400, "request body must be an object with a string `kind` field");
  }
  if (typeof body.kind !== "string") {
    throw new EncoreError(400, "missing or non-string `kind`");
  }
  // Serialise every dispatch through the per-plugin mutex (Resolved
  // #22). The mutex also covers handler-side `tickUnlocked` calls
  // since we run them from inside this same critical section.
  return withLock(() => dispatchInner(body));
}
