# Accounting Amount Formatting (#1308)

## Problem and scope reduction

The original issue called out:
1. `accounting/Preview.vue` re-implementing 2-decimal `toLocaleString` despite `accounting/currencies.ts` already exporting a `formatAmount`.
2. `spreadsheet/engine/formatter.ts` having multiple `toFixed` sites that don't share dispatch with `currencies.ts`.

After audit:

### Preview.vue: real duplication, narrow fix

`Preview.vue` has its own `formatAmount(value)` (currency-agnostic, hardcoded 2 decimals) because the JSON envelopes it renders (`profitLoss.netIncome`, `balanceSheet.sections[i].total`) don't carry currency codes on the data path. The shared `currencies.ts.formatAmount(value, currency, locale?)` requires currency, so it can't be a drop-in.

**Fix**: add `formatAmountNumeric(value, decimals = 2)` to `currencies.ts` — a currency-agnostic numeric formatter for exactly this case. Preview migrates to it. Reduces the name collision (two `formatAmount`s) and centralises the format spec.

### The JPY-shows-decimals concern is bigger than this PR

The original issue flagged that Preview shows `100.00` even for JPY (where 0 decimals is correct). That fix needs the currency code to reach Preview's data path — a JSON envelope shape change, possibly threading book context through the dispatch. That's structural, not formatting; out of scope here. Tracked separately if/when prioritised.

### Spreadsheet formatter: already centralised

`spreadsheet/engine/formatter.ts` has 4 `toFixed` calls inside a switch over format kinds (`number` / `percent` / `accounting`). They're already in one file under one dispatcher. Extracting an intermediate `formatNumeric({ kind, value, decimals, locale })` would be cosmetic — same code, same control flow, one extra indirection. Skipped. Reopen if a third format kind shows up.

### Out of scope

- Currency-aware Preview rendering (data-path threading).
- Spreadsheet formatter intermediate dispatcher.
- Spotify plugin date/number formatting in `packages/` (separate package scope).

## Approach

1. Add `formatAmountNumeric(value, decimals = 2)` to `src/plugins/accounting/currencies.ts`. One line. Comment documents when to prefer this vs. the currency-aware `formatAmount`.
2. Migrate `Preview.vue` — import + replace both call sites + drop the local function.
3. Tests at `test/plugins/accounting/test_currencies.ts` — covers `formatAmountNumeric` (default 2 decimals, custom 0, negative, zero) and asserts the existing `formatAmount` honours `fractionDigitsFor(JPY) === 0`.
4. Catalog NOT updated — `accounting/currencies.ts` is plugin-local, the catalog's scope is cross-cutting helpers only.

## Acceptance

- `formatAmountNumeric` exported from `currencies.ts` with tests.
- `Preview.vue` uses it, no local `formatAmount` function.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- Preview rendering unchanged for the same input (the new helper has identical behaviour to the old inline form).
