# Lint policy — driving warnings toward zero

Read this when you encounter a `yarn lint` warning, are tempted to add an `eslint-disable`, or need to understand why a `vue/no-v-html` rule is intentionally suppressed instead of fixed.

`yarn lint` runs at error-strict for most rules. A handful are kept at `warn` because graduating them to error would force a noisy cleanup and risk regressions. **Treat warnings as a backlog, not a baseline.**

## Reduce warnings opportunistically

When you touch a file, fix any warnings in it that are mechanically safe (`prefer-destructuring` auto-fix, missing `return undefined`, etc.). Don't leave a warning behind in code you just edited.

## Per-line `eslint-disable-next-line` is intentional

When you see one with a `--` rationale (e.g. `vue/no-v-html`, `no-unmodified-loop-condition`, `no-script-url` test fixtures, `no-new` URL/Intl probes, `no-loop-func` Mocha closures), it has been audited. **Never remove these comments during refactors** — they encode a trust decision. If the surrounding code changes shape, port the disable to the new line; don't drop it.

## `vue/no-v-html` specifically

Every `v-html` in this repo (NewsView, markdown/View, spreadsheet/View, textResponse/View, wiki/View) feeds from `marked.parse` or `XLSX.utils.sheet_to_html` over app-owned data — all intentional, all suppressed at the call site. If you add a new `v-html`, audit the data source and add the same comment with a one-sentence rationale; do NOT silence the rule globally.

## Multi-line elements need the wrapping form

`eslint-disable-next-line` only reaches one line. Use a `<!-- eslint-disable <rule> -->` … `<!-- eslint-enable <rule> -->` pair around the element instead.
