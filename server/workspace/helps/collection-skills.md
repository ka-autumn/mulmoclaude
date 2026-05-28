# Collection skills — build a data app from a schema

A **collection skill** is a skill directory that ships a `schema.json` next to
its `SKILL.md`. The schema declares an entire data-driven app — its data model,
cross-record relations, rendered UI, computed fields, and per-record action
buttons — in one small JSON file. You author the schema, you write the records
(one JSON file each), and you are the runtime for any behaviour the schema
can't express declaratively. The host contains **zero** knowledge of any
specific collection: it just reads the DSL and renders a table / form / detail
view, and serves a REST surface. No database, no migration tool, no ORM — a
`schema.json` plus a folder of `<id>.json` records **is** the app.

This is the project philosophy made concrete: *the workspace is the database;
files are the source of truth; you are the intelligent interface.*

## Anatomy of a collection skill

You **author** the skill under `data/skills/<slug>/` (a plain, writable data
dir). A host-side hook then **mirrors** the files into `.claude/skills/<slug>/`,
which is where the host actually discovers and renders the collection from:

```
data/skills/<slug>/            ← YOU write here (Write / Edit)
  SKILL.md          ← instructions you read later (how to CRUD the records)
  schema.json       ← the DSL: data model + relations + UI + actions
  templates/*.md    ← natural-language bodies for actions (only if it has actions)
        │
        │  host's skill-bridge hook mirrors these three file kinds
        ▼
.claude/skills/<slug>/         ← host reads here (do NOT write here directly)
  SKILL.md  ·  schema.json  ·  templates/*.md

data/<name>/items/             ← the records (separate from the skill dir)
  <id>.json         ← one record per file (you write; host reads + renders)
```

- **Author under `data/skills/<slug>/`, NEVER `.claude/skills/<slug>/`
  directly.** Claude Code gates writes into `.claude/` (it's the agent's own
  config surface) and the host GUI can't answer that prompt, so a direct write
  hangs/fails. Writing under `data/skills/` has no such gate; the bridge hook
  copies `SKILL.md`, `schema.json`, and `templates/*.md` across for you and
  triggers a re-scan, so the collection appears at `/collections/<slug>`
  without a restart. (Other files you drop in `data/skills/<slug>/` — a README,
  scratch notes — stay put and are NOT mirrored.)
- **Do NOT use the `mc-` prefix** for skills you create. `mc-*` is reserved for
  the bundled presets (`mc-clients`, `mc-worklog`, `mc-invoice`, `mc-profile`);
  the server overwrites those on every boot, so your edits would be lost.
- **`<slug>` rules**: lowercase letters, digits, hyphens; no leading / trailing
  hyphen; 1–64 chars (e.g. `recipes`, `book-club`, `gym-log`). It doubles as the
  URL (`/collections/<slug>`) and the directory name.
- The user opens the collection at **`/collections/<slug>`**. Link a specific
  record with `?selected=<id>` (e.g. `/collections/recipes?selected=carbonara`).

## SKILL.md

Standard skill front-matter plus prose teaching *future-you* how to maintain the
records. Keep it short and operational:

```markdown
---
name: recipes
description: A personal recipe box. Use whenever the user asks to add, list,
  edit, or remove a recipe. Records live at `data/recipes/items/<id>.json`
  (one JSON per recipe); the user views them at `/collections/recipes`,
  rendered from `schema.json` by the host. You do all I/O via Read / Write /
  Edit on the JSON files.
---

# Recipes (schema-driven collection)

## Record shape
- `id` — kebab-case slug, primary key (the filename, no extension)
- `title` — string, required
- ... (one bullet per field; note which are host-computed and must NOT be written)

## What to do
**Add / List / Update / Delete** — derive an id, Read/Write/Edit the JSON.
List the directory first and pick a fresh slug rather than overwriting.
Don't recite the whole table in chat — point the user at the collection view.
```

Write the `description` so it tells *you* (in a future session) exactly when to
reach for this skill and where the records live — that text is what gets matched
when the user makes a request.

