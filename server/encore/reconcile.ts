// Encore reconciler — the sole owner of bell state.
//
// Every state-mutating handler funnels through `reconcileCycleNotifications`,
// and the time-driven tick walks all obligations through the same call. This
// is the ONLY production code path that invokes `encoreNotifier.publish` /
// `encoreNotifier.clear` and writes/unlinks tickets — the one
// documented exception is `handleOrphanResolve` in dispatch.ts (recovery
// path for a click that lost its ticket).
//
// Re-deriving from disk on every call is intentional: each handler used to
// patch bell state with its own copy of the trim/escalate logic, and the
// copies drifted (snooze had to skip the tick to avoid double-publish; amend
// needed a bespoke wipe path; markStepDone had a pendingId-walker). One
// reconciler removes all three workarounds because the unifying predicate
// `isPairInBundle` treats closed AND snoozed as out-of-bundle.

import { randomUUID } from "node:crypto";
import path from "node:path";

import { log as defaultLog } from "../system/logger/index.js";
import { compareIsoDates, formatCycleId, isoDate, nextSlot, type CycleSlot } from "../../src/types/encore-dsl/cadence.js";
import { parseAtExpression } from "../../src/types/encore-dsl/at-expression.js";
import { resolveAtExpression } from "../../src/types/encore-dsl/at-resolver.js";
import type { EncoreDsl, Severity, StepDef } from "../../src/types/encore-dsl/schema.js";
import { parseIndexFile } from "./obligation.js";
import { buildCycleState, isStepSnoozed, parseCycleFile, serializeCycleFile, type CycleState, type TargetRecord } from "./cycle.js";
import { isCycleClosed, isStepClosed } from "./closure.js";
import { cycleFilePath, obligationDir, obligationIndexPath, ticketPath, TICKETS_DIRNAME } from "./paths.js";
import { exists, readDir, readTextOrNull, writeText, unlink } from "../utils/files/encore-io.js";
import * as encoreNotifier from "./notifier.js";
import type { Ticket } from "./tick.js";

export interface ReconcileDeps {
  obligationId: string;
  /** Specific cycle the caller just mutated. Omitted (tick path) →
   *  the latest cycle on disk. */
  cycleId?: string;
  now: Date;
  log?: typeof defaultLog;
}

/** Single entry point. Re-derive desired bell state from disk and
 *  reconcile to match. Safe to call concurrently only under the
 *  per-plugin lock (see `lock.ts`). */
export async function reconcileCycleNotifications(deps: ReconcileDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const todayIso = isoDate(deps.now);
  const nowIso = deps.now.toISOString();

  const dsl = await loadDsl(deps.obligationId);
  if (!dsl) return;

  if (dsl.status !== "active") {
    await clearAllForObligation(deps.obligationId, "obligation inactive", log);
    return;
  }

  const primary = await loadPrimaryCycle(deps.obligationId, deps.cycleId);
  if (!primary) return;

  // `amendDefinition` used to set `invalidateAllBells: true` here to
  // force every ticket+bell to be cleared and republished — the trim
  // path couldn't republish a title-only edit because state hadn't
  // moved. With the notifier engine's `update` op, the trim path now
  // detects title/body drift directly and patches each bell in place
  // (same notificationId, no history record). The flag and the
  // `clearAllForCycle` helper it owned have been removed.
  await reconcileOneCycle(dsl, primary.state, todayIso, nowIso, log);

  // Cycle-close transition. If the primary cycle is now closed
  // (handler closed the last step, or the tick saw closure happen
  // naturally), provision (or reuse) its successor and reconcile
  // that too — same dispatch turn, same lock, no second tick wait.
  if (isCycleClosed(primary.state, dsl)) {
    const successor = await provisionSuccessor(dsl, primary.state, log);
    if (successor) {
      await reconcileOneCycle(dsl, successor.state, todayIso, nowIso, log);
    }
  }
}

// ── loaders ───────────────────────────────────────────────────────

