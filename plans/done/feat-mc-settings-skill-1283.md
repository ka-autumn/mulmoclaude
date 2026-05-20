# Plan: convert `settings` role → `mc-settings` preset skill (#1283)

Built-in `settings` role bundles 4 tools (manageSource / manageSkills / manageAutomations / presentForm) behind a "Settings assistant" persona. Each `manage*` tool effectively just writes a markdown / JSON file plus a refresh side-effect. We can drop the role + Claude-only tools and let the user manage these from any role via natural-language file edits — provided the refresh side-effect happens automatically.

## Files

| Path | Action |
|---|---|
| `server/api/routes/config-refresh.ts` | NEW — `POST /api/config/refresh` wraps `refreshScheduledSkills()` + `refreshUserTasks()` |
| `server/workspace/config-refresh/provision.ts` | NEW — boot-time `PostToolUse` hook auto-provision, mirroring `wiki-history` |
| `server/workspace/config-refresh/hook.mjs` | NEW — hook script written into `<workspace>/.claude/hooks/config-refresh.mjs` |
| `server/index.ts` | wire up provision call + mount route |
| `src/config/apiRoutes.ts` | add `config.refresh` route |
| `server/workspace/skills-preset/mc-settings/SKILL.md` | NEW — preset skill |
| `src/config/roles.ts` | delete `settings` role + `BUILTIN_ROLE_IDS.settings` |
| `test/agent/test_activeTools.ts` | (potentially) remove any references to the settings role |

## Hook script behaviour

Triggered by `PostToolUse` matcher `Write|Edit`. Reads the stdin payload to extract `tool_input.file_path` (or `tool_response.filePath`). Matches against two patterns:

- `.claude/skills/<slug>/SKILL.md` → triggers `refreshScheduledSkills()` server-side
- `config/scheduler/tasks.json` → triggers `refreshUserTasks()` server-side

No match → no-op. Failure to reach the server (server restarting, etc.) is silent — refresh is best-effort, the file is already on disk and will be picked up next boot.

The hook script doesn't import shared TS modules (unlike `wiki-history/hook/snapshot.ts`), so no esbuild step. The provisioner reads `server/workspace/config-refresh/hook.mjs` (committed source) and copies it to `<workspace>/.claude/hooks/config-refresh.mjs` on every server start (same "factory default" model as `wiki-history`).

## Skill body shape

```markdown
---
name: mc-settings
description: Configure the MulmoClaude workspace — news sources, skills, scheduled automations. Edits markdown / JSON files directly; the server auto-refreshes affected systems via a hook.
---

# Workspace settings assistant

(role's original prompt content, adapted to use Read/Write/Edit on the
on-disk paths instead of the manage* tool calls. Concrete examples
for each of the three areas.)
```

## What stays

- The `manage*` MCP tools and their REST routes still exist — other roles can still list them in `availablePlugins`. We only delete the `settings` role definition; the underlying infra is untouched.
- The picker / launcher UI for selecting a role is independent.

## Migration note

The Settings role is removed. Users invoke `/mc-settings` (or natural language) from any role; the skill body handles all three management tasks via Write/Edit. No data migration required — the underlying files are the same on-disk shape.