## schema.json — the DSL

Top-level shape (validated on discovery; a malformed schema is logged and
skipped, never crashes the host):

| Key | Meaning |
|---|---|
| `title` | Human name shown in the sidebar / header. Required. |
| `icon` | A **Material Icons** name (`receipt_long`, `people`, `schedule`, `menu_book`). Required. |
| `dataPath` | Workspace-relative records folder, e.g. `data/recipes/items`. Must stay under the workspace. Required. |
| `primaryKey` | The field name whose value is the filename. That field MUST set `primary: true`. Required. |
| `singleton` | Optional. When set, at most one record exists, pinned to this exact id (e.g. `me`). Host pre-fills + locks the create form and hides Add once it exists. |
| `fields` | Ordered map of field-name → field spec. **Insertion order = column order** in the table. Required. |
| `actions` | Optional array of per-record buttons (see below). |
| `completionField` | Optional. Name of the field whose value marks an item as "done" — when set, item-create fires a bell notification that clears once the field reaches one of `completionDoneValues`. Must name a real field in `fields`. Paired with `completionDoneValues` (both set, or both omitted). |
| `completionDoneValues` | Optional. Non-empty array of values that count as "done" for `completionField` (e.g. `["Done"]`, `["paid", "void"]`). Compared as strings. |

### Field types

`string` · `text` (multi-line) · `email` · `number` · `date` (`YYYY-MM-DD`) ·
`boolean` · `markdown` · `money` · `enum` · `ref` · `embed` · `table` ·
`derived` · `image`

Every field spec needs a `type` and a `label`. Extra keys by type:

- **`enum`** — `values: ["draft", "sent", "paid"]` (non-empty strings). Renders
  a `<select>`; stored as a plain string.
- **`money`** — `currency: "USD"` (ISO 4217, defaults to USD). Stored as a plain
  decimal; currency is display-only.
- **`ref`** — `to: "<target-slug>"`. Stores the target record's primary-key
  slug; host renders a clickable link + a dropdown picker populated from the
  target collection. Example: `{ "type": "ref", "to": "mc-clients", "label": "Client" }`.
  A `derived` field on the same record can also **dereference** a `ref` to read
  a numeric column off the record it points at — see the cross-collection
  formula syntax below.
- **`embed`** — `to: "<target-slug>"`, `id: "<record-id>"`. Pulls a *fixed*
  record from another collection into the read-only detail view (display-only,
  **nothing is stored** on this record). Example: an invoice embedding the
  user's own profile: `{ "type": "embed", "to": "mc-profile", "id": "me" }`.
- **`table`** — `of: { <col>: <sub-field-spec>, ... }`. An array of rows. Each
  sub-field is a flat spec; sub-fields **cannot** be `table` or `derived`
  (no nested tables, no computed columns).
- **`derived`** — `formula: "<expr>"`, optional `display` (`number` default, or
  `money` / `string` / `date`) and `currency`. **Read-only, host-computed** —
  you NEVER write derived values into the JSON; the host recomputes them on
  every render and the form refuses to persist them.
- **`image`** — stores a **workspace-relative image path** as a plain string
  (e.g. `data/attachments/2026/05/<id>.jpg` — the exact path from an
  `[Attached file: ...]` marker when the user attaches a photo). The host
  renders it as an `<img>` in the **detail view** (it is intentionally not a
  list-table column — a per-row image fetch is too expensive for a large
  collection). No extra keys. Great for photos like a business card: read the
  details off the attached image and write its path into the image field.
  Write the bare workspace-relative path — never an `/api/files/raw?...` URL.

### Derived-formula syntax

A tiny expression evaluated against the record (pure evaluator, no `eval`;
returns `null` on any failure). Supported:

- arithmetic `+ - * /` and parentheses
- identifier references to **top-level** fields (`subtotal * taxRate`)
- `sum(tableField[].col)` — sum a column across table rows
- `sum(tableField[].col * tableField[].col)` — sum a per-row product
- `<refField>.<col>` — **dereference a `ref` field** and read a numeric column
  off the record it points at (a live cross-collection lookup)