async function loadDsl(obligationId: string): Promise<EncoreDsl | null> {
  const raw = await readTextOrNull(obligationIndexPath(obligationId));
  if (raw === null) return null;
  try {
    return parseIndexFile(raw).dsl;
  } catch {
    return null;
  }
}

interface PrimaryCycle {
  rel: string;
  state: CycleState;
  body: string;
}

async function loadPrimaryCycle(obligationId: string, hint: string | undefined): Promise<PrimaryCycle | null> {
  const cycleId = hint ?? (await pickLatestCycleId(obligationId));
  if (!cycleId) return null;
  const rel = cycleFilePath(obligationId, cycleId);
  const raw = await readTextOrNull(rel);
  if (raw === null) return null;
  try {
    const { state, body } = parseCycleFile(raw);
    return { rel, state, body };
  } catch {
    return null;
  }
}

async function pickLatestCycleId(obligationId: string): Promise<string | null> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  if (cycleFiles.length === 0) return null;
  return cycleFiles[cycleFiles.length - 1].replace(/\.md$/, "");
}

// ── unified "is this (target, step) pair currently in any bundle?" ──

/** The load-bearing predicate. A pair belongs in a bundle iff the
 *  step is OPEN (not closed) AND not currently snoozed. Both the
 *  trim phase (existing ticket → still-live targets) and the publish
 *  phase (un-fired pairs → eligible to fire) consult this. The
 *  pre-reconciler code had two parallel checks that diverged: snooze
 *  was special-cased in the publish path (`isStepEligibleToFire`)
 *  but ignored on the trim path (`maybeEscalate`), so a snooze had
 *  to skip the tick entirely to avoid re-publishing the entry it
 *  had just cleared. */
function isPairInBundle(record: TargetRecord | undefined, step: StepDef, nowIso: string): boolean {
  if (isStepClosed(record, step)) return false;
  if (isStepSnoozed(record, step.id, nowIso)) return false;
  return true;
}

// ── one-cycle reconcile (phase 1 + phase 2) ───────────────────────

async function reconcileOneCycle(dsl: EncoreDsl, state: CycleState, todayIso: string, nowIso: string, log: typeof defaultLog): Promise<void> {
  const tickets = await ticketsForCycle(dsl.id ?? "", state.cycleId);

  // Phase 1: trim or escalate existing tickets. Anything covered by
  // a still-live ticket is OFF the publish-eligibility list for
  // Phase 2 (we don't want to publish a duplicate while the existing
  // entry is still up).
  const coveredKeys = new Set<string>();
  for (const ticket of dedupeTickets(tickets)) {
    const survivor = await trimOrEscalateTicket(dsl, state, ticket, todayIso, nowIso, log);
    if (survivor) {
      for (const targetId of survivor.targets) {
        coveredKeys.add(`${ticket.stepId}:${targetId}`);
      }
    }
  }

  // Phase 2: publish for un-fired, in-bundle (target, step) pairs.
  const unfired = collectUnfired(dsl, state, coveredKeys, todayIso, nowIso);
  for (const group of groupForBundling(unfired)) {
    await fireGroup(dsl, state, group, log);
  }
}

// ── Phase 1: trim or escalate ─────────────────────────────────────

interface TicketSurvivor {
  targets: string[];
}

/** Recompute the still-live target set for this ticket; rewrite,
 *  escalate, or clear as appropriate. Returns the survivor's target
 *  set so Phase 2 can know which (step, target) pairs are already
 *  covered. */
