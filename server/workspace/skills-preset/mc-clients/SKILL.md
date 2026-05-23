---
name: mc-clients
description: A simple client database. Use whenever the user asks to add, list, update, or delete a client. Skill files live at `.claude/skills/mc-clients/` (SKILL.md + schema.json); records live at `data/clients/items/<id>.json` (one JSON file per client). The user views the records at `/apps/mc-clients`, rendered from the schema by the host — you do all I/O via Read / Write / Edit on the JSON files.
---

# Clients (schema-driven app)

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

## Files

| Purpose | Path |
|---|---|
| This skill's instructions (you are reading it) | `.claude/skills/mc-clients/SKILL.md` |
| Field schema (source of truth for the host UI) | `.claude/skills/mc-clients/schema.json` |
| Records — one JSON per client | `data/clients/items/<id>.json` |
| User-visible app surface | `/apps/mc-clients` (in the host UI) |

You write JSON; the host's `<AppCollectionView>` reads the same files and
renders a table + form. There is no separate database — the workspace IS the
database.

## Record shape

The schema declares these fields (read `schema.json` for the authoritative
types):

- `id` — string, **primary key** (the filename, no extension)
- `name` — string, **required**
- `email` — email
- `address` — multi-line text
- `notes` — markdown

`id` is a short kebab-case slug derived from the client name (e.g. `acme-corp`,
`globex`). Lowercase letters, digits, hyphens; 1–48 chars. Pick a fresh suffix
(`acme-corp-2`) if the obvious slug is already taken. Don't push for fields
the user hasn't given you — leave optional fields out of the JSON entirely.

## What to do

**Add**: derive an `id`, build the record, write to
`data/clients/items/<id>.json` via the `Write` tool. List the directory first
and pick a fresh slug if the file already exists — don't silently overwrite.

**List / look up**: read `data/clients/items/` and answer from those files.
Don't recite the whole table in chat — the user can see it at
`/apps/mc-clients`. A one-line confirmation ("Added Acme Corp.") is enough.

**Update**: read the record, merge changes, write it back. Preserve fields
you weren't asked to change.

**Delete**: confirm with the user once if the request is ambiguous, then
remove the file.

## When to ask vs. when to act

If the user gives you a name and an email in one sentence, just add the
client. Use `presentForm` only when you genuinely need information they
haven't provided — don't use it to re-confirm values they already typed.
