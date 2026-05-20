# truncate() Consolidation (#1306)

## Problem

Multiple `truncate`-shaped functions exist across the codebase with subtle differences. After auditing each, only two are actual duplicates of the same intent (clip a string to a max length with a trailing ellipsis):

- `server/workspace/journal/dailyPass.ts:610` — `truncate(text, max)` with `…` suffix.
- `server/workspace/memory/migrate.ts:232` — `truncateForDescription(text)` is a composite of whitespace normalisation + truncation; its truncation part is the same shape.

A third `truncate` in `server/workspace/chat-index/summarizer.ts:99` is a **different** operation — it preserves both head and tail of a string for AI-context display (`head + "…" + tail`). It shares the name but not the semantics; the conceptual collision is what makes the codebase confusing.

The `truncateForDescription` site also has a subtle bug: it reserves 3 chars for the ellipsis (`slice(0, max - 3)`) but the actual ellipsis is the single char `…`, so the output is 2 chars short of the declared 120-char budget. The shared helper computes the budget correctly.

## Approach

1. **New `server/utils/text.ts`** with `truncate(text, max, ellipsis = "…")`. The ellipsis is part of the budget (`slice(0, max - ellipsis.length) + ellipsis`), so callers get an output of exactly `max` chars. Guards for `max <= 0` (return empty string) and `ellipsis.length >= max` (clip the ellipsis).
2. **Migrate `dailyPass.ts`** — drop the local function, import the shared one. Output byte-identical for the same input.
3. **Migrate `truncateForDescription`** — keep the function (it carries the whitespace-normalisation step that's specific to memory descriptions) but route the truncation through the shared helper. Output now respects the full 120-char budget (small correctness improvement).
4. **Rename `chat-index/summarizer.ts:99` `truncate` → `truncateMiddle`** so it's clear the head+tail-preserving variant is a different operation. Only one consumer (`test_summarizer.ts`); production code only uses the function internally. Behavioral change: zero.

## Out of scope

- `packages/mock-server/src/server.ts:134` — standalone package, separate lint scope.
- `packages/plugins/edgar-plugin/src/index.ts:38` — standalone package, inline impl with detailed suffix.
- `packages/bridges/email/src/index.ts:98` — standalone bridge, inline impl with `…(truncated)` suffix.

These could be migrated in a follow-up that creates a `@mulmobridge/text-helpers` peer dep or copies the helper into each package, but the cross-package coordination is heavier than the duplication cost today.

## Acceptance

- One shared helper at `server/utils/text.ts` with tests covering the boundary cases.
- `dailyPass.ts` + `memory/migrate.ts` use the shared helper.
- `summarizer.ts` `truncate` is renamed to `truncateMiddle`; one test import updated.
- Catalog (`docs/shared-utils.md`) lists `truncate` in the Strings / Text table; "open items" callout no longer mentions `truncate`.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- `dailyPass` callers see identical output for inputs that previously hit the truncate path (verified by inspection — same algorithm, same default ellipsis).
