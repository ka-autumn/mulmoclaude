# Plan: convert `cookingCoach` role → `mc-cooking-coach` preset skill (#1286)

Same shape as #1283 (`settings` → `mc-settings`). The `cookingCoach` role bundles a runtime plugin (`recipe-book-plugin`) + `presentForm` + `generateImage` behind a cooking-assistant persona. The plugin's MCP tool is "save / read / list / update / delete recipe markdown files", so the role + plugin combo collapses into a preset skill that drives the same files via Read / Write / Edit.

## Files

| Path | Action |
|---|---|
| `server/plugins/preset-list.ts` | Remove the `@mulmoclaude/recipe-book-plugin` row. The plugin source stays in `packages/plugins/recipe-book-plugin/` — re-enabling is one line. |
| `src/config/toolNames.ts` | Remove `manageRecipes` from `HOST_TOOL_NAMES`. |
| `src/config/roles.ts` | Delete the `cookingCoach` role + `BUILTIN_ROLE_IDS.cookingCoach`. Drop `TOOL_NAMES.manageRecipes` from `debug` role. |
| `server/workspace/paths.ts` | Add `cookingRecipes: "data/cooking/recipes"` to `WORKSPACE_DIRS` so the migration + skill can reference the canonical path via the constant. |
| `server/workspace/cooking-recipes/migrate.ts` (NEW) | Boot-time one-shot migration: copy any `data/plugins/%40mulmoclaude%2Frecipe-book-plugin/recipes/*.md` files to `data/cooking/recipes/*.md`. Idempotent via a `.migration-from-plugin-done` sentinel. |
| `server/index.ts` | Wire the migration call into startup, alongside the memory + photo-exif migration helpers. |
| `server/workspace/skills-preset/mc-cooking-coach/SKILL.md` (NEW) | Preset skill. Three workflows (save, list-via-README, edit/delete) all Write/Edit-driven. After every change, regenerate `data/cooking/recipes/README.md` as the catalogue. |
| `test/workspace/cooking-recipes/test_migrate.ts` (NEW) | Migration unit tests (idempotent, copies all .md files, preserves contents, skips when source absent). |
| `test/workspace/test_paths_shape.ts` | Add `cookingRecipes` to the expected-keys list. |
| `plans/done/feat-mc-cooking-coach-skill-1286.md` | This file. |

## Storage path migration

- **Before**: plugin's `files.data` scope → `<workspace>/data/plugins/%40mulmoclaude%2Frecipe-book-plugin/recipes/<slug>.md` (URL-encoded package name as dir).
- **After**: `<workspace>/data/cooking/recipes/<slug>.md` (clean, human-readable). Matches the original plan (`plans/done/feat-recipe-book-1175.md`).

Migration is boot-time + idempotent (no manual step required). Source files are COPIED, not moved, so a failed migration doesn't lose data. The sentinel prevents re-runs.

## README.md as the index

No Vue list view exists for the skill (no plugin = no View). A markdown index in the recipes dir keeps the catalogue browsable from any markdown viewer (Files Explorer / wiki render path). The skill body instructs Claude to regenerate `data/cooking/recipes/README.md` after every save / update / delete. Format: one bullet per recipe with slug → link to the `.md` file + short summary (title, tags, servings).

## What stays untouched

The `recipe-book-plugin` package source. Anyone who wants to re-enable the plugin's MCP / View path can add one line back to `preset-list.ts`. The skill route doesn't try to be reverse-compatible with the plugin — they're independent.

## Out of scope

- Cross-recipe search / filter — README is a static index, not a query interface.
- The Vue View component the plugin provides — gone when the plugin doesn't load. The skill is markdown-only.
- The `manageRecipes` tool definition (lives inside the plugin package, untouched but no longer reached because the plugin isn't preset-loaded).
