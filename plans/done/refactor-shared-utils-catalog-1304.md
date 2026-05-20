# Shared Utilities Catalog (#1304)

## Problem

The same conceptual helper keeps getting re-implemented across the codebase. Concrete examples surfaced by the recent audit:

- `truncate()` — 6 separate implementations (different signatures, different ellipsis behaviour, two of them off-by-one against their declared `max`).
- `err instanceof Error ? err.message : String(err)` — 31 inline copies, even though `errorMessage()` has lived in `server/utils/errors.ts` since the early DRY audit.
- `formatBytes()` — 2 declared copies + 1 inline calculation in ChatInput, with different rounding rules.
- Date display — 5 plugin Views calling `toLocaleString()` directly while `src/utils/format/date.ts` already exports the canonical helpers.

The root cause is **discoverability**: contributors writing a new helper don't grep for an existing one because they don't know to. Documenting the helpers in one catalog file (and adding one short rule to `CLAUDE.md`) makes the existing infrastructure visible without forcing every new contributor to read the whole tree.

## Approach

1. Land a thin meta PR that establishes the prevention mechanism:
   - `docs/shared-utils.md` — catalog grouped by area (Time / Errors / Network / Files / Strings / Markdown / Plugin infra / Regex / Logging / i18n). Each entry: path, helper signature, one-line "when to use". Only documents helpers that **already exist** — does not promise any new ones.
   - `CLAUDE.md` — ~5 lines under the existing "Key Rules" pointing at the catalog. Rule: check the catalog before writing a new helper; append a 1-line entry when adding a new shared helper in the same PR.
   - `docs/README.md` — add the catalog entry under "Developers".
2. Open follow-up issues for each scattered-feature consolidation (#1305-#1309). Each follow-up PR appends its new helper to `docs/shared-utils.md` in the same commit.

## Why a catalog rather than auto-generated doc

A docs page surfaces the **decision** ("use this for X") that a generated file can't. Auto-generation would surface every exported function, including ones that are not meant to be reached for cross-cutting needs. The catalog is curated and short by design.

## Out of scope

- Actually migrating any of the scattered call sites — those land in #1305-#1309.
- Splitting `CLAUDE.md` into smaller files — out of scope here; the new rule is small enough not to motivate that work.
- Auto-generation tooling for the catalog — keep manual until the catalog actually drifts.

## Acceptance

- `docs/shared-utils.md` exists, lists at minimum: time / errors / asyncHandler / WORKSPACE_PATHS / files-io / `attachment-store` mime helpers / network helpers / marked helpers / external-link composable / plugin META aggregators / regex / logger / i18n.
- `CLAUDE.md` has a short subsection (≤8 lines) pointing at the catalog with the "append in the same PR" rule.
- `docs/README.md` indexes the catalog under "Developers".
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- No code changes outside docs + CLAUDE.md.

## After merge

Open #1305 (errorMessage migration) as the first follow-up. The catalog entry for `errorMessage` is already in this meta PR, so the migration PR has nothing extra to add.