async function trimOrEscalateTicket(
  dsl: EncoreDsl,
  state: CycleState,
  ticket: Ticket,
  todayIso: string,
  nowIso: string,
  log: typeof defaultLog,
): Promise<TicketSurvivor | null> {
  const stepDef = dsl.steps.find((step) => step.id === ticket.stepId);
  if (!stepDef) {
    // Step no longer exists in the DSL (e.g., amend dropped it).
    // Clear the bell and unlink the ticket so we don't leak. If the
    // clear failed, keep the ticket on disk so the next reconcile
    // retries — unlinking an un-cleared bell would orphan it.
    if (await safeClearBell(ticket.notificationId, "step removed", log)) {
      await unlink(ticketPath(ticket.pendingId));
    }
    return null;
  }

  const liveTargets = ticket.targets.filter((targetId) => isPairInBundle(state.records[targetId], stepDef, nowIso));

  if (liveTargets.length === 0) {
    if (await safeClearBell(ticket.notificationId, "bundle drained", log)) {
      await unlink(ticketPath(ticket.pendingId));
    }
    return null;
  }

  const phase = currentPhaseFor(stepDef, state, todayIso);
  const newSeverity = phase?.severity ?? ticket.severity;
  const members = liveTargets.map((targetId) => ({ targetId }));
  const desiredTitle = bundleTitle(dsl, stepDef, members);
  const desiredBody = bundleBody(dsl, stepDef, members);

  // Ghost-ticket detection. The reconciler historically treated
  // ticket-existence as proof of bell-existence, so a bell dismissed
  // out-of-band by the host UI (or wiped by a crashed active.json)
  // stayed gone until severity escalation or the 30-day orphan
  // prune. Cross-checking the notifier here lets the next tick
  // republish using the ticket's existing pendingId / seedPrompt /
  // chatSessionId — the user sees the bell again, the chat
  // continuity survives, and manual dismiss becomes a "see it next
  // tick" gesture rather than an accidental silencer. `snooze` is
  // still the explicit verb for time-bound silence.
  const bellAlive = await encoreNotifier.bellExists(ticket.notificationId);
  if (!bellAlive) {
    await refreshGhostTicket({ dsl, state, ticket, stepDef, liveTargets, newSeverity, desiredTitle, desiredBody, log });
    return { targets: liveTargets };
  }

  // Drift detection. Title / body drift surfaces every kind of
  // content-only DSL edit (`amendDefinition` rewriting a
  // `displayName`, a target rename, a bundle shrinking to a count
  // that changes the rendered text). Severity drift surfaces phase
  // escalation. Either way the response is an in-place update —
  // same notificationId, no history pollution, no flicker.
  //
  // Tickets written before this build don't carry `title` / `body`,
  // so the !== checks read both as "always different on first
  // sight". The first reconcile pass after the upgrade therefore
  // calls `update` once per ticket (idempotent on the bell — host
  // active.json is rewritten with the same values; only the ticket
  // file gains the missing fields) and subsequent passes short-
  // circuit.
  const severityDrift = newSeverity !== ticket.severity;
  const titleDrift = ticket.title !== desiredTitle;
  const bodyDrift = ticket.body !== desiredBody;
  const targetsChanged = liveTargets.length !== ticket.targets.length;

  if (severityDrift || titleDrift || bodyDrift) {
    await updateBellInPlace({ dsl, state, ticket, stepDef, liveTargets, newSeverity, desiredTitle, desiredBody, log });
    return { targets: liveTargets };
  }

  if (targetsChanged) {
    // Rare branch — target list shrunk but the formatters render
    // the same title/body. Persist the trimmed target list so the
    // ticket stays consistent with cycle state. No bell update
    // needed since presentation didn't change.
    await writeTicket({ ...ticket, targets: liveTargets, title: desiredTitle, body: desiredBody });
    log.info("encore", "reconcile: trimmed bundle (no content drift)", {
      pendingId: ticket.pendingId,
      notificationId: ticket.notificationId,
      remaining: liveTargets,
    });
    return { targets: liveTargets };
  }

  return { targets: liveTargets };
}

interface ReconcileRefreshArgs {
  dsl: EncoreDsl;
  state: CycleState;
  ticket: Ticket;
  stepDef: StepDef;
  liveTargets: string[];
  newSeverity: Severity;
  desiredTitle: string;
  desiredBody: string;
  log: typeof defaultLog;
}

/** Update a still-live bell entry in place — same notificationId,
 *  fresh severity / title / body. No clear, no republish, no
 *  history record. Used for the common case where an obligation's
 *  DSL changed (most often via `amendDefinition`) or a phase
 *  escalation pushed severity up.
 *
 *  The on-disk ticket is rewritten to reflect the new state so the
 *  next reconcile's drift check short-circuits. */
