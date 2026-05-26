---
name: mc-invoice
description: A simple invoice ledger — create, list, edit, and remove invoices as JSON files. Skill at `.claude/skills/mc-invoice/` (SKILL.md + schema.json); records at `data/invoice/items/<id>.json`. Each invoice references a client (`clientId` is a `ref` to `mc-clients`) and carries an array of line items. Subtotal / tax / total are computed by the host from the line items + tax rate — you don't write them. The user views records at `/collections/mc-invoice`.
---

# Invoice (schema-driven collection)

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

## Files

| Purpose | Path |
|---|---|
| This skill's instructions (you are reading it) | `.claude/skills/mc-invoice/SKILL.md` |
| Field schema (source of truth for the host UI) | `.claude/skills/mc-invoice/schema.json` |
| Records — one JSON per invoice | `data/invoice/items/<id>.json` |
| Client database (referenced by `clientId`) | `data/clients/items/` (managed by `mc-clients` skill) |
| User-visible collection surface | `/collections/mc-invoice` (in the host UI) |

You write JSON; the host's `<CollectionView>` reads the same files and renders
a table + form. There is no separate database — the workspace IS the database.

## Record shape

The schema declares these fields (read `schema.json` for the authoritative
types):

- `id` — string, **primary key** (the filename, no extension)
- `issuer` — **display-only**; the host embeds the user's own business
  profile (the `me` record from the `mc-profile` collection) as the
  "bill-from" block in the read-only invoice view. You do **not** write this
  field — it carries no stored value. If the user hasn't set up their profile,
  the invoice view shows a "set it up" prompt; point them at `mc-profile`.
- `clientId` — ref → `mc-clients`, **required**
- `issueDate` — ISO date `YYYY-MM-DD`, **required**
- `dueDate` — ISO date (optional)
- `status` — enum `draft | sent | paid | void`, **required** (default to `draft` when creating)
- `currency` — enum ISO 4217 code `USD | JPY | EUR | GBP | CNY | KRW | AUD | CAD | CHF | HKD | SGD`, **required**. Governs how `rate` and the computed Subtotal / Tax / Total render — there is no separate per-amount currency, the whole invoice is in this one. Infer it from context (the client's locale, the user's `mc-profile`, or what the user states) — e.g. a Japan-based issuer billing in yen → `JPY`. When you genuinely can't tell, ask rather than defaulting to USD.
- `lineItems` — array of `{ description, quantity, rate }` rows. `rate` is a **plain number** in the invoice's `currency` (no symbol, no code) — e.g. `20000` on a `JPY` invoice means ¥20,000.
- `taxRate` — decimal (e.g. `0.10` for 10%)
- `notes` — markdown
- `subtotal`, `tax`, `total` — **computed by the host**; never write these

### id format

`INV-YYYY-NNNN`, year-then-zero-padded counter. Examples: `INV-2026-0001`,
`INV-2026-0042`. List `data/invoice/items/` first to find the highest existing
number for the year, then increment. If the file already exists (concurrent
draft, edited copy), pick the next free number rather than overwriting.

### Computed fields — do NOT write these

`subtotal`, `tax`, and `total` are **derived** fields. The host re-computes
them from `lineItems` + `taxRate` whenever the record is rendered, and
`<CollectionView>` will refuse to persist them through the form. If you ever
see a value for these in an existing JSON file (e.g. from a hand-edit or
import), leave it alone — the host's computed value wins for display.

## clientId resolution

`clientId` is a `ref` field pointing at the `mc-clients` collection. The host
renders it as a dropdown picker in the form and a clickable link in the table;
you write the raw slug.

When the user says "invoice Acme for May consulting":

- List `data/clients/items/` and find the slug whose `name` matches "Acme"
  (case-insensitive substring is fine for a first pass).
- If no match: ask the user whether to (a) create the client first via the
  `mc-clients` skill or (b) supply a literal slug.
- Never invent a clientId that doesn't exist — it'll render as a broken link
  in the invoice table.

## What to do

