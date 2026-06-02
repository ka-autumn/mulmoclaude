# Plan: dev-only preset plugins (#1513)

## Problem

`server/plugins/preset-list.ts` declares preset plugins, but only `todo-plugin`
and `spotify-plugin` are intended for npm publish; the rest (`debug`, `edgar`)
are dev-only. On `npx mulmoclaude@latest` the missing ones currently produce
`log.warn` lines (`preset package not resolvable`) that scare users for what
is actually expected behaviour.

(While this PR was in flight, `main` 089e52a6 deleted the
worklog / client / invoice legacy plugins entirely — they are now fully
replaced by mc-* schema-driven collection skills. The preset list after that
merge has exactly 4 entries: todo, spotify, debug, edgar.)

## Approach

1. Add `devOnly?: boolean` to `PresetPlugin` (`preset-list.ts`).
2. Mark `debug` and `edgar` as `devOnly: true` with a one-line rationale each.
3. In `preset-loader.ts:loadOnePreset`, when `resolvePresetRoot` returns null:
   - if `entry.devOnly`: `log.debug` only (silent in production).
   - else: keep the existing `log.warn`.
4. Update `loadOnePreset` signature to take the `PresetPlugin` entry instead of
   just the package name string so the `devOnly` flag is visible at the
   decision point. Adjust the caller in `loadPresetPlugins`.
5. Extend `test/plugins/test_preset_loader.ts`:
   - Assert that exactly two entries (`todo`, `spotify`) have
     `devOnly === undefined`/`false`; the others have `devOnly === true`.
     This catches a future drift where someone adds an entry without thinking
     about the publish boundary.
6. No frontend / no UI change. No new i18n.

## Out of scope

- npm publish of `todo` / `spotify` plugins (B-2 follow-up).
- Retirement of plugins whose `mc-*` skill replacement is feature-complete.