async function updateBellInPlace(args: ReconcileRefreshArgs): Promise<void> {
  const { dsl, state, ticket, stepDef, liveTargets, newSeverity, desiredTitle, desiredBody, log } = args;
  await encoreNotifier.update(ticket.notificationId, { severity: newSeverity, title: desiredTitle, body: desiredBody });
  await writeTicket({ ...ticket, severity: newSeverity, title: desiredTitle, body: desiredBody, targets: liveTargets });
  log.info("encore", "reconcile: bell updated in place", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: stepDef.id,
    notificationId: ticket.notificationId,
    fromSeverity: ticket.severity,
    toSeverity: newSeverity,
  });
}

/** Bring back a bell that was dismissed out-of-band. The bell is
 *  gone, so we publish a fresh entry at a new notificationId; the
 *  ticket's pendingId / seedPrompt / chatSessionId / createdAt
 *  carry over so the user lands in the same chat conversation on
 *  click. With `update`, this is the ONLY reason the trim path
 *  still allocates a new notificationId — every other refresh
 *  (severity escalation, title amend, body drift) goes through
 *  `updateBellInPlace` and keeps the original id stable. */
async function refreshGhostTicket(args: ReconcileRefreshArgs): Promise<void> {
  const { dsl, state, ticket, stepDef, liveTargets, newSeverity, desiredTitle, desiredBody, log } = args;
  const navigateTarget = encoreUrlFor(ticket.pendingId);
  const { id: newId } = await encoreNotifier.publish({ severity: newSeverity, title: desiredTitle, body: desiredBody, navigateTarget });
  try {
    await writeTicket({ ...ticket, notificationId: newId, severity: newSeverity, title: desiredTitle, body: desiredBody, targets: liveTargets });
  } catch (err) {
    await safeClearBell(newId, "rollback: ticket write failed after ghost-ticket republish", log);
    throw err;
  }
  log.info("encore", "reconcile: ghost-ticket republish", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: stepDef.id,
    fromNotificationId: ticket.notificationId,
    toNotificationId: newId,
  });
}

function dedupeTickets(tickets: Ticket[]): Ticket[] {
  const seen = new Set<string>();
  const out: Ticket[] = [];
  for (const ticket of tickets) {
    if (seen.has(ticket.pendingId)) continue;
    seen.add(ticket.pendingId);
    out.push(ticket);
  }
  return out;
}

// ── Phase 2: un-fired collection + publish ────────────────────────

interface UnfiredPair {
  targetId: string;
  stepId: string;
  stepDef: StepDef;
  severity: Severity;
  fireDate: string;
}

