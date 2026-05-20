# errorMessage() Migration (#1305)

## Problem

The pattern `err instanceof Error ? err.message : String(err)` is inlined ~31 times across `server/` and `src/`, even though the canonical helper `errorMessage(err, fallback?)` has existed in `server/utils/errors.ts` (and `src/utils/errors.ts` for Vue) since the early DRY audit.

Beyond duplication, the inline pattern misses the helper's two extra cases:

- gRPC-style `{ code, details, metadata }` errors — the inline path collapses them to `[object Object]`; the helper surfaces `details`.
- Plain `{ message: string }` objects (Anthropic SDK errors, fetch envelopes) — same story.

So the inline copies aren't just stylistically off; they're functionally worse.

## Approach

Migrate all qualifying call sites to `errorMessage(err)` from the matching `utils/errors.ts` (server-side or src-side).

**Server side (15 sites)** — straight import + replace, no name collisions.

**Vue side (8 sites)** — most refs are named `error` / `bookLoadError` / `toggleError`, no collision. One file (`src/plugins/photoLocations/View.vue`) names its ref `errorMessage`, so import as `toErrorMessage` to avoid shadowing.

## Out of scope

- The `err instanceof Error ? err : new Error(String(err))` pattern (3 sites in `src/composables/`) builds an `Error` object rather than a string. Different intent. Could be a `toError()` helper in a follow-up if it spreads, but 3 sites is below the threshold.
- The `err.name === "AbortError"` shape check in `server/plugins/runtime.ts:207` is a different concern (timeout detection), not normalization. Left alone.
- 45 inline patterns in `packages/` — each package has its own lint scope and would need its own helper or a peer dep. Out of scope; follow-up if needed.

## Acceptance

- 0 occurrences of `err instanceof Error ? err.message : String(err)` in `server/` and `src/` (excluding the comments inside `errors.ts` itself, which describe the deprecated pattern).
- `docs/shared-utils.md` Errors section lists both `server/utils/errors.ts` and `src/utils/errors.ts`.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.

## Catalog update

The meta PR (#1311 / #1304) listed only the server-side helper. This PR adds the frontend mirror to the Errors section of `docs/shared-utils.md` — same-PR catalog discipline the rule mandates.
