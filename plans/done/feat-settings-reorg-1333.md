# Plan: Settings modal reorganization — sidebar with grouped nav

Issue: #1333
Stacked on: #1332 (`feat-effort-setting-1323` branch — needs to land first)

## Goal

Replace the horizontal top-tab strip in `SettingsModal.vue` with a left
sidebar nav whose entries are organised into 4 groups, so that users can
locate a setting by category and new entries don't crowd the strip.

## Groups

| Group | Entries (order) |
|---|---|
| LLM | Model, Allowed Tools, Gemini (only when `!geminiAvailable`) |
| Servers | MCP |
| Workspace | Directories, Reference Dirs |
| Plugins | Map, Photos |

Order of groups reflects expected access frequency (Model + MCP are the
most-touched in normal use).

## Pieces

### 1. Layout (`SettingsModal.vue`)

- Modal wider: `w-[36rem]` → `w-[52rem]`.
- Header strip stays as-is (title + close).
- Body becomes 2-column: left sidebar (`w-44`, group headers + items),
  right pane (existing tab body, scrollable).
- Sidebar item buttons keep their existing `data-testid="settings-tab-<id>"`
  so e2e tests (`e2e/tests/settings.spec.ts`) continue to pass without
  modification.
- Footer strip unchanged.

### 2. Group metadata

Static array in the script section:

```ts
const GROUPS = [
  { key: "llm", items: ["model", "tools", "gemini"] },
  { key: "servers", items: ["mcp"] },
  { key: "workspace", items: ["dirs", "refs"] },
  { key: "plugins", items: ["map", "photos"] },
] as const;
```

Render-time filter drops `gemini` when `geminiAvailable === true`.

### 3. i18n (all 8 locales in lockstep)

Add `settingsModal.groups.{llm,servers,workspace,plugins}`. Group labels are
short nouns ("LLM", "Servers", etc.) — keep brand-style words ("LLM", "MCP")
in English across locales.

### 4. Tests

- Existing e2e (`e2e/tests/settings.spec.ts`) must keep passing — verified
  by preserving every `settings-tab-<id>` testid on the sidebar items.
- New e2e (optional, low priority): assert that group headers render and
  that `settings-tab-model` is under the LLM group.

## Out of scope

- New settings.
- Changing storage shape.
- Per-group save semantics — each existing tab already handles its own
  persistence; the reorg is layout-only.
