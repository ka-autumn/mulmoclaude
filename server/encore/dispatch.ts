// Encore plugin — server-side handler module.
//
// Data-only on-disk model (PR #1416 follow-up): cycle files hold
// only what the user recorded (values / skipped / completedSteps /
// snoozedSteps). Closure is derived. Bell-entry tracking lives in
// pending-clear tickets, not in the cycle file.
//
// `dispatch(body)` is the single entry point; the Express adapter in
// `server/api/routes/encore.ts` calls it. The dispatch wrapper
// acquires the per-plugin mutex before each handler runs so two
// concurrent mutations can't race on writeFileAtomic, and so a
// reconcile from a handler can't double-publish with the hourly
// heartbeat.
//
// State-mutating handlers funnel through `persistAndReconcile`:
// write the cycle file, then run the reconciler under the same lock.
// The reconciler is the sole owner of bell state (see reconcile.ts)
// — handlers don't touch notifier publish/clear or pending-clear
// tickets directly. The one documented exception is
// `handleOrphanResolve`, which clears a bell entry whose ticket was
// already swept (the click landed too late).

import { z } from "zod";

import { EncoreDslInput, type EncoreDsl } from "../../src/types/encore-dsl/schema.js";
import {
  applyValues,
  buildCycleState,
  parseCycleFile,
  recordStepDone,
  recordStepSnooze,
  recordStepUnsnooze,
  recordTargetSkip,
  serializeCycleFile,
  type CycleState,
} from "./cycle.js";
import { ONE_HOUR_MS } from "../utils/time.js";
import { isCycleClosed } from "./closure.js";
import { parseIndexFile, serializeIndexFile } from "./obligation.js";
import { currentCycleSlot } from "../../src/types/encore-dsl/cadence.js";
import path from "node:path";
import { obligationDir, obligationIndexPath, cycleFilePath, pendingClearPath, slugify, OBLIGATIONS_DIRNAME } from "./paths.js";
import { exists, readDir, readTextOrNull, writeText } from "../utils/files/encore-io.js";
import { WORKSPACE_DIRS } from "../workspace/paths.js";
import { log } from "../system/logger/index.js";
import { withLock } from "./lock.js";
import { reconcileCycleNotifications } from "./reconcile.js";
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
  // `.trim().min(1)` so empty AND whitespace-only ids are rejected
  // at parse time with a clear 400, rather than crashing inside
  // `obligationIndexPath("")` / `obligationIndexPath("   ")` →
  // `assertSafeSegment` and bubbling as an opaque 500.
  obligationId: z.string().trim().min(1),
  // `z.unknown()` instead of `z.record(...)` so the handler can also
  // accept a JSON-encoded string and parse it via `coerceDefinitionToObject`
  // — same tolerance as setup. The handler validates the resulting
  // object shape before merging.
  definition: z.unknown(),
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

