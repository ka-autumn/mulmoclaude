// Encore tick — time-driven invoker for the reconciler.
//
// The tick used to carry its own copy of trim/escalate/publish logic.
// That moved into `reconcile.ts` (the sole owner of bell state). The
// tick is now a thin walker:
//
//   1. For every obligation directory, reconcile the latest cycle.
//   2. Sweep stuck tickets — reconcile any (obligationId, cycleId)
//      pair found in tickets/ that step 1 didn't cover. This
//      retries clear failures on closed/non-latest cycles, which
//      step 1 alone would skip (it only picks the latest cycle).
//   3. Prune orphan tickets older than 30 days.
//
// `Ticket` still lives here because dispatch.ts, reconcile.ts, and
// the host UI all import the type — keeping it adjacent to the on-disk
// shape (the only consumer is `tickets/*.json`) makes the locus of
// schema changes obvious.

import path from "node:path";

import { log as defaultLog } from "../system/logger/index.js";
import { ONE_DAY_MS } from "../utils/time.js";
import type { Severity } from "../../src/types/encore-dsl/schema.js";
import { TICKETS_DIRNAME, OBLIGATIONS_DIRNAME } from "./paths.js";
import { readDir, readDirSubdirs, readTextOrNull, unlink } from "../utils/files/encore-io.js";
import * as encoreNotifier from "./notifier.js";
import { reconcileCycleNotifications } from "./reconcile.js";

const ORPHAN_TICKET_AGE_MS = 30 * ONE_DAY_MS;

export interface TickDeps {
  now: Date;
  log?: typeof defaultLog;
}

/** Shape of a ticket on disk. Authoritative record of every live
 *  Encore bell entry: which obligation+cycle+step it belongs to,
 *  which targets it covers, what severity it was published at
 *  (used for escalation diff), and the seed prompt
 *  resolveNotification will use to start the chat on user click.
 *
 *  A ticket's existence asserts that a matching bell is alive and
 *  awaiting a `clear` operation. Tickets are regeneratable cache
 *  for everything except `chatSessionId` (the binding to a user's
 *  open chat); a sweep of `tickets/*.json` plus the matching bell
 *  entries leaves the system in a recoverable state — the
 *  reconciler rebuilds from cycle files on the next tick. */
export interface Ticket {
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
  /** Title and body as last rendered to the bell — the drift
   *  baseline. Trim path compares these against `bundleTitle` /
   *  `bundleBody` recomputed from the current DSL; if either has
   *  drifted (most commonly via `amendDefinition` editing a
   *  `displayName`), the path calls `notifier.update` in place
   *  instead of clear-then-publish. Optional on the wire so
   *  tickets written by pre-update-API builds load cleanly — they
   *  are treated as "always drifted" on first sight, which causes
   *  an idempotent in-place update to the bell and a ticket
   *  rewrite that backfills the fields. */
  title?: string;
  body?: string;
  seedPrompt: string;
  createdAt: string;
  /** Filled by resolveNotification on first bell click. Subsequent
   *  clicks reuse it (idempotent). */
  chatSessionId?: string;
}

export async function runTick(deps: TickDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const obligationIds = await readDirSubdirs(OBLIGATIONS_DIRNAME);
  for (const obligationId of obligationIds) {
    try {
      await reconcileCycleNotifications({ obligationId, now: deps.now, log });
    } catch (err) {
      log.warn("encore", "tick: reconcile failed", { obligationId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await sweepStuckTickets(new Set(obligationIds), deps.now, log);
  await pruneOrphanTickets(deps.now, log);
}

// ── stuck-ticket sweep (Phase 2) ──────────────────────────────────
//
// The per-obligation reconcile above only touches the obligation's
// latest cycle (and its just-provisioned successor on cycle-close).
// A ticket on a NON-latest cycle never gets revisited there — which
// matters because `safeClearBell` failures are intentionally
// non-destructive: when the clear fails, the reconciler keeps the
// ticket so a later attempt can retry. Without this sweep, that
// "later attempt" would never come for tickets on closed cycles
// (until the 30-day age-based prune).
//
// This sweep collects every (obligationId, cycleId) pair present in
// tickets/ and reconciles each. It overlaps Phase 1 for the
// latest cycle, but reconcile is idempotent (proven by the
// "idempotency" test in test_encore_reconcile.ts) so the redundancy
// is cheap and the contract stays simple.

async function sweepStuckTickets(knownObligationIds: Set<string>, now: Date, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(TICKETS_DIRNAME);
  const pairsToReconcile = await collectStuckCyclePairs(entries, knownObligationIds);
  for (const pair of pairsToReconcile) {
    try {
      await reconcileCycleNotifications({ obligationId: pair.obligationId, cycleId: pair.cycleId, now, log });
    } catch (err) {
      log.warn("encore", "tick: stuck-ticket sweep failed", {
        obligationId: pair.obligationId,
        cycleId: pair.cycleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function collectStuckCyclePairs(entries: string[], knownObligationIds: Set<string>): Promise<{ obligationId: string; cycleId: string }[]> {
  const seen = new Set<string>();
  const out: { obligationId: string; cycleId: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const raw = await readTextOrNull(path.join(TICKETS_DIRNAME, entry));
    if (!raw) continue;
    let ticket: Ticket;
    try {
      ticket = JSON.parse(raw) as Ticket;
    } catch {
      continue;
    }
    // Skip tickets pointing at obligations that no longer exist on
    // disk — those get cleaned up by the age-based prune below.
    if (!knownObligationIds.has(ticket.obligationId)) continue;
    const key = `${ticket.obligationId}::${ticket.cycleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ obligationId: ticket.obligationId, cycleId: ticket.cycleId });
  }
  return out;
}

// ── orphan ticket sweep (time-driven, lives here not in reconcile) ──
//
// Orphan tickets are records older than 30 days that somehow weren't
// trimmed by reconcile (e.g. the cycle file was deleted manually,
// or a host crash left a ticket without its bell counterpart). The
// sweep is age-based, not state-based, so it belongs with the
// time-driven tick rather than the state-driven reconciler.

async function pruneOneTicket(rel: string, raw: string, now: Date, log: typeof defaultLog): Promise<void> {
  let ticket: Ticket;
  try {
    ticket = JSON.parse(raw) as Ticket;
  } catch {
    await unlink(rel);
    return;
  }
  const ageMs = now.getTime() - new Date(ticket.createdAt).getTime();
  if (ageMs <= ORPHAN_TICKET_AGE_MS) return;
  log.info("encore", "tick: pruning orphan ticket", { pendingId: ticket.pendingId, ageMs });
  // Clear the host bell entry BEFORE unlinking the ticket. Otherwise
  // the bell entry stays visible but the ticket is gone — next tick
  // treats the step as un-fired and publishes a duplicate while the
  // stale entry is still up.
  try {
    await encoreNotifier.clear(ticket.notificationId);
  } catch (err) {
    log.warn("encore", "tick: prune-bell-clear failed", { notificationId: ticket.notificationId, error: err instanceof Error ? err.message : String(err) });
  }
  await unlink(rel);
}

async function pruneOrphanTickets(now: Date, log: typeof defaultLog): Promise<void> {
  const entries = await readDir(TICKETS_DIRNAME);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = path.join(TICKETS_DIRNAME, entry);
    const raw = await readTextOrNull(rel);
    if (!raw) continue;
    await pruneOneTicket(rel, raw, now, log);
  }
}
