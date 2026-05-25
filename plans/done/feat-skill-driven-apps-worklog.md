# Plan: Worklog as a Schema-driven App (minimal)

Follow-up to [feat-skill-driven-apps.md](feat-skill-driven-apps.md)
(PR #1483, merged). Validates the second-app hypothesis: that the same
schema-driven primitive can host a different domain with **one** new
schema-language addition (`boolean`) and zero new host UI work.

## Goal

Add a `mc-worklog` skill that records timesheet entries via the same
`<AppCollectionView>` primitive `mc-clients` uses. **Out of scope** for
this iteration: matching every feature of the existing 1,433-line
worklog plugin — see "Deferred" below for the gap.

## Architecture (delta from PR #1483)

### What the host adds

**One** new field type: `boolean`. That is the entire host change.

| Surface | Change |
|---|---|
| `server/workspace/apps/types.ts` | Add `"boolean"` to `AppFieldType` |
| `server/workspace/apps/discovery.ts` | Add `"boolean"` to the Zod field-type enum |
| `src/components/AppCollectionView.vue` form | New branch: `<input type="checkbox">` v-model bound to a boolean draft slot. `:required` doesn't apply (a "required" checkbox is a UX foot-gun). |
| `src/components/AppCollectionView.vue` table | Material `check` icon when `true`, em-dash when `false`/missing |
| `EditState.draft` type | `Record<string, string>` → `Record<string, string \| boolean>` |
| `draftToRecord` | Pass booleans through verbatim instead of stringifying |

That's it. No new endpoints, no new routes, no new sidebar entry — the
existing app-discovery flow picks up any starred skill that ships a
`schema.json`.

### What the skill adds

```text
server/workspace/skills-preset/mc-worklog/
├── SKILL.md          # Claude's instructions
└── schema.json       # 5 fields
```

Schema:

```json
{
  "title": "Worklog",
  "icon": "schedule",
  "dataPath": "data/worklog/items",
  "primaryKey": "id",
  "fields": {
    "id":       { "type": "string",   "label": "ID",       "primary": true, "required": true },
    "date":     { "type": "date",     "label": "Date",     "required": true },
    "clientId": { "type": "string",   "label": "Client",   "required": true },
    "hours":    { "type": "number",   "label": "Hours",    "required": true },
    "billable": { "type": "boolean",  "label": "Billable" },
    "notes":    { "type": "markdown", "label": "Notes" }
  }
}
```

Conventions encoded in `SKILL.md`:

- `id` = `{date}-{clientId-slug}-{4-hex}` (e.g. `2026-05-23-acme-corp-a1b2`); avoids collisions for multi-session days.
- `clientId` is a free string in this iteration. Skill tells Claude to look it up against `data/clients/items/*.json` when the user says "log 2 hours for Acme" — Claude resolves the name to the slug via Read, but the schema does not enforce the reference (that lands when we add `ref`).
- `billable` defaults to `true` when the user doesn't say otherwise.
- `hours` is a decimal (1.5 = 90 minutes). Worklog plugin used integer seconds; this is a deliberate ergonomic shift for the schema-driven version.

### Role update

`Account beta` (`src/config/roles.ts`) gets its prompt extended so
Claude knows both `mc-clients` and `mc-worklog` exist, plus a few new
sample queries. No new role; same `availablePlugins: [presentForm]`.

## Test plan

After `yarn dev` reboot:

1. `/skills` → ★ Star **Worklog** in the catalog → `.claude/skills/mc-worklog/` populated
2. Account beta: "log 2 hours for Acme today on the migration work" → `data/worklog/items/<id>.json` created with the right shape
3. `/apps/mc-worklog` → entry visible in the table, `billable` column shows a check icon
4. `+` button → form opens with a checkbox for `billable`; submit creates a record
5. Edit a row → checkbox state round-trips correctly
6. Same row, uncheck billable, save → file's `billable` field flips to `false`

## Deferred (the gap from the real worklog plugin)

Listed here so a future iteration can pick them up explicitly:

| Feature | What it needs |
|---|---|
| `startTime` / `endTime` with timezone | New `datetime` field type (different from `date`) |
| `source` enum (manual / claude-session / git / …) | New `enum` field type with declared values |
| `evidence[]` array of arbitrary objects | Nested-object / JSON-blob field type |
| candidate → committed → superseded workflow | Status field + UI-side approve action (or Claude-driven via Read/Write) |
| `clientId` validation against `mc-clients` | `ref` field type with `{ to: "<other-skill>" }` |
| Append-only versioning (`supersedes`, `deleted` tombstones) | Out of schema-language scope; would live in skill conventions |

None of these block the minimal version. Most are useful for invoice
too — `ref` and `enum` are the two that'd unlock the most.

## What success looks like

Concrete bar for "the schema-driven model is the right direction":

- Adding `boolean` to the host costs ≤ ~30 lines spread across 3 files
- The skill is ≤ 100 lines (SKILL.md + schema.json combined)
- Claude correctly logs an entry on first try without any new tool
- The CollectionView renders worklog cleanly with no per-app branches in the component

If all four hold, invoice migration becomes a question of "which schema
features do we add" rather than "is the primitive viable".
