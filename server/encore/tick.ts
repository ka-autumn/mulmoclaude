// Encore tick — the DSL interpreter over data-only cycle state.
//
// Each tick, for every `active` obligation:
//
//   1. Read DSL (index.md). Pick the current cycle file (latest by
//      name). If derivation says it's closed (closure.ts), provision
//      the next cycle file and operate on that — no separate
//      `state.status` flag is consulted.
//   2. Read pending-clear/*.json filtered to this obligation+cycle.
//      One ticket = one live bell entry; their `targets[]` and
//      `stepId` tell us which (target, step) pairs are already
//      published. (The cycle file no longer mentions notification
//      ids.)
//   3. For each existing ticket: compute the step's current phase;
//      if its severity differs from the ticket's `severity`,
//      escalate (clear+republish) and rewrite the ticket.
//   4. For each (target, step) that is NOT closed (via closure.ts)
//      AND not covered by any ticket: compute the current phase; if
//      one fires, collect into a bundle group keyed by
//      (stepId, severity, fireDate).
//   5. Each bundle group becomes one published notification + one
//      ticket. Multi-target → one ding.
//   6. Prune orphan tickets older than 30 days.
//
// The tick NEVER calls chat.start — chat creation is deferred to the
// user's bell click via the /encore page (View.vue dispatches
// resolveNotification on mount). The tick also never writes a
// `status` flag; the cycle file is purely user-recorded data.

import { randomUUID } from "node:crypto";
import path from "node:path";

import { log as defaultLog } from "../system/logger/index.js";
import { ONE_HOUR_MS } from "../utils/time.js";
import { compareIsoDates, formatCycleId, isoDate, nextSlot, type CycleSlot } from "./dsl/cadence.js";
import { parseAtExpression } from "./dsl/at-expression.js";
import { resolveAtExpression } from "./dsl/at-resolver.js";
import type { EncoreDsl, Severity, StepDef } from "./dsl/schema.js";
import { parseIndexFile } from "./obligation.js";
import { buildCycleState, parseCycleFile, serializeCycleFile, type CycleState } from "./cycle.js";
import { isCycleClosed, isStepClosed } from "./closure.js";
import { cycleFilePath, obligationDir, obligationIndexPath, pendingClearPath, PENDING_CLEAR_DIRNAME, OBLIGATIONS_DIRNAME } from "./paths.js";
import { exists, readDir, readTextOrNull, writeText, unlink } from "../utils/files/encore-io.js";
import * as encoreNotifier from "./notifier.js";

const ORPHAN_TICKET_AGE_MS = 30 * 24 * ONE_HOUR_MS; // 30 days

export interface TickDeps {
  now: Date;
  log?: typeof defaultLog;
}

/** Shape of a pending-clear ticket on disk. Authoritative record
 *  of every live Encore bell entry: which obligation+cycle+step it
 *  belongs to, which targets it covers, what severity it was
 *  published at (used for escalation diff), and the seed prompt
 *  resolveNotification will use to start the chat on user click. */
export interface PendingClearTicket {
  pendingId: string;
  obligationId: string;
  cycleId: string;
  notificationId: string;
  stepId: string;
  /** Target ids covered by this bundled notification. */
  targets: string[];
  /** Severity at last publish — used as the escalation-diff
   *  baseline. The cycle file used to carry
   *  `lastPublishedSeverity`; that moved here when status flags
   *  were removed. */
  severity: Severity;
  seedPrompt: string;
  createdAt: string;
  /** Filled by resolveNotification on first bell click. Subsequent
   *  clicks reuse it (idempotent). */
  chatSessionId?: string;
}

