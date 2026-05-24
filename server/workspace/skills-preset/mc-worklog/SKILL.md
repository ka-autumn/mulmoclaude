---
name: mc-worklog
description: A simple timesheet — log billable / non-billable hours per client per day as JSON files. Skill files at `.claude/skills/mc-worklog/` (SKILL.md + schema.json); records at `data/worklog/items/<id>.json`. User views records at `/collections/mc-worklog`, rendered from the schema by the host. Companion to the `mc-clients` skill — clientId values reference that database.
---

# Worklog (schema-driven collection)

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

## Files

| Purpose | Path |
|---|---|
| This skill's instructions (you are reading it) | `.claude/skills/mc-worklog/SKILL.md` |
| Field schema (source of truth for the host UI) | `.claude/skills/mc-worklog/schema.json` |
| Records — one JSON per worklog entry | `data/worklog/items/<id>.json` |
| Client database (referenced by `clientId`) | `data/clients/items/` (managed by `mc-clients` skill) |
| User-visible collection surface | `/collections/mc-worklog` (in the host UI) |

You write JSON; the host's `<CollectionView>` reads the same files and
renders a table + form. There is no separate database — the workspace IS the
database.

## Record shape

The schema declares these fields (read `schema.json` for the authoritative
types):

- `id` — string, **primary key** (the filename, no extension)
- `date` — ISO date `YYYY-MM-DD`, **required**
- `clientId` — ref → `mc-clients`, **required** (slug from `data/clients/items/`)
- `hours` — decimal number, **required** (1.5 = 90 minutes; not seconds)
- `billable` — boolean (defaults to `true` if the user doesn't say otherwise)
- `notes` — markdown (what was worked on)

`id` format: `{date}-{clientId}-{4-char-hex}` (e.g.
`2026-05-23-acme-corp-a1b2`). The hex suffix avoids collisions for multiple
sessions in the same day for the same client. Generate the suffix randomly
and check that the resulting file doesn't already exist.

## clientId resolution

`clientId` is a `ref` field pointing at the `mc-clients` collection.
The host renders it as a dropdown picker in the UI and a clickable link
in the table, but you write the raw slug into the JSON.

When the user says "log 2 hours for Acme":

- List `data/clients/items/` and find the slug whose `name` matches
  "Acme" (case-insensitive substring is fine for a first pass).
- If no match: ask the user whether to (a) create the client first
  (via the `mc-clients` skill) or (b) use a literal slug they provide.
- Never invent a clientId that doesn't exist in `data/clients/items/` —
  it'll show up as a broken link in the worklog table.

## What to do

**Log hours**: derive `id`, write `data/worklog/items/<id>.json` with the
fields you have. Default `billable: true`; default `date` to today if the
user didn't specify. The skill explicitly does NOT track start/end times in
this iteration — just total hours per day per client.

**List / summarize**: read `data/worklog/items/` and answer from those
files. Don't recite the whole table in chat — the user can see it at
`/collections/mc-worklog`. For aggregates ("how many hours did I bill Acme last
month?") group by clientId + date range and answer in one line.

**Edit / delete**: same conventions as `mc-clients` — read, merge, write,
or unlink. Preserve fields you weren't asked to change.

## When to ask vs. when to act

If the user gives you a clear "log N hours for X today" sentence with all
the fields, just write the record. Use `presentForm` only when something is
genuinely ambiguous (e.g. multiple clients match the name they typed).
