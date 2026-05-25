# Backend-offline banner + retry (#1479)

Frontend-only UX hardening so the user notices when the backend goes
down (currently silent: only console errors).

## Design

- `src/utils/api.ts` already returns `{ ok:false, status:0 }` on
  network errors (existing convention; used per-feature in several
  callers). Centralise that signal:
  - Export a module-level `backendReachable: Ref<boolean>` (default
    `true`).
  - `apiCall`: on `status:0` → `backendReachable.value = false`; on
    any successful response → `true`. Eager: surfaces backend-down
    immediately from whichever fetch the user triggered (no 15s
    health-poll wait).
- New `src/components/BackendOfflineBanner.vue`:
  - Renders only when `!backendReachable`.
  - Copy: title + "server may be down — check it is running" + the
    last error message (small).
  - **Retry** button: calls `fetchHealth()` from `useHealth`.
    Success flips the signal back to true (already wired through
    `apiCall`), and the banner hides automatically.
- `src/App.vue`: mount the banner near the top of the root layout
  (above the workspace content).

## i18n (all 8 locales, lockstep)

- `backendOffline.title` — "Can't reach the backend"
- `backendOffline.body` — "The MulmoClaude server may not be running. Check the dev server, then retry."
- `backendOffline.retry` — "Retry"

## Tests

- Unit: small test for the `backendReachable` flip semantics
  (success → true, status:0 → false). Pure module-level state, so a
  spy on `fetch` is enough.
- e2e: route-mock `/api/health` (and a session fetch) to fail with
  `route.abort('connectionrefused')` → assert
  `data-testid="backend-offline-banner"` visible. Then re-mock health
  to succeed and click Retry → banner disappears.

## Out of scope

- Granular reconnect UX (auto-poll on failure, exponential backoff).
- WebSocket-specific banner (the WS layer has its own reconnect; the
  banner only reflects HTTP reachability via `apiCall`).

## Acceptance

- Backend stopped → first user-triggered fetch (or the next 15s
  health poll, whichever lands first) surfaces the banner.
- Retry actually re-checks and hides the banner on success.
- 8 locales updated; cheatsheet brief updated; format/lint/typecheck/
  build/test/e2e clean.
