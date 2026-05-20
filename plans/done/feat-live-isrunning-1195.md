# feat: expose narrow `liveIsRunning` predicate (#1195)

## Problem

`GET /api/sessions` summary `isRunning` is the BROAD predicate
(`live.isRunning || pendingGenerations.length > 0`) but
`DELETE /api/sessions/:id`'s 409 gate is the NARROW one
(`getSession()?.isRunning` only). No public field exposes the
narrow predicate, so cleanup-style callers
(`e2e-live waitForSessionIdle`) over-wait on lingering
pendingGenerations even though DELETE is already safe — up to a
30s timeout of wasted wall time per spec.

## Fix (issue option A)

Add an additive, optional `liveIsRunning` field to
`SessionSummary` that is byte-identical to the DELETE gate. Leave
the broad `isRunning` (and its sidebar-indicator semantics)
untouched.

### Changes

1. `server/api/routes/sessions.ts`
   - `SessionSummary.liveIsRunning?: boolean`
   - `buildSessionSummary`: `summary.liveIsRunning = live.isRunning`
2. `src/types/session.ts` — mirror the field (i18n/type lockstep)
3. `e2e-live/fixtures/live-chat.ts`
   - `probeSessionIdle` polls `liveIsRunning` not `isRunning`
   - refresh the predicate-asymmetry block comment + the
     `deleteSession` inline note

## Non-goals

- No change to existing callers' behavior (purely additive field;
  `isRunning` semantics preserved for the sidebar busy indicator).
- No unit test for `buildSessionSummary` — it's a non-exported
  internal helper and the predicate is one line; the daily
  e2e-live no-LLM matrix exercises `waitForSessionIdle` →
  `liveIsRunning` on every spec's cleanup, which is the real
  integration surface. Adding an export/mocked-store unit test
  would be disproportionate (matches the existing repo pattern —
  no `buildSessionSummary` unit test exists today).

## Verification

- `yarn typecheck` / `yarn lint` green
- daily `e2e-live` matrix cleanup now polls the exact DELETE gate
  → no over-wait on pendingGenerations