function collectUnfired(dsl: EncoreDsl, state: CycleState, coveredKeys: Set<string>, todayIso: string, nowIso: string): UnfiredPair[] {
  const out: UnfiredPair[] = [];
  for (const target of dsl.targets) {
    const record = state.records[target.id];
    if (record?.skipped) continue;
    for (const step of dsl.steps) {
      if (coveredKeys.has(`${step.id}:${target.id}`)) continue;
      if (!isPairInBundle(record, step, nowIso)) continue;
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
  const ticket: Ticket = {
    pendingId,
    obligationId: dsl.id ?? "",
    cycleId: state.cycleId,
    notificationId,
    stepId: group.stepId,
    targets: group.members.map((member) => member.targetId),
    severity: group.severity,
    title,
    body,
    seedPrompt: buildSeedPrompt(dsl, group, pendingId, state.cycleId),
    createdAt: new Date().toISOString(),
  };
  // Roll back the just-published bell entry if the ticket write
  // fails — without rollback the bell would be live with no ticket,
  // and the next reconcile would re-publish a duplicate.
  try {
    await writeTicket(ticket);
  } catch (err) {
    await safeClearBell(notificationId, "rollback: ticket write failed after publish", log);
    throw err;
  }
  log.info("encore", "reconcile: published bundled notification", {
    obligationId: dsl.id,
    cycleId: state.cycleId,
    stepId: group.stepId,
    severity: group.severity,
    targets: group.members.map((member) => member.targetId),
    notificationId,
    pendingId,
  });
}

// ── successor provisioning ────────────────────────────────────────

async function provisionSuccessor(dsl: EncoreDsl, state: CycleState, log: typeof defaultLog): Promise<{ state: CycleState } | null> {
  const slot = slotFromCycleId(dsl.cadence, state.cycleId);
  if (!slot) {
    log.warn("encore", "reconcile: could not parse cycleId for next slot", { obligationId: dsl.id, cycleId: state.cycleId });
    return null;
  }
  const next = nextSlot(dsl.cadence, slot);
  const nextRel = cycleFilePath(dsl.id ?? "", formatCycleId(next));
  if (!(await exists(nextRel))) {
    await writeText(nextRel, serializeCycleFile(buildCycleState(dsl, next), ""));
    log.info("encore", "reconcile: provisioned next cycle", { obligationId: dsl.id, fromCycleId: state.cycleId, toCycleId: formatCycleId(next) });
  }
  const nextRaw = await readTextOrNull(nextRel);
  if (nextRaw === null) return null;
  try {
    const parsed = parseCycleFile(nextRaw);
    return { state: parsed.state };
  } catch {
    return null;
  }
}

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

// ── clear-all helpers ─────────────────────────────────────────────

async function clearAllForObligation(obligationId: string, reason: string, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(TICKETS_DIRNAME);
  let cleared = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(TICKETS_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    let ticket: Ticket;
    try {
      ticket = JSON.parse(raw) as Ticket;
    } catch {
      continue;
    }
    if (ticket.obligationId !== obligationId) continue;
    // Only unlink the ticket if the bell clear succeeded; otherwise
    // a transient notifier failure would orphan the host bell entry.
    // Leaving the ticket lets the next reconcile retry.
    if (await safeClearBell(ticket.notificationId, reason, log)) {
      await unlink(rel);
      cleared += 1;
    }
  }
  if (cleared > 0) log.info("encore", "reconcile: cleared all for obligation", { obligationId, reason, cleared });
}

// ── phase eval ────────────────────────────────────────────────────

interface ResolvedPhase {
  severity: Severity;
  fireDate: string;
}

function currentPhaseFor(stepDef: StepDef, cycleState: CycleState, todayIso: string): ResolvedPhase | null {
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
      break;
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
    `- kind: "snooze" — defer the bell entry (default 24h).`,
    `- kind: "unsnooze" — re-enable a previously snoozed step before its timer expires.`,
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

async function writeTicket(ticket: Ticket): Promise<void> {
  await writeText(ticketPath(ticket.pendingId), JSON.stringify(ticket, null, 2));
}

async function ticketsForCycle(obligationId: string, cycleId: string): Promise<Ticket[]> {
  const entries = await readDir(TICKETS_DIRNAME);
  const out: Ticket[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readTextOrNull(path.join(TICKETS_DIRNAME, entry));
    if (!raw) continue;
    try {
      const ticket = JSON.parse(raw) as Ticket;
      if (ticket.obligationId === obligationId && ticket.cycleId === cycleId) {
        out.push(ticket);
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** Try to clear the bell entry. Returns `true` on success, `false`
 *  on failure (logged). Callers MUST consult the return value before
 *  destructive follow-ups (unlinking the ticket, republishing at a
 *  new id, etc.); swallowing a clear failure and proceeding would
 *  orphan the host bell entry — the pre-refactor escalation aborted
 *  on clear failure for exactly this reason. */
async function safeClearBell(notificationId: string, reason: string, log: typeof defaultLog): Promise<boolean> {
  try {
    await encoreNotifier.clear(notificationId);
    return true;
  } catch (err) {
    log.warn("encore", "reconcile: notifier.clear failed", { reason, notificationId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function encoreUrlFor(pendingId: string): string {
  return `/encore?pendingId=${encodeURIComponent(pendingId)}`;
}