Example: `subtotal` = `sum(lineItems[].quantity * lineItems[].rate)`,
`tax` = `subtotal * taxRate`, `total` = `subtotal + tax`.

#### Cross-collection lookups (`<refField>.<col>`)

When a field is a `ref` to another collection, a `derived` formula can reach
into the referenced record and pull a numeric column out of it. This lets one
collection compute against data **owned by another** without copying that data.

Canonical use — a portfolio that values holdings against a separate price list:

```jsonc
// my-portfolio/schema.json  (one record per holding)
"fields": {
  "ticker": { "type": "ref", "to": "stock-quotes", "label": "Stock" },  // stores e.g. "AAPL"
  "shares": { "type": "number", "label": "Shares" },
  "value":  { "type": "derived", "formula": "shares * ticker.price",     // ← reads price from the quotes row
              "display": "money", "currency": "USD", "label": "Value" }
}
```

Here `ticker.price` resolves the `ticker` ref to its `stock-quotes` record and
reads that record's `price`. `price` lives **only** in `stock-quotes`; the
portfolio never stores a copy, so a quote refresh in `stock-quotes` is the
single source of truth for every holding's value.

Rules and limits:

- The left side must be a `ref` field **on this same record**; the right side is
  a single column name. Only the `<field>.<col>` shape — no `a.b.c` chains, no
  dereferencing inside `sum(...)`.
- The referenced column must hold a number (or a numeric string). A missing
  column, a non-numeric value, or a **dangling ref** (the slug points at a row
  that doesn't exist) makes the whole formula fail soft to an em-dash (`—`),
  same as any other formula error.
- The referenced column may itself be a **`derived`** field in the target
  collection (the host computes the target's own derived fields before the
  lookup) — *as long as* that target formula is target-local. A target derived
  field that in turn derefs a **third** collection won't resolve (only one hop
  is loaded) and reads as `—`.
- The target collection is loaded **when the page opens**. If a value changes in
  the target while the viewing collection is already open (e.g. you refresh a
  price in `stock-quotes` in another tab), the derived value updates on the next
  reload — not instantly across tabs.
- It's still per-record: each holding computes `shares * ticker.price` from its
  own `ticker`/`shares`. To total the portfolio, add a one-record summary
  collection or read the values off the list view — there is no cross-row sum
  over a joined column.

### Actions (per-record buttons)

Each entry in `actions` renders a button in the read-only detail view. The only
`kind` today is `"chat"`: clicking it starts a **new chat in a role**, seeded
with a template + the record data — the role then does the work with its tools.
This is how hard logic the schema can't express (PDF generation, bookkeeping
journals, drafting an email) gets delegated to natural language.

```json
{
  "id": "pdf",                      // unique within the schema
  "label": "Generate PDF",          // button text (English)
  "icon": "picture_as_pdf",         // Material Icons name
  "kind": "chat",
  "role": "accounting",             // which role the new chat runs in
  "template": "templates/invoice.md", // skill-relative; no `..`, no leading `/`
  "when": { "field": "status", "in": ["paid"] }  // optional: show only when record.status ∈ {paid}
}
```

- `template` is a path **inside the skill dir** (host reads it path-safely).
  Write the action's instructions there in plain English; the host prepends the
  record JSON as sanitized, passive data and hands the whole thing to the role.
- `when` is both the visibility rule **and** the authorization rule — the host
  re-checks it server-side, so a button gated on `status: paid` can't be invoked
  for a draft. Omit `when` ⇒ always shown.
- You do **not** trigger actions yourself; point the user at the button.

### Completion tracking (bell notifications)

Declare `completionField` + `completionDoneValues` at the top level of the
schema to wire a record's lifecycle into the bell:

