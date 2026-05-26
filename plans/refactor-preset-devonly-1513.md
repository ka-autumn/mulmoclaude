# Plan: dev-only preset plugins (#1513)

## Problem

`server/plugins/preset-list.ts` declares 7 preset plugins. Only `todo-plugin` and
`spotify-plugin` are intended for npm publish; the other 5 are either being
migrated to `mc-*` preset skills or are dev-only. On `npx mulmoclaude@latest`
the missing 5 currently produce `log.warn` lines (`preset package not
resolvable`) that scare users for what is actually expected behaviour.

## Approach

1. Add `devOnly?: boolean` to `PresetPlugin` (`preset-list.ts`).
2. Mark `worklog`, `client`, `invoice`, `debug`, `edgar` plugins as
   `devOnly: true` with a one-line rationale each.
3. In `preset-loader.ts:loadOnePreset`, when `resolvePresetRoot` returns null:
   - if `entry.devOnly`: `log.debug` only (silent in production).
   - else: keep the existing `log.warn`.
4. Update `loadOnePreset` signature to take the `PresetPlugin` entry instead of
   just the package name string so the `devOnly` flag is visible at the
   decision point. Adjust the caller in `loadPresetPlugins`.
5. Extend `test/plugins/test_preset_loader.ts`:
   - Assert that exactly two entries (`todo`, `spotify`) have
     `devOnly === undefined`/`false`; the other five have `devOnly === true`.
     This catches a future drift where someone adds an entry without thinking
     about the publish boundary.
6. No frontend / no UI change. No new i18n.

## Out of scope

- npm publish of `todo` / `spotify` plugins (B-2 follow-up).
- Retirement of plugins whose `mc-*` skill replacement is feature-complete.
