# Encore — lifecycle invariants

This document records the **non-negotiable rules** that the Encore
reconciler, tick, and dispatch handlers all rely on. Each rule has a
short rationale (the failure mode it prevents) and a pointer to the
code that enforces it today.

Treat this as the rulebook future refactors must keep intact. Most
classes of bug we have seen in Encore — duplicate-publish, orphaned
bells, dead chats, dropped clicks — come from one of these rules
quietly breaking.

If you are about to violate one of these, **stop and read the
rationale first**. Some of them have non-obvious failure modes that
only surface days later (orphan prune at 30d) or under crash
interleavings.

---

## 1. The reconciler owns the bell.

`reconcileCycleNotifications` is the **sole** owner of:
- `encoreNotifier.publish` (creating a bell entry)
- `encoreNotifier.clear` (removing a bell entry)
- ticket file writes and unlinks under `tickets/<pendingId>.json`

No other code path is allowed to call `encoreNotifier.publish` or
write a ticket. The reconciler re-derives the desired bell state from
disk on every call and reconciles to match — handlers don't patch bell
state; they write cycle facts and call the reconciler.

**Documented exceptions** (only two; do not add more without updating
this list):

- `handlers/resolveNotification.ts` → `handleOrphanResolve` calls
  `encoreNotifier.clear` directly when the user clicks a bell whose
  ticket was already swept. There is no ticket to reconcile against,
  so the reconciler cannot know the bell entry exists.
- `tick.ts` → `pruneOneTicket` clears bells for orphan tickets older
  than 30 days. This is age-based, not state-based, so it lives in
  the time-driven tick rather than the state-driven reconciler.

**Why**: handlers used to carry their own copies of trim/escalate
logic (snooze had a tick-skip workaround, amend had a bespoke wipe
path, `markStepDone` had a pendingId-walker). Those copies drifted —
duplicate-publish and stale-bell regressions traced back to one path
patching state while the other re-derived it.

**Enforced by**: `test/plugins/test_encore_reconcile.ts` greps for
forbidden notifier imports in handler files.

---

## 2. Every state mutation funnels through `persistAndReconcile`.

State-mutating handlers (`markStepDone`, `markTargetSkipped`,
`recordValues`, `snooze`, `unsnooze`) MUST funnel through
`persistAndReconcile` (`handlers/shared.ts`). That helper writes the
cycle file and immediately runs `reconcileCycleNotifications` under
the same lock.

Direct calls to `writeText(cycleFilePath(...), serializeCycleFile(...))`
in handler code, without a reconcile under the same lock, are
forbidden — they create state on disk that the bell doesn't reflect
until the next tick (up to one hour later).

`setup` and `amendDefinition` use the index-write path (not
`persistAndReconcile`), but each explicitly calls
`reconcileCycleNotifications` immediately after its `writeText`. Same
contract: writes are not visible to the user until the reconciler runs
on the same disk state.

**Why**: keeps cycle-file disk state and bell state in sync within a
single SSE turn. Without it, the user records a step but the bell
doesn't clear until the hourly tick.

---

## 3. The per-plugin lock covers mutation AND reconcile together.

`withLock` in `dispatch.ts` wraps each dispatch call. The reconcile
inside `persistAndReconcile` (and `handleSetup` / `handleAmend`) runs
under the same lock — not a separate critical section.

Two consequences that must be preserved:

- Two concurrent mutations can't race on `writeFileAtomic` against the
  same cycle file.
- A handler-side reconcile can't double-publish with the hourly
  heartbeat (`tick.ts` calls reconcile from the same per-plugin lock).

**Why**: the reconciler reads disk state, computes a diff against
tickets, and writes both bell and ticket state. Splitting that across
locks would let another writer interleave between the read and the
write, producing a stale-diff publish.

**Enforced by**: `lock.ts` exports one shared mutex; both
`dispatch.ts` and `tick.ts` use it.

---

## 4. Clear-before-unlink. Never the reverse.

When removing a ticket-bell pair, the bell clear MUST succeed before
the ticket is unlinked. If the clear fails, leave the ticket on disk
so the next reconcile or sweep can retry.

This is enforced consistently by `safeClearBell` (`reconcile.ts`):

```ts
if (await safeClearBell(ticket.notificationId, reason, log)) {
  await unlink(ticketPath(ticket.pendingId));
}
```

**Why**: an unlinked ticket with a still-live bell is an **orphan
bell** — visible in the bell UI but with no record pointing to it. The
next reconcile sees an un-fired (target, step) pair on the cycle file
and publishes a duplicate. The user sees two bells for one obligation.

The exception (clearing the bell BEFORE unlinking) is in `tick.ts` →
`pruneOneTicket`: an orphan ticket is by definition past its 30-day
horizon, and we want the bell gone even if the ticket survives.

---

## 5. Publish-then-write-or-rollback.

When publishing a fresh bell, the ticket write MUST succeed; if it
fails, the just-published bell entry MUST be cleared (rollback).

Both publish call-sites use the same pattern:

```ts
const { id: notificationId } = await encoreNotifier.publish(...);
try {
  await writeTicket(...);
} catch (err) {
  await safeClearBell(notificationId, "rollback: ...", log);
  throw err;
}
```

