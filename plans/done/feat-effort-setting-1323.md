# Plan: configurable `--effort` via Settings UI

Issue: #1323

## Goal

Expose Claude Code's `--effort <level>` CLI flag as a user-tunable setting in
`<workspace>/config/settings.json`, with a Settings UI control. Default
(unset) preserves current behavior (no flag passed → Claude's own default).

## Pieces

### 1. Schema (`server/system/config.ts`)

- Add `effortLevel?: EffortLevel` to `AppSettings`.
- `EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"`.
- Update `isAppSettings` / `isAppSettingsPatch` validators with an
  `isEffortLevel` type guard.
- Update `cloneAppSettings` + `saveSettings` to round-trip the field.

### 2. CLI plumbing (`server/agent/config.ts`)

- Add `effortLevel?: EffortLevel` to `CliArgsParams`.
- In `buildCliArgs`, push `["--effort", effortLevel]` when set.

### 3. Wiring (`server/agent/index.ts` + `server/agent/backend/types.ts`)

- Thread `effortLevel` through the `AgentInput` to the Claude Code backend.
- Backend passes it to `buildCliArgs`.

### 4. UI (`src/components/SettingsModelTab.vue` + `SettingsModal.vue`)

- New `Model` tab with a `<select>` for effort level (empty / low / medium /
  high / xhigh / max).
- Auto-save on change (same pattern as `SettingsMapTab.vue`).
- Mount the tab in `SettingsModal.vue`.

### 5. i18n (all 8 locales)

- `settingsModal.tabs.model`
- `settingsModal.modelTab.{description, effortLabel, effortUnset, loadError, saveError, configured, notConfigured}`

### 6. Tests

- `test/system/test_config.ts`: validator accepts known levels, rejects
  garbage; round-trip preserves the field.
- `test/agent/test_buildCliArgs.ts` (or existing): snapshot covering both
  set + unset cases.

## Out of scope

- Per-chat / per-role overrides.
- Model selection (the tab name "Model" leaves room).
- Migration of existing `settings.json` files (additive field — no migration
  needed; loader already merges with `DEFAULT_SETTINGS`).