const UnsnoozeArgs = z.object({
  kind: z.literal("unsnooze"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  stepId: z.string(),
});

const ResolveNotificationArgs = z.object({
  kind: z.literal("resolveNotification"),
  pendingId: z.string(),
  /** Bell entry id, spliced onto the navigateTarget at click time
   *  by the host's NotificationBell.vue. Lets us clear orphan bell
   *  entries whose pending-clear ticket was already swept. */
  notificationId: z.string().optional(),
});

const DefineArgs = z.object({
  kind: z.literal("defineEncore"),
  dsl: z.unknown(),
  /** Present → amend the named obligation; absent → setup a new one.
   *  Discriminator chosen so the LLM never has to also pass a `kind`
   *  inside the tool — "I have an id" / "I don't" is the intent.
   *
   *  `.trim().min(1)` rejects `""` AND whitespace-only ids at parse
   *  time with a clear 400 — without it, those would pass the
   *  `!== undefined` check in `handleDefineEncore` and route to
   *  amend, where `obligationIndexPath("")` /
   *  `obligationIndexPath("   ")` would throw from
   *  `assertSafeSegment` and surface as an opaque 500. */
  obligationId: z.string().trim().min(1).optional(),
});

// ── path / id helpers ─────────────────────────────────────────────

/** Setup-time id allocation. Reject with 409 if the slugified
 *  `displayName` collides with an existing obligation — the LLM
 *  almost certainly intended to amend an existing obligation but
 *  forgot to pass `obligationId`. The previous behavior (silently
 *  auto-number `-2`, `-3`) masked that mistake and produced
 *  parallel duplicates. The reject message tells the LLM how to
 *  recover (pass `obligationId` to make it an amend, or change
 *  `displayName`). See plans/feat-encore-define-tool.md. */
async function requireUniqueObligationId(displayName: string): Promise<string> {
  const slug = slugify(displayName);
  if (!(await exists(obligationIndexPath(slug)))) return slug;
  throw new EncoreError(
    409,
    `Obligation ${JSON.stringify(slug)} already exists (displayName: ${JSON.stringify(displayName)}). ` +
      `To modify it, call defineEncore with obligationId: ${JSON.stringify(slug)} (this becomes an amend). ` +
      `To create a parallel obligation, change the displayName.`,
  );
}

// ── handlers ──────────────────────────────────────────────────────

async function handleSetup(args: z.infer<typeof SetupArgs>): Promise<EncoreDispatchResult> {
  const definitionObject = coerceDefinitionToObject(args.definition, "setup");
  let dsl: EncoreDsl;
  try {
    dsl = EncoreDslInput.parse(definitionObject);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, formatZodError(err), { issues: err.issues });
    }
    throw err;
  }

  const obligationId = await requireUniqueObligationId(dsl.displayName);
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

  // Reconcile so that if the firingPlan's first phase is already due
  // (cycle-start with no offset, for example), the bell surfaces the
  // notification within the same SSE turn.
  await reconcileCycleNotifications({ obligationId, cycleId: cycle.cycleId, now: new Date(), log });

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
  const patch = coerceDefinitionToObject(args.definition, "amendDefinition");

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

  // Force-refresh every active bell entry for this obligation. A
  // title-only amend doesn't close anything, so trim-by-state alone
  // wouldn't republish — but the on-screen text is stale. The
  // `invalidateAllBells` flag tells the reconciler to clear all
  // tickets+bells for the cycle first, then republish with fresh DSL.
  await reconcileCycleNotifications({ obligationId: args.obligationId, now: new Date(), invalidateAllBells: true, log });
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

/** The mutating-handler envelope. Write the cycle file, then run
 *  the reconciler under the same per-plugin lock that wraps this
 *  dispatch. The reconciler re-derives the desired bell state from
 *  disk — it's both the trim path (closed/snoozed → out of bundle)
 *  and the publish path (un-fired in-bundle pairs → publish). */