**Why**: a live bell with no matching ticket would be seen by the next
reconcile as "un-fired" (the cycle-file pair isn't covered by any
ticket), and a duplicate bell would be published.

---

## 6. A ticket asserts a live bell.

A ticket's existence on disk is a claim that a bell with that
`notificationId` is alive in the notifier. The reconciler validates
that claim every pass with `encoreNotifier.bellExists` — when the bell
has been dismissed out-of-band (host UI dismiss, crashed
`active.json`), the reconciler republishes at a new id using the
ticket's existing `pendingId`, `seedPrompt`, `createdAt`, and
`chatSessionId`.

**Why**: keeps manual bell-dismiss usable as a "see-it-next-tick"
gesture instead of permanently silencing the obligation. `snooze` is
the explicit verb for time-bound silence.

The republished entry's `notificationId` changes (the host always
assigns a new id); everything else on the ticket survives.

---

## 7. `chatSessionId` survives republish.

`chatSessionId` is the only ticket field that is NOT regeneratable
from disk. It binds the ticket to a user chat that the LLM is
participating in.

When the reconciler republishes a ticket (severity escalation, ghost
republish, bundle trim), it MUST preserve `chatSessionId`. The
republish patch in `clearAndRepublish` does this implicitly via
`{ ...ticket, notificationId: newId, severity: newSeverity, ... }`.

`resolveNotification`'s idempotency path (reuse existing
`chatSessionId` on double-click) depends on this — losing the field
would spawn a duplicate chat on every reconcile.

---

## 8. Cycle closure is derived, never stored.

`isCycleClosed` (in `closure.ts`) computes closure from
`state.records` — completed steps and skipped targets. There is no
`closed: true` flag on the cycle file.

When you add a new "step state" notion, add a predicate that reads
from `records`; do **not** denormalize a status field. Status flags
drift; predicates don't.

**Why**: status flags are the canonical source of stale-bell bugs.
Pre-refactor cycle files had `closed` + `lastPublishedSeverity`; both
could disagree with the records, and the disagreement was invisible
until a user saw an unexpected bell.

---

## 9. Immutable DSL fields.

`amendDefinition` rejects changes to:

- `id` (would desync directory name from `dsl.id`)
- `createdAt` (server-generated, not LLM-controlled)
- `type` (changes the validation discriminator and breaks prior
  cycle-file naming)
- `currency` on `type: "payment"` (would invalidate prior cycle
  records mid-life)
- `cadence.type` (changes cycle-file naming convention — `2026-05` vs
  `2026-W20` vs `2026-05-18`)

The retire-and-create path (set `status: "inactive"` on the old
obligation, `defineEncore` a new one) is the supported way to change
any of these.

Even when an LLM patch includes `id` or `createdAt` by mistake,
`handleAmend` force-restores the existing values rather than rejecting
the call — those mistakes are common and surface in the result.

---

## 10. The tick sweep covers non-latest cycles.

`reconcileCycleNotifications` only touches the obligation's latest
cycle (and a just-provisioned successor on cycle-close). Tickets on
older cycles can persist when `safeClearBell` had a transient failure
during the closing reconcile.

`tick.ts` → `sweepStuckTickets` walks `tickets/*.json` and reconciles
every `(obligationId, cycleId)` pair found there, regardless of
"latest". This is the retry path for prior clear failures.

**Why**: without it, a transient notifier hiccup at cycle-close would
leave a non-latest ticket+bell pair untouched until the 30-day prune.

---

## 11. Orphan prune is age-based and lives in `tick.ts`.

The 30-day orphan-prune in `tick.ts` → `pruneOrphanTickets` is the
last-resort cleanup for tickets that escaped every state-driven path
(e.g. cycle file manually deleted, host crashed mid-write). It is
age-based, not state-based, which is why it lives in the time-driven
tick rather than the state-driven reconciler.

Do NOT move this into the reconciler: the reconciler is called from
mutation paths with `now = new Date()` but its job is to make the bell
match disk state, not to garbage-collect by wall-clock age. Mixing
those concerns reintroduces the kind of drift this document exists to
prevent.

---

## Quick reference: where each rule is enforced

| Rule | Enforced in |
|---|---|
| 1. Reconciler owns the bell | `reconcile.ts`, `notifier.ts`, lint/test guard |
| 2. Mutation funnel | `handlers/shared.ts` → `persistAndReconcile` |
| 3. Lock covers both | `dispatch.ts` → `withLock`; `tick.ts` |
| 4. Clear-before-unlink | `reconcile.ts` → `safeClearBell` callers |
| 5. Publish-then-write-or-rollback | `reconcile.ts` → `fireGroup`, `clearAndRepublish` |
| 6. Ticket asserts live bell | `reconcile.ts` → `bellExists` check in `trimOrEscalateTicket` |
| 7. `chatSessionId` survives republish | `reconcile.ts` → `clearAndRepublish` spread |
| 8. Closure derived, not stored | `closure.ts`; cycle file shape |
| 9. Immutable DSL fields | `handlers/amend.ts` |
| 10. Sweep covers non-latest cycles | `tick.ts` → `sweepStuckTickets` |
| 11. Orphan prune is age-based | `tick.ts` → `pruneOrphanTickets` |