export async function runTick(deps: TickDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const todayIso = isoDate(deps.now);

  const obligationIds = await readDir(OBLIGATIONS_DIRNAME);
  for (const obligationId of obligationIds) {
    try {
      await tickOneObligation(obligationId, todayIso, log);
    } catch (err) {
      log.warn("encore", "tick: obligation failed", { obligationId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await pruneOrphanTickets(deps.now, log);
}

async function tickOneObligation(obligationId: string, todayIso: string, log: typeof defaultLog): Promise<void> {
  const indexRaw = await readTextOrNull(obligationIndexPath(obligationId));
  if (indexRaw === null) return;
  const { dsl } = parseIndexFile(indexRaw);
  if (dsl.status !== "active") return;

  const opened = await ensureOpenCycle(obligationId, dsl, log);
  if (!opened) return;
  const { state } = opened;

  // Pull every ticket that covers this obligation+cycle so we know
  // which (target, step) pairs already have a live bell entry.
  const tickets = await ticketsForCycle(obligationId, state.cycleId);
  const activeByStepTarget = new Map<string, PendingClearTicket>();
  for (const ticket of tickets) {
    for (const targetId of ticket.targets) {
      activeByStepTarget.set(`${ticket.stepId}:${targetId}`, ticket);
    }
  }

  // Phase 1: escalate existing notifications when current phase
  // severity differs from the ticket's recorded severity. The
  // cycle file is untouched (it carries user-data only; bell
  // state lives in the ticket).
  for (const ticket of dedupeTickets(tickets)) {
    await maybeEscalate(dsl, state, ticket, todayIso, log);
  }

  // Phase 2: publish for un-fired, not-closed (target, step) pairs.
  const unfired = collectUnfired(dsl, state, activeByStepTarget, todayIso);
  for (const group of groupForBundling(unfired)) {
    await fireGroup(dsl, state, group, log);
  }
}

/** Pick the obligation's latest cycle file. If it's closed (per
 *  closure derivation), provision the next cycle and return that
 *  instead. Returns null if the obligation has no cycle files at
 *  all (shouldn't happen — setup writes the first). */
async function ensureOpenCycle(
  obligationId: string,
  dsl: EncoreDsl,
  log: typeof defaultLog,
): Promise<{ cycleRel: string; state: CycleState; body: string } | null> {
  const latest = await pickCurrentCycle(obligationId);
  if (!latest) return null;
  const raw = await readTextOrNull(latest);
  if (raw === null) return null;
  const { state, body } = parseCycleFile(raw);

  if (!isCycleClosed(state, dsl)) {
    return { cycleRel: latest, state, body };
  }

  // Closed → provision the next cycle (if not already on disk) and
  // operate on it instead. This is where "stuck obligations"
  // unstick: the closure is derived, so even cycles that closed
  // under the old shape (or that never had status flags set
  // explicitly) get a successor on the next tick.
  const slot = slotFromCycleId(dsl.cadence, state.cycleId);
  if (!slot) {
    log.warn("encore", "tick: could not parse cycleId for next-slot", { obligationId, cycleId: state.cycleId });
    return null;
  }
  const next = nextSlot(dsl.cadence, slot);
  const nextRel = cycleFilePath(obligationId, formatCycleId(next));
  if (!(await exists(nextRel))) {
    await writeText(nextRel, serializeCycleFile(buildCycleState(dsl, next), ""));
    log.info("encore", "tick: provisioned next cycle", { obligationId, fromCycleId: state.cycleId, toCycleId: formatCycleId(next) });
  }
  const nextRaw = await readTextOrNull(nextRel);
  if (nextRaw === null) return null;
  const nextParsed = parseCycleFile(nextRaw);
  return { cycleRel: nextRel, state: nextParsed.state, body: nextParsed.body };
}

async function pickCurrentCycle(obligationId: string): Promise<string | null> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  if (cycleFiles.length === 0) return null;
  return path.join(obligationDir(obligationId), cycleFiles[cycleFiles.length - 1]);
}

/** Cycle id → slot. Reverse of `formatCycleId`. */
function slotFromCycleId(cadence: EncoreDsl["cadence"], cycleId: string): CycleSlot | null {
  if (cadence.type === "annual") {
    const year = Number.parseInt(cycleId, 10);
    if (!Number.isFinite(year)) return null;
    return { kind: "annual", year };
  }
  if (cadence.type === "biannual") {
    const match = cycleId.match(/^(\d{4})-h([12])$/);
    if (!match) return null;
    return { kind: "biannual", year: Number.parseInt(match[1], 10), half: Number.parseInt(match[2], 10) as 1 | 2 };
  }
  if (cadence.type === "monthly") {
    const match = cycleId.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return { kind: "monthly", year: Number.parseInt(match[1], 10), month: Number.parseInt(match[2], 10) };
  }
  if (cadence.type === "weekly") {
    const match = cycleId.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;
    return { kind: "weekly", year: Number.parseInt(match[1], 10), week: Number.parseInt(match[2], 10) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleId)) return null;
  return { kind: "daily", iso: cycleId };
}

// ── escalation ────────────────────────────────────────────────────

function dedupeTickets(tickets: PendingClearTicket[]): PendingClearTicket[] {
  const seen = new Set<string>();
  const out: PendingClearTicket[] = [];
  for (const ticket of tickets) {
    if (seen.has(ticket.pendingId)) continue;
    seen.add(ticket.pendingId);
    out.push(ticket);
  }
  return out;
}

async function maybeEscalate(dsl: EncoreDsl, state: CycleState, ticket: PendingClearTicket, todayIso: string, log: typeof defaultLog): Promise<boolean> {
  const stepDef = dsl.steps.find((step) => step.id === ticket.stepId);
  if (!stepDef) return false;
  // Use the first still-open target as the reference for anchoring
  // step deadlines (they share the same step.deadline expression).
  const liveTarget = ticket.targets.find((targetId) => !isStepClosed(state.records[targetId], stepDef));
  if (!liveTarget) {
    // Every target in the bundle has closed — the handler-side
    // ticket trimming should have already run, but if a heartbeat
    // races ahead of `clearPendingNotification`, clean up here.
    await encoreNotifier.clear(ticket.notificationId);
    await unlink(pendingClearPath(ticket.pendingId));
    log.info("encore", "tick: cleared fully-resolved bundle", { pendingId: ticket.pendingId, notificationId: ticket.notificationId });
    return true;
  }
  const phase = currentPhaseFor(stepDef, state, todayIso);
  if (!phase || phase.severity === ticket.severity) return false;

  // Severity transition → clear + republish, rewrite ticket.
  await encoreNotifier.clear(ticket.notificationId);
  const navigateTarget = encoreUrlFor(ticket.pendingId);
  const liveMembers = ticket.targets.filter((targetId) => !isStepClosed(state.records[targetId], stepDef)).map((targetId) => ({ targetId }));
  const title = bundleTitle(dsl, stepDef, liveMembers);
  const body = bundleBody(dsl, stepDef, liveMembers);
  const { id: newId } = await encoreNotifier.publish({ severity: phase.severity, title, body, navigateTarget });
  await writeTicket({ ...ticket, notificationId: newId, severity: phase.severity, targets: liveMembers.map((entry) => entry.targetId) });
  log.info("encore", "tick: escalated notification", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: stepDef.id,
    from: ticket.severity,
    to: phase.severity,
    notificationId: newId,
  });
  return true;
}

// ── un-fired collection + bundling ────────────────────────────────

interface UnfiredPair {
  targetId: string;
  stepId: string;
  stepDef: StepDef;
  severity: Severity;
  fireDate: string;
}

function collectUnfired(dsl: EncoreDsl, state: CycleState, activeByStepTarget: Map<string, PendingClearTicket>, todayIso: string): UnfiredPair[] {
  const out: UnfiredPair[] = [];
  for (const target of dsl.targets) {
    const record = state.records[target.id];
    if (record?.skipped) continue;
    for (const step of dsl.steps) {
      if (isStepClosed(record, step)) continue;
      if (activeByStepTarget.has(`${step.id}:${target.id}`)) continue;
      const phase = currentPhaseFor(step, state, todayIso);
      if (!phase) continue;
      out.push({ targetId: target.id, stepId: step.id, stepDef: step, severity: phase.severity, fireDate: phase.fireDate });
    }
  }
  return out;
}

interface BundleGroup {
  stepId: string;
  stepDef: StepDef;
  severity: Severity;
  fireDate: string;
  members: { targetId: string }[];
}

function groupForBundling(unfired: UnfiredPair[]): BundleGroup[] {
  const byKey = new Map<string, BundleGroup>();
  for (const pair of unfired) {
    const key = `${pair.stepId} ${pair.severity} ${pair.fireDate}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push({ targetId: pair.targetId });
    } else {
      byKey.set(key, {
        stepId: pair.stepId,
        stepDef: pair.stepDef,
        severity: pair.severity,
        fireDate: pair.fireDate,
        members: [{ targetId: pair.targetId }],
      });
    }
  }
  return [...byKey.values()];
}

async function fireGroup(dsl: EncoreDsl, state: CycleState, group: BundleGroup, log: typeof defaultLog): Promise<void> {
  const pendingId = randomUUID();
  const navigateTarget = encoreUrlFor(pendingId);
  const title = bundleTitle(dsl, group.stepDef, group.members);
  const body = bundleBody(dsl, group.stepDef, group.members);

  const { id: notificationId } = await encoreNotifier.publish({ severity: group.severity, title, body, navigateTarget });

  const ticket: PendingClearTicket = {
    pendingId,
    obligationId: dsl.id ?? "",
    cycleId: state.cycleId,
    notificationId,
    stepId: group.stepId,
    targets: group.members.map((member) => member.targetId),
    severity: group.severity,
    seedPrompt: buildSeedPrompt(dsl, group, pendingId, state.cycleId),
    createdAt: new Date().toISOString(),
  };
  await writeTicket(ticket);

  log.info("encore", "tick: fired bundled notification", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: group.stepId,
    severity: group.severity,
    targets: group.members.map((member) => member.targetId),
    notificationId,
    pendingId,
  });
}

// ── phase eval ────────────────────────────────────────────────────

interface ResolvedPhase {
  severity: Severity;
  fireDate: string;
}

function currentPhaseFor(stepDef: StepDef, cycleState: CycleState, todayIso: string): ResolvedPhase | null {
  // Resolve the step's own deadline first (step.deadline can't use
  // step-deadline anchor — only firingPlan phases can).
  let stepDeadline: string;
  try {
    stepDeadline = resolveAtExpression(parseAtExpression(stepDef.deadline, { allowStepDeadline: false }), {
      cycleStart: cycleState.cycleStart,
      cycleDeadline: cycleState.cycleDeadline,
    });
  } catch {
    return null;
  }
  const anchors = { cycleStart: cycleState.cycleStart, cycleDeadline: cycleState.cycleDeadline, stepDeadline };
  let latest: ResolvedPhase | null = null;
  for (const phase of stepDef.firingPlan) {
    let resolved: string;
    try {
      resolved = resolveAtExpression(parseAtExpression(phase.at, { allowStepDeadline: true }), anchors);
    } catch {
      continue;
    }
    if (compareIsoDates(resolved, todayIso) <= 0) {
      latest = { severity: phase.severity, fireDate: resolved };
    } else {
      break; // firingPlan is chronological; nothing later fires
    }
  }
  return latest;
}

// ── titles + bodies + seed prompts ────────────────────────────────

function bundleTitle(dsl: EncoreDsl, stepDef: StepDef, members: { targetId: string }[]): string {
  if (members.length === 1) {
    const [{ targetId }] = members;
    const target = dsl.targets.find((entry) => entry.id === targetId);
    return `${dsl.displayName} — ${stepDef.displayName} (${target?.displayName ?? targetId})`;
  }
  return `${dsl.displayName} — ${stepDef.displayName} (${members.length} targets)`;
}

function bundleBody(dsl: EncoreDsl, _stepDef: StepDef, members: { targetId: string }[]): string {
  if (members.length === 1) return "";
  return members
    .map((member) => {
      const target = dsl.targets.find((entry) => entry.id === member.targetId);
      return target?.displayName ?? member.targetId;
    })
    .join(", ");
}

function buildSeedPrompt(dsl: EncoreDsl, group: BundleGroup, pendingId: string, cycleId: string): string {
  const targetLines = group.members
    .map((member) => {
      const target = dsl.targets.find((entry) => entry.id === member.targetId);
      return `- ${target?.displayName ?? member.targetId} (id: ${member.targetId})`;
    })
    .join("\n");
  const fieldList = group.stepDef.fields.length === 0 ? "(no fields to record for this step)" : group.stepDef.fields.map((name) => `- ${name}`).join("\n");
  const firstTargetId = group.members[0]?.targetId ?? "<targetId>";
  const obligationId = dsl.id ?? "";
  const exampleCall = JSON.stringify(
    {
      kind: "markStepDone",
      pendingId,
      obligationId,
      cycleId,
      targetId: firstTargetId,
      stepId: group.stepId,
      values: Object.fromEntries(group.stepDef.fields.map((name) => [name, "<value>"])),
    },
    null,
    2,
  );
  return [
    `An Encore reminder for the obligation "${dsl.displayName}" (id: ${obligationId}, cycle: ${cycleId}).`,
    "",
    `Step: ${group.stepDef.displayName} (id: ${group.stepId})`,
    `Severity: ${group.severity}. Fire date: ${group.fireDate}.`,
    "",
    `Targets covered by this notification:`,
    targetLines,
    "",
    `Fields to collect on each target's record:`,
    fieldList,
    "",
    `Help the user record what happened, then call manageEncore — ONCE PER TARGET — with one of:`,
    `- kind: "markStepDone" — step is complete (pass field values via \`values\`).`,
    `- kind: "markTargetSkipped" — user is skipping this target for this cycle.`,
    `- kind: "recordValues" — partial info only, no closing.`,
    `- kind: "snooze" — defer the bell entry.`,
    "",
    `Call-shape rules (the parser will 400 on these common mistakes):`,
    `- \`targetId\` is SINGULAR (a string), NOT \`targetIds\` (array). If the notification covers multiple targets, make one call per target.`,
    `- \`values\` is a FLAT field-map: \`{ fieldName: value, ... }\`. NEVER nest it by target id (\`{ <targetId>: { ... } }\` is wrong).`,
    `- Always pass \`pendingId\`, \`obligationId\`, and \`cycleId\` as shown below — they're what clears the bell entry when the cycle progresses.`,
    "",
    `Example for ${firstTargetId}:`,
    "```json",
    exampleCall,
    "```",
  ].join("\n");
}

// ── ticket I/O ────────────────────────────────────────────────────

async function writeTicket(ticket: PendingClearTicket): Promise<void> {
  await writeText(pendingClearPath(ticket.pendingId), JSON.stringify(ticket, null, 2));
}

/** Read all pending-clear tickets that match (obligationId,
 *  cycleId). Tolerates unparsable entries (skipped silently;
 *  pruneOrphanTickets cleans them up eventually). */
async function ticketsForCycle(obligationId: string, cycleId: string): Promise<PendingClearTicket[]> {
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  const out: PendingClearTicket[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readTextOrNull(path.join(PENDING_CLEAR_DIRNAME, entry));
    if (!raw) continue;
    try {
      const ticket = JSON.parse(raw) as PendingClearTicket;
      if (ticket.obligationId === obligationId && ticket.cycleId === cycleId) {
        out.push(ticket);
      }
    } catch {
      continue;
    }
  }
  return out;
}

async function pruneOrphanTickets(now: Date, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(PENDING_CLEAR_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(PENDING_CLEAR_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    let ticket: PendingClearTicket;
    try {
      ticket = JSON.parse(raw) as PendingClearTicket;
    } catch {
      await unlink(rel);
      continue;
    }
    const ageMs = now.getTime() - new Date(ticket.createdAt).getTime();
    if (ageMs > ORPHAN_TICKET_AGE_MS) {
      log.info("encore", "tick: pruning orphan ticket", { pendingId: ticket.pendingId, ageMs });
      await unlink(rel);
    }
  }
}

function encoreUrlFor(pendingId: string): string {
  return `/encore?pendingId=${encodeURIComponent(pendingId)}`;
}
