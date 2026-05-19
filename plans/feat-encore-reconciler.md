# Encore: unified reconciler + `unsnooze` action

## Problem

Encore's dispatch handlers and the periodic tick each carry their own copy of "what bell state should exist for this obligation right now?" logic. The two paths drift, with `snooze` as the worst offender:

- **`handleSnooze`** writes `snoozedSteps[stepId]` on the cycle file, then **manually** calls `dropTargetFromMatchingTickets` + `safeClearBell` to remove the matching bell entry — and **deliberately skips** `tickUnlocked`, because if it kicked the tick, the tick wouldn't trim the now-snoozed target from the bundle. (`maybeEscalate` only trims when `isStepClosed(...)` is true; it doesn't consider snooze.)
- **`handleMarkStepDone` / `handleMarkTargetSkipped`** persist the cycle state and then call `clearPendingNotification(pendingId, …)` — a handler-side bell trimmer that walks the matching ticket by `pendingId`, filters out closed targets, and clears the bell when the bundle empties. This duplicates what the tick's `maybeEscalate` already knows how to compute from cycle state.
- **`handleAmendDefinition`** calls `resetActiveNotificationsForObligation` to nuke every ticket for the current cycle, then kicks the tick to republish with the amended display name. A third bell-manipulation path with its own contract.

Three concrete problems fall out:

1. **No `unsnooze`.** Once a user has clicked "Snooze 24h" on a bell, there's no API to unsnooze before the timestamp expires. The only escape hatches today are `markStepDone` (falsely closes the step), `markTargetSkipped` (falsely closes the target), or hand-editing the cycle file.
2. **Snooze's "no tick" is load-bearing.** The comment in `handleSnooze` admits the workaround: "DO NOT kick the tick — the bell is cleared and the snooze marker is in place; running runTick now would just check the marker and skip, so it's wasted work." That's the symptom of the tick not understanding snooze on the trim/clear side.
3. **`amendDefinition` needs special-case bell wiping.** Trimming-by-state isn't enough when the DSL text changed (display name renamed, step label rewritten); the existing tickets need to be republished even though no `(target, step)` pair closed.

## Approach

One reconciler. One place that decides whether each obligation/cycle should have bell entries, what their severity should be, and what targets they should list. Every state-mutating handler funnels through it.

### `server/encore/reconcile.ts` (new)

`reconcileCycleNotifications({ obligationId, cycleId?, now, invalidateAllBells?, log })` is **the only code path** allowed to call `encoreNotifier.publish` / `encoreNotifier.clear` or write/unlink pending-clear tickets. It re-derives the desired bell state from disk:

1. Load DSL. If `status !== "active"`, clear every bell+ticket for the obligation and stop.
2. Load the primary cycle (the hinted one, or the obligation's current cycle).
3. Reconcile that cycle's bells (Phase 1: trim/escalate existing tickets; Phase 2: publish for un-fired pairs).
4. If the primary cycle is now closed, provision (or reuse) its successor and reconcile that too — the same path handles both "handler closed the last step" and "tick saw a cycle close naturally" cycle transitions.

Key invariant — the "in-bundle" predicate is unified across phases:

```ts
function isPairInBundle(record, step, nowIso) {
  if (isStepClosed(record, step)) return false;
  if (isStepSnoozed(record, step.id, nowIso)) return false;
  return true;
}
```

That's the symmetry the current code lacks: **snoozed and closed are both out-of-bundle**, so a snoozed target trims out of its ticket the same way a closed one does. When all targets in a bundle are closed-or-snoozed, the bell clears.

### `server/encore/tick.ts` (rewritten as thin shell)

`runTick` becomes: walk every obligation directory, call `reconcileCycleNotifications(obligationId, …)`, then prune orphan tickets older than 30 days. No bell logic of its own. The tick is just the time-driven invoker; the reconciler is the brain.

### `server/encore/dispatch.ts` (handlers refactored)

Every state-mutating handler follows one shape — mutate cycle state, then call `persistAndReconcile`:

```ts
async function persistAndReconcile(rel, state, body, obligationId, cycleId) {
  await writeText(rel, serializeCycleFile(state, body));
  await reconcileCycleNotifications({ obligationId, cycleId, now: new Date(), log });
}
```

Per-handler simplifications:

- **`handleMarkStepDone` / `handleMarkTargetSkipped`** — drop `clearPendingNotification`; the reconciler trims the ticket from state.
- **`handleSnooze`** — drop `dropTargetFromMatchingTickets` + `safeClearBell`. Write `snoozedSteps[stepId]`, reconcile, done. The "no tick" workaround disappears with it.
- **`handleAmendDefinition`** — drop `resetActiveNotificationsForObligation`. Pass `invalidateAllBells: true` to the reconciler; it clears every ticket for the cycle and republishes with fresh DSL text.
- **`handleSetup`** — keep cycle provisioning, but kick the reconciler instead of `tickUnlocked` so the first firingPlan phase surfaces in the same SSE turn.
- **`handleRecordValues`** — now also calls `persistAndReconcile` for uniformity even though values changes never affect bells (reconciler is a no-op for that mutation). No special-case handler.

### New `unsnooze` dispatch kind

```ts
const UnsnoozeArgs = z.object({
  kind: z.literal("unsnooze"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  stepId: z.string(),
});
```

Inverse of `snooze`: delete `snoozedSteps[stepId]` from the target's record (via a new `recordStepUnsnooze` pure mutator in `cycle.ts`), call reconcile. The reconciler sees the pair is once again eligible to fire (assuming it's not also closed) and the un-fired pass publishes a fresh bell — **in the same dispatch turn**, no tick wait. Add to `LLM_ENCORE_KINDS` so the LLM can invoke it.