async function persistAndReconcile(rel: string, state: CycleState, body: string, obligationId: string, cycleId: string): Promise<void> {
  await writeText(rel, serializeCycleFile(state, body));
  await reconcileCycleNotifications({ obligationId, cycleId, now: new Date(), log });
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
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
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
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
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
  // recordValues never closes anything, so the reconciler is a no-op
  // for bells — but we still funnel through `persistAndReconcile`
  // for uniformity (no special-case handler shape). The reconciler
  // is cheap when nothing changed: Phase 1 sees the same live targets,
  // Phase 2 sees the same covered keys, no notifier calls.
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
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
  //
  // DOCUMENTED EXCEPTION to the reconciler-owns-the-bell rule:
  // there's no ticket to reconcile against, so the reconciler can't
  // know the bell entry exists. Direct clear is the only way out.
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

async function handleSnooze(args: z.infer<typeof SnoozeArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  // Snooze under the unified-reconciler model: write
  // `snoozedSteps[stepId]` on the cycle file and let the reconciler
  // do the rest. Because `isPairInBundle` treats snoozed as
  // out-of-bundle, Phase 1 trims this target out of any existing
  // ticket (clearing the bell if the bundle empties); Phase 2 sees
  // the pair as not eligible-to-fire (snooze active), so no
  // republish. The pre-reconciler workaround ("skip the tick after
  // snooze") is no longer needed.
  const snoozeUntilIso = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepSnooze(state, args.targetId, args.stepId, snoozeUntilIso);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "snooze: step snoozed", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
    snoozeUntilIso,
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

async function handleUnsnooze(args: z.infer<typeof UnsnoozeArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  // Inverse of snooze: delete `snoozedSteps[stepId]`. The reconciler
  // sees the pair eligible to fire again (assuming the step isn't
  // also closed) and Phase 2 publishes a fresh bell — in the same
  // dispatch turn, no tick wait. If the step was already not
  // snoozed, `recordStepUnsnooze` is a no-op and the reconciler
  // sees no state change → no flicker.
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepUnsnooze(state, args.targetId, args.stepId);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "unsnooze: step unsnoozed", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  });
  return {
    ok: true,
    message: `Encore: unsnoozed ${args.stepId} for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  };
}

/** New unified entry point for DSL composition. The `defineEncore`
 *  MCP tool exposes this; `manageEncore`'s setup / amendDefinition
 *  kinds are kept on the wire for backward compat but no longer
 *  surfaced in `LLM_ENCORE_KINDS`. Discriminates by `obligationId`
 *  presence so the LLM never has to also pick between "kind: setup"
 *  vs "kind: amendDefinition" — the parameter shape carries the
 *  intent. See plans/feat-encore-define-tool.md. */
async function handleDefineEncore(args: z.infer<typeof DefineArgs>): Promise<EncoreDispatchResult> {
  if (args.obligationId !== undefined) {
    // Amend path. EncoreDslInput.partial() validates each provided
    // field individually; handleAmend merges onto the existing DSL
    // and runs the full (non-partial) validator on the result.
    return handleAmend({ kind: "amendDefinition", obligationId: args.obligationId, definition: args.dsl });
  }
  // Setup path. handleSetup will require the full DSL via
  // EncoreDslInput.parse and 409 on slug collision.
  return handleSetup({ kind: "setup", definition: args.dsl });
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

/** Accept `definition` as either an object literal OR a JSON-encoded
 *  string of one. The LLM commonly JSON.stringify's tool-call
 *  arguments (especially for nested objects), and rejecting that
 *  shape with "expected object, received string" reads as a schema
 *  problem rather than a wire-format problem — the LLM tends to
 *  retry with the same shape. Silently coercing eliminates the
 *  whole class of mistake. The trade-off: a non-JSON string or a
 *  JSON string that decodes to a non-object surfaces with a clear
 *  400 instead of being silently dropped. */
function coerceDefinitionToObject(value: unknown, kind: string): Record<string, unknown> {
  let coerced = value;
  if (typeof coerced === "string") {
    try {
      coerced = JSON.parse(coerced);
    } catch (err) {
      throw new EncoreError(
        400,
        `${kind}: \`definition\` was provided as a string but is not valid JSON: ${err instanceof Error ? err.message : String(err)}. Pass an object literal, or a JSON-encoded string of one.`,
      );
    }
  }
  if (!coerced || typeof coerced !== "object" || Array.isArray(coerced)) {
    const actual = Array.isArray(coerced) ? "array" : coerced === null ? "null" : typeof coerced;
    throw new EncoreError(400, `${kind}: \`definition\` must be an object (or a JSON string of one), got ${actual}.`);
  }
  return coerced as Record<string, unknown>;
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
  throw new EncoreError(400, `manageEncore(${kind}): invalid args — ${summary}. See config/helps/encore-dsl.md for the call shape.`, {
    issues: result.error.issues,
  });
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
  if (kind === "unsnooze") return handleUnsnooze(safeParse(UnsnoozeArgs, body, kind));
  if (kind === "defineEncore") return handleDefineEncore(safeParse(DefineArgs, body, kind));
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
  // #22). The mutex also covers handler-side reconcile calls since
  // we run them from inside this same critical section.
  return withLock(() => dispatchInner(body));
}