**Create**: derive an `id`, build the record with the fields you have, write
to `data/invoice/items/<id>.json` via the `Write` tool. Defaults:
`status: "draft"`, `issueDate: <today>`. Set `currency` from context (client
locale / `mc-profile` / what the user said) — don't silently default to USD.
Don't write `subtotal` / `tax` / `total` (computed).

**Create from worklog hours** — common case. When the user says
"invoice Acme for the work I did this month" (or "for May", or "since the
last invoice"):

1. Resolve "Acme" → a real client slug by reading `data/clients/items/`.
2. List `data/worklog/items/` and filter to entries where `clientId`
   matches AND `date` falls in the requested period.
3. Group the matching worklog entries into invoice line items. The simplest
   grouping: one line item per worklog entry (`description = entry.notes`,
   `quantity = entry.hours`, `rate = <user's standing rate or asked>`).
   You can also group by description if many entries share the same notes.
4. If the user hasn't specified a line-item rate and you don't have one on
   file, ASK via `presentForm` — don't invent one.
5. Write the invoice. The host will display Subtotal / Tax / Total
   automatically once the file is saved.

Do NOT skip step 2 and just ask the user "what should the invoice say?" —
the whole reason mc-worklog exists is so you can pull that data without
re-asking. If the worklog has no matching entries, tell the user and ask
whether to create one-off line items instead.

**List / summarize**: read `data/invoice/items/` and answer from those files.
Don't recite the whole table in chat — the user can see it at
`/collections/mc-invoice`. For aggregates ("how much have I billed Acme this
quarter?") group by clientId + date range and answer in one line.

**Mark sent / paid / void**: read the record, change `status`, write back.

**Edit line items**: read, mutate the `lineItems` array, write back. Preserve
fields you weren't asked to change.

**Delete**: confirm with the user once if the request is ambiguous, then
remove the file.

## Linking to an invoice in chat

When you reference a specific invoice in your reply, link to the collection
view — NOT the raw JSON file path:

- Do: `[INV-2026-0002](/collections/mc-invoice?selected=INV-2026-0002)`
- Don't: `[INV-2026-0002](data/invoice/items/INV-2026-0002.json)` — that opens
  the raw file in the Files view instead of the rendered table.

Always include the `?selected=<id>` query: it opens that invoice directly in
the read-only detail view. Omit it (link to plain `/collections/mc-invoice`)
only for a general, non-specific reference to the whole list.

## Host actions (detail-view buttons)

The invoice detail view shows schema-declared action buttons. Each opens a
*new* chat in the `accounting` role seeded with a template + the invoice data —
you don't trigger them yourself; point the user at the button if they ask.

- **Generate PDF** (always shown) — `templates/invoice.md` renders the printable
  document to the canvas via `presentDocument`.
- **Record sale** (status `sent` / `paid`) — `templates/journal-sale.md` posts
  the receivable journal (Dr A/R, Cr Revenue, Cr output-tax).
- **Record payment** (status `paid`) — `templates/journal-payment.md` posts the
  cash receipt (Dr Cash/Checking, Cr A/R).
- **Record void** (status `void`) — `templates/journal-void.md` voids the
  entries posted for this invoice.

### Bookkeeping: the memo is the join key

The journal actions have no shared id store, so every entry they post carries
the invoice `id` in its memo (e.g. `INV-2026-0001 sale`). The payment and void
templates locate prior entries by searching memos for that id. The book they
post into is the issuer's `defaultBookId` (from `mc-profile`), or resolved at
posting time when that is unset.

## When to ask vs. when to act

If the user gives you clear info ("invoice Acme $5000 for May consulting"),
just write the record: one line item with `description` "May consulting",
`quantity` 1 and `rate` 5000; `currency` `USD` (the `$` is the tell; a `¥`
amount would be `JPY`); `status` `draft`; today's `issueDate`; `dueDate`
empty (or 30 days out if a default is set elsewhere).

Use `presentForm` only when something is ambiguous: multiple clients match
the name they typed, line-item rate vs total isn't clear, etc.