### Helpers added to `cycle.ts`

- `recordStepUnsnooze(state, targetId, stepId)` — idempotent. No-op if the entry was already absent.
- `isStepSnoozed(record, stepId, nowIso)` — shared predicate; reconciler uses it both for "should this bundle target trim?" and "is this un-fired pair eligible to fire?"

### Cycle-close transition

The reconciler needs to handle one subtle case the original tick handled implicitly: when a handler closes the last open step of a cycle, the just-closed cycle's tickets must be trimmed AND the successor cycle must be provisioned. `loadPrimaryCycle` always returns the named cycle (whether open or closed); after reconciling it, if `isCycleClosed(state, dsl)` is now true, `provisionSuccessor` provisions (or reuses) the next cycle file and the successor is reconciled too. This is what the pre-refactor handler chain (`persistAndKickTick` → `clearPendingNotification`-by-`pendingId`) did across two paths; the unified reconciler does it in one.

## Out of scope

- **The 24-hour snooze default** stays hardcoded. A separate change can let the LLM (or a future Snooze-UI affordance) request 1h / 1d / 1wk.
- **Browser-side "Snooze 24h" button** on the bell that bypasses the LLM. Currently the LLM has to invoke `snooze` from inside a bell-seeded chat; a direct dispatch would close the loop faster but is a frontend change orthogonal to this server work.
- **`/api/encore` per-kind JSON Schema** in the MCP tool definition (currently the `parameters` only declares `kind`, with `additionalProperties: true`). Tightening it so the LLM gets per-kind hints — especially `cycleId: { type: "string" }` for the annual-cycle "2026" gotcha — is its own follow-up. See discussion in #1431 thread.
- **`PendingClearTicket` schema changes** (e.g. storing rendered title/body to detect DSL drift autonomously, instead of relying on `invalidateAllBells`). Out of scope for this PR; the flag is sufficient.

## Acceptance

- Every existing component test in `test/plugins/test_encore_dispatch.ts` keeps passing — including the two-target bundle invariant and the cycle-close-provisions-successor invariant.
- **New reconciler-level tests** in `test/plugins/test_encore_reconcile.ts` (state in, state out, no SSE):
  1. **Trim symmetry** — bundle with two targets, one closed + one snoozed → both trim, bell clears. This is the load-bearing invariant the refactor rests on.
  2. **Idempotency** — `reconcile` → `reconcile` with no state change between → second call makes zero notifier calls. Guards against bell-flicker regressions.
  3. **Cycle-close transition** — closing the last open step in a handler-driven reconcile → just-closed cycle's tickets clear AND successor is provisioned AND reconciled in the same call.
  4. **Snooze expiry** — `snoozedSteps[stepId]` with a past timestamp → treated as not-snoozed, pair fires.
  5. **`invalidateAllBells: true`** — existing tickets cleared and republished with fresh DSL text (covers the `amendDefinition` path).
  6. **Inactive status** — DSL `status !== "active"` → every bell + ticket for the obligation cleared, no republish.
- **New dispatch-level tests** extending `test/plugins/test_encore_dispatch.ts`:
  7. `unsnooze` republishes the bell in the same dispatch turn (no tick wait).
  8. `unsnooze` on a step that wasn't snoozed is a no-op that doesn't flicker the existing bell.
  9. `snooze` → `unsnooze` round-trip in one chat — bell present, gone, present.
  10. Static guard test — assert no production code under `server/encore/` outside `reconcile.ts` and `handleOrphanResolve` imports/calls `encoreNotifier`. Programmatic enforcement of the grep guarantee below.
- `dispatch.ts` no longer contains `dropTargetFromMatchingTickets`, `safeClearBell` calls from non-orphan paths, `resetActiveNotificationsForObligation`, or `clearPendingNotification` — these helpers are deleted, not just unused.
- Grep guarantee: `grep -rn "encoreNotifier\.\(publish\|clear\)" server/encore/` returns only:
  - `server/encore/reconcile.ts` (production state-driven path), plus
  - `server/encore/notifier.ts` (the wrapper that owns the host calls), plus
  - two documented "ticket about to disappear, sweep the bell" exceptions: `handleOrphanResolve` in `dispatch.ts` (click landed after ticket was swept) and `pruneOneTicket` in `tick.ts` (30-day age-based orphan sweep). Both clear the host bell before unlinking the stale ticket so the next reconcile doesn't see "un-fired" and publish a duplicate.
- `LLM_ENCORE_KINDS` in `src/plugins/encore/definition.ts` includes `unsnooze`; the bell-seed prompt in `reconcile.ts` mentions it alongside `snooze` so the LLM knows it's available.
- All checks pass: `yarn format`, `yarn lint`, `yarn typecheck`, `yarn test`, `yarn build`.

## Dependencies

- PR #1430 (`feat/personal-role`) — introduces `ENCORE_SEED_ROLE_ID` and the Personal role that owns `manageEncore`. The reconciler PR builds on top; either merge order works as long as both land before any chat tries to call `unsnooze` from a non-Personal role.