```json
{
  "title": "Todos",
  "icon": "check_circle",
  "dataPath": "data/todos/items",
  "primaryKey": "id",
  "fields": {
    "id":     { "type": "string", "label": "ID", "primary": true, "required": true },
    "title":  { "type": "string", "label": "Title", "required": true },
    "status": { "type": "enum", "values": ["Todo", "Doing", "Done"], "label": "Status", "required": true }
  },
  "completionField": "status",
  "completionDoneValues": ["Done"]
}
```

Behaviour:

- **On create** the host fires a bell notification (titled `<schema.title>: <id>`,
  click-navigates to `/collections/<slug>?selected=<id>` so the item's detail
  opens) — unless the new record is **born done** (its `completionField` value
  is already in `completionDoneValues`), in which case nothing fires. The entry
  is published with `lifecycle: "action"` so it persists prominently in the
  bell until the obligation resolves.
- **On update** the host clears the notification when `completionField`
  transitions **into** a done value. Un-completing (Done → Todo) does NOT
  re-fire; firing is bound to create, by design.
- **On delete** the host clears any matching notification so a removed record
  can't leak a stale entry.

The pair is bundled — declaring one without the other fails schema validation.
`completionField` must name a real field; a typo is rejected at load. Works
with any field type whose stringified value is comparable (`enum`, `string`,
`boolean`, …) — e.g. `completionField: "status"` + `completionDoneValues:
["paid", "void"]` on an invoice, or `completionField: "shipped"` +
`completionDoneValues: ["true"]` on an order.

## Records — one JSON object per file

- Write each record to `<dataPath>/<id>.json` via the **Write** tool; the `id`
  field's value is the filename (no extension).
- **List the directory first** and pick a fresh id rather than silently
  overwriting. Update = Read, merge, Write back (preserve fields you weren't
  asked to change). Delete = remove the file.
- **Never write `derived` fields**, and never write an `embed` field — both are
  display-only / host-computed.
- Leave optional fields out of the JSON entirely rather than writing empty
  strings.
- For a `ref` field, write the raw target slug, and make sure that record
  actually exists in the target collection — an invalid slug renders as a broken
  link. The host enforces structure and safety; **you own semantic correctness**
  (valid refs, sane values).

## End-to-end: creating a new collection skill

1. Pick a `<slug>` (lowercase-hyphen, no `mc-` prefix) and a `dataPath`
   (`data/<name>/items`).
2. Write `data/skills/<slug>/schema.json` — `title`, `icon`, `dataPath`,
   `primaryKey` (with the matching field flagged `primary: true`), and the
   `fields` map in the order you want columns. Add `actions` +
   `data/skills/<slug>/templates/*.md` only if the collection needs delegated
   behaviour. (The bridge mirrors these into `.claude/skills/<slug>/`.)
3. Write `data/skills/<slug>/SKILL.md` — front-matter `name` + `description`,
   then the record-shape bullets and CRUD conventions.
4. Tell the user it's ready at `/collections/<slug>`. The bridge mirrors the
   files and triggers a re-scan, so the host discovers it without a restart and
   with no host code. If it doesn't appear: first confirm you wrote under
   `data/skills/<slug>/` (NOT `.claude/skills/…`, which is gated and won't
   mirror); then check your `schema.json` passed validation — primary key
   flagged `primary: true`, `ref`/`embed` have a valid `to`, `enum` has
   `values`, `table` has `of`, `derived` has `formula`, action ids unique,
   `dataPath` under the workspace. (A schema that fails validation is logged
   server-side and silently skipped at discovery.)

## Worked reference: the billing suite

The bundled presets are the canonical examples — read their `schema.json` when
in doubt:

- **`mc-clients`** — flat table (`string` / `email` / `text` / `markdown`). The
  simplest possible collection; everything else `ref`s into it.
- **`mc-worklog`** — adds a `ref` (`clientId → mc-clients`), a `date`, a
  `number`, a `boolean`. A companion data source.
- **`mc-invoice`** — the full toolkit in one schema: an `embed` issuer, a `ref`
  client, a `table` of line items, three `derived` money fields, an `enum`
  status, and four `actions` (PDF always-on; sale / payment / void gated by
  `status` via `when`).
