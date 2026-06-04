# Clients + Worklog — the client & time-tracking recipe

Read this when the user asks to **set up client tracking, a timesheet, or
"track my consulting work"** (sample query: *"Set up client and time tracking
for my consulting work"*). It scaffolds **two** collection skills that work
together:

- **`clients`** — a contact database (who you work for / bill).
- **`worklog`** — a timesheet; each entry references a client.

This is **Bundle A** of the billing suite. It is fully self-contained (no
dependency on anything else). The companion **Bundle B** (`invoice` + `profile`,
see `config/helps/billing-invoice.md`) builds on it: invoices reference these
`clients` and can pull billable hours from this `worklog`. **Recommended order:
set up this bundle first**, then invoicing.

Read `config/helps/collection-skills.md` first for the general schema DSL — this
file is the billing-specific specialization. Author everything under
`data/skills/<slug>/` (the bridge mirrors it to `.claude/skills/<slug>/`; the
user opens it at `/collections/<slug>`). **Do not use the `mc-` prefix.**

> **Follow this recipe verbatim — do NOT redesign.** The schemas below are
> fixed and known-good. Write them exactly as given (you may only adjust the
> `id`/`icon`/`title` if the user explicitly asks). Do **not** add fields, do
> **not** call `presentForm` to ask the user design questions, and do **not**
> mimic other collections in the workspace. The whole point is a reproducible
> billing suite. (If the user wants a *custom* collection instead, that's a
> different task — use `config/helps/collection-skills.md`.) Existing records
> under `data/clients/items` / `data/worklog/items` already match these schemas
> and will render as-is once you author the skill — no data edits needed.

## Slug contract (do not change these)

Bundle B's `invoice` references `clients` by this exact slug, and its line-item
flow reads `worklog`. Author the two collections with **exactly** these slugs so
the cross-bundle links resolve:

| Collection | slug | `dataPath` |
|---|---|---|
| Clients | `clients` | `data/clients/items` |
| Worklog | `worklog` | `data/worklog/items` |

> The `dataPath` values are deliberately prefix-free. If the user previously used
> the legacy `mc-clients` / `mc-worklog` preset skills, these same paths hold
> their existing records — re-creating with these slugs **re-attaches to that
> data** (no migration, no data loss). They can then Unstar the old `mc-*` skills
> in the skill manager.

## Order: `clients` before `worklog`

`worklog.clientId` is a `ref` to `clients`, so create `clients` first (its
records are what the worklog's client picker lists). Then create `worklog`.

---

## 1. `clients`

`data/skills/clients/schema.json`:

```json
{
  "title": "Clients",
  "icon": "people",
  "dataPath": "data/clients/items",
  "primaryKey": "id",
  "fields": {
    "id":      { "type": "string",   "label": "ID", "primary": true, "required": true },
    "name":    { "type": "string",   "label": "Name", "required": true },
    "email":   { "type": "email",    "label": "Email" },
    "address": { "type": "text",     "label": "Address" },
    "notes":   { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/clients/SKILL.md`:

```markdown
---
name: clients
description: A simple client database. Use whenever the user asks to add, list,
  update, or delete a client. Records live at `data/clients/items/<id>.json`
  (one JSON file per client); the user views them at `/collections/clients`,
  rendered from `schema.json` by the host. You do all I/O via Read / Write /
  Edit on the JSON files.
---

# Clients (schema-driven collection)

## Record shape
- `id` — string, **primary key** (the filename, no extension). A short
  kebab-case slug derived from the name (e.g. `acme-corp`, `globex`); lowercase
  letters, digits, hyphens; 1–48 chars. Pick a fresh suffix (`acme-corp-2`) if
  the obvious slug is taken.
- `name` — string, **required**
- `email` — email
- `address` — multi-line text
- `notes` — markdown

Don't push for fields the user hasn't given you — leave optional fields out of
the JSON entirely.

## What to do
**Add**: derive an `id`, build the record, Write `data/clients/items/<id>.json`.
List the directory first and pick a fresh slug if the file already exists — don't
silently overwrite.

**List / look up**: read `data/clients/items/`, answer from those files. Don't
recite the whole table in chat — the user sees it at `/collections/clients`. A
one-line confirmation ("Added Acme Corp.") is enough.

**Update**: Read → merge changes → Write back. Preserve fields you weren't asked
to change.

**Delete**: confirm once if the request is ambiguous, then remove the file.

## Linking to a client in chat
Link to the collection view, not the raw JSON path:
- Do: `[Acme Corp](/collections/clients?selected=acme-corp)`
- Don't: `[Acme Corp](data/clients/items/acme-corp.json)`

Always include `?selected=<id>` to open that client's detail view; omit it only
for a general reference to the whole list.

## When to ask vs. when to act
If the user gives a name and email in one sentence, just add the client. Use
`presentForm` only when you genuinely need information they haven't provided.
```

---

## 2. `worklog`

`data/skills/worklog/schema.json` (note `clientId` is a `ref` **to `clients`**):

```json
{
  "title": "Worklog",
  "icon": "schedule",
  "dataPath": "data/worklog/items",
  "primaryKey": "id",
  "fields": {
    "id":       { "type": "string",   "label": "ID", "primary": true, "required": true },
    "date":     { "type": "date",     "label": "Date", "required": true },
    "clientId": { "type": "ref",      "to": "clients", "label": "Client", "required": true },
    "hours":    { "type": "number",   "label": "Hours", "required": true },
    "billable": { "type": "boolean",  "label": "Billable" },
    "notes":    { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/worklog/SKILL.md`:

```markdown
---
name: worklog
description: A simple timesheet — log billable / non-billable hours per client
  per day. Use whenever the user logs, lists, edits, or removes worked hours.
  Records live at `data/worklog/items/<id>.json`; the user views them at
  `/collections/worklog`. `clientId` references the `clients` collection.
---

# Worklog (schema-driven collection)

## Record shape
- `id` — string, **primary key** (the filename). Format
  `{date}-{clientId}-{4-char-hex}` (e.g. `2026-05-23-acme-corp-a1b2`); the hex
  suffix avoids collisions for multiple sessions in the same day for the same
  client. Generate it randomly and check the file doesn't already exist.
- `date` — ISO date `YYYY-MM-DD`, **required**
- `clientId` — ref → `clients`, **required** (the client record's slug)
- `hours` — decimal number, **required** (1.5 = 90 minutes)
- `billable` — boolean (default `true` unless the user says otherwise)
- `notes` — markdown (what was worked on)

## clientId resolution
`clientId` is a `ref` to the `clients` collection — write the raw client slug.
When the user says "log 2 hours for Acme":
- List `data/clients/items/` and find the slug whose `name` matches "Acme"
  (case-insensitive substring is fine).
- If no match: ask whether to create the client first (via the `clients` skill)
  or use a literal slug they supply. Never invent a clientId that doesn't exist —
  it renders as a broken link.

## What to do
**Log hours**: derive `id`, default `billable: true`, default `date` to today if
unspecified, Write the JSON. (This skill tracks total hours per day per client —
not start/end times.)

**List / summarize**: read `data/worklog/items/`, answer from the files. Don't
recite the table — point at `/collections/worklog`. For aggregates ("how many
hours did I bill Acme last month?") group by clientId + date range and answer in
one line.

**Edit / delete**: Read → merge / remove. Preserve untouched fields.

## Linking to an entry in chat
- Do: `[2026-05-24 Acme](/collections/worklog?selected=2026-05-24-acme-corp-a1b2)`
- Don't: link the raw JSON path.

## When to ask vs. when to act
If the user gives a clear "log N hours for X today", just write it. Use
`presentForm` only when genuinely ambiguous (e.g. several clients match the name).
```

---

## Done

Tell the user the two collections are ready at `/collections/clients` and
`/collections/worklog`. The bridge mirrors the files and re-scans, so they appear
without a restart. If invoicing is the goal, point them at the next step: run
*"Set up invoicing for my business"* (the `config/helps/billing-invoice.md`
recipe, which references these `clients` and pulls hours from this `worklog`).
