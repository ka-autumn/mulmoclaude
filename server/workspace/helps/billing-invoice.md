# Invoice + Profile — the invoicing recipe

Read this when the user asks to **set up invoicing / billing** (sample query:
*"Set up invoicing for my business"*). It scaffolds **two** collection skills:

- **`profile`** — the user's **own** business identity (the "bill-from" block:
  company name, tax ID, payment details). A singleton (one record, id `me`).
- **`invoice`** — an invoice ledger; each invoice references a client, embeds the
  profile as the issuer, and carries a table of line items with host-computed
  subtotal / tax / total.

This is **Bundle B** of the billing suite. It **builds on Bundle A**
(`clients` + `worklog`, see `config/helps/billing-clients-worklog.md`):

- `invoice.clientId` is a **required `ref` to `clients`** — without the `clients`
  collection the client picker is empty and you can't link an invoice to a client.
- The "invoice my hours this month" flow reads the `worklog` collection.

**Check the dependency before you finish.** List `data/skills/` and
`data/clients/items/`. If there is **no `clients` collection** (no
`data/skills/clients/` and no client records), tell the user invoicing works best
with the Clients & Worklog bundle and **offer to set it up too** (run the
`config/helps/billing-clients-worklog.md` recipe). Don't silently produce an
invoice collection that can't link a client. If they decline, proceed anyway —
the schema is valid on its own and the client picker simply stays empty until
`clients` exists (dangling refs render fail-soft, not as errors).

Read `config/helps/collection-skills.md` first for the general schema DSL. Author
everything under `data/skills/<slug>/` (the bridge mirrors it to
`.claude/skills/<slug>/`; the user opens it at `/collections/<slug>`). **Do not
use the `mc-` prefix.**

> **Follow this recipe verbatim — do NOT redesign.** The schemas and templates
> below are fixed and known-good. Write them exactly as given (you may only
> adjust `id`/`icon`/`title` if the user explicitly asks). Do **not** add fields,
> do **not** call `presentForm` to ask design questions, and do **not** mimic
> other collections in the workspace. The whole point is a reproducible billing
> suite. (For a *custom* collection, use `config/helps/collection-skills.md`
> instead.) Existing records under `data/invoice/items` / `data/profile/items`
> already match these schemas and will render as-is — no data edits needed.

## Slug contract (do not change these)

`invoice` references the other collections by these exact slugs:

| Collection | slug | `dataPath` | referenced by |
|---|---|---|---|
| Profile | `profile` | `data/profile/items` | `invoice.issuer` (embed `profile/me`) |
| Invoice | `invoice` | `data/invoice/items` | — |
| Clients | `clients` | `data/clients/items` | `invoice.clientId` (ref, from Bundle A) |

> The `dataPath` values are prefix-free. If the user previously used the legacy
> `mc-invoice` / `mc-profile` preset skills, these same paths hold their existing
> records — re-creating with these slugs **re-attaches to that data** (no
> migration). They can then Unstar the old `mc-*` skills in the skill manager.

## Order: `profile` before `invoice`

`invoice.issuer` embeds the `profile/me` record, so create `profile` first.

---

## 1. `profile`

`data/skills/profile/schema.json` (a **singleton** — exactly one record, id `me`):

```json
{
  "title": "Business Profile",
  "icon": "badge",
  "dataPath": "data/profile/items",
  "primaryKey": "id",
  "singleton": "me",
  "fields": {
    "id":                { "type": "string",   "label": "ID", "primary": true, "required": true },
    "companyName":       { "type": "string",   "label": "Company / legal name", "required": true },
    "taxRegistrationId": { "type": "string",   "label": "Tax registration ID (VAT / EIN / T-number)" },
    "email":             { "type": "email",    "label": "Email" },
    "phone":             { "type": "string",   "label": "Phone" },
    "address":           { "type": "text",     "label": "Address" },
    "paymentDetails":    { "type": "markdown", "label": "Payment details (bank / wire / PayPal)" },
    "defaultBookId":     { "type": "string",   "label": "Default accounting book ID" },
    "notes":             { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/profile/SKILL.md`:

```markdown
---
name: profile
description: The user's own business profile — the issuer ("bill-from") identity
  used on invoices. A singleton collection with exactly one record, id `me`. The
  record lives at `data/profile/items/me.json`; the user views and edits it at
  `/collections/profile`. You do all I/O via Read / Write / Edit on the JSON file.
---

# Business Profile (schema-driven collection)

Holds the user's **own** business identity — the "bill-from" side of an invoice.
Counterpart to `clients`, which holds the "bill-to" parties.

## Singleton — exactly one record, id `me`
This collection has **one** record. Its primary key is always the literal string
`me`, stored at `data/profile/items/me.json`. Never create a second record and
never invent another id — read, create, and update `me.json` only.

## Record shape
- `id` — string, **primary key**, always `me`
- `companyName` — string, **required** (the legal/company name shown on invoices)
- `taxRegistrationId` — string (VAT / EIN / JP T-number — region-dependent)
- `email` — email
- `phone` — string
- `address` — multi-line text
- `paymentDetails` — markdown (free-form bank / wire / PayPal instructions)
- `defaultBookId` — string (the accounting book the invoice bookkeeping actions
  post journals into; the `accounting` role reads it to skip book selection.
  Leave unset and the role resolves the book at posting time)
- `notes` — markdown

Leave optional fields the user hasn't given you out of the JSON entirely.

## What to do
**Set up / update**: Read `data/profile/items/me.json` (may not exist yet), merge
changes, Write back. Preserve fields you weren't asked to change. If missing and
the user wants to set their profile, create it with `id: "me"` plus the fields
they provided.

**Look up**: Read `me.json` and answer from it. If missing, tell the user their
profile isn't set up yet and offer to collect it (`presentForm` only if several
fields are needed at once).

**Never delete** the profile unless the user explicitly asks to reset it.

## Linking to the profile in chat
- Do: `[your business profile](/collections/profile?selected=me)`
- Don't: link the raw JSON path.

## When to ask vs. when to act
If the user gives the details in a sentence, just write them. Use `presentForm`
only when you genuinely need several fields they haven't provided.
```

---

## 2. `invoice`

`data/skills/invoice/schema.json` (`issuer` embeds `profile/me`; `clientId` is a
`ref` **to `clients`**; subtotal / tax / total are `derived`):

```json
{
  "title": "Invoices",
  "icon": "receipt_long",
  "dataPath": "data/invoice/items",
  "primaryKey": "id",
  "fields": {
    "id":        { "type": "string", "label": "ID", "primary": true, "required": true },
    "issuer":    { "type": "embed",  "to": "profile", "id": "me", "label": "From (issuer)" },
    "clientId":  { "type": "ref",    "to": "clients", "label": "Client", "required": true },
    "issueDate": { "type": "date",   "label": "Issued", "required": true },
    "dueDate":   { "type": "date",   "label": "Due" },
    "status":    { "type": "enum",   "values": ["draft", "sent", "paid", "void"], "label": "Status", "required": true },
    "currency":  { "type": "enum",   "values": ["USD", "JPY", "EUR", "GBP", "CNY", "KRW", "AUD", "CAD", "CHF", "HKD", "SGD"], "label": "Currency", "required": true },
    "lineItems": {
      "type": "table",
      "label": "Line items",
      "of": {
        "description": { "type": "string", "label": "Description", "required": true },
        "quantity":    { "type": "number", "label": "Qty", "required": true },
        "rate":        { "type": "money",  "label": "Rate", "currencyField": "currency", "currency": "USD", "required": true }
      }
    },
    "subtotal":  { "type": "derived", "label": "Subtotal", "formula": "sum(lineItems[].quantity * lineItems[].rate)", "display": "money", "currencyField": "currency", "currency": "USD" },
    "taxRate":   { "type": "number",  "label": "Tax rate (e.g. 0.10 for 10%)" },
    "tax":       { "type": "derived", "label": "Tax", "formula": "subtotal * taxRate", "display": "money", "currencyField": "currency", "currency": "USD" },
    "total":     { "type": "derived", "label": "Total", "formula": "subtotal + tax", "display": "money", "currencyField": "currency", "currency": "USD" },
    "notes":     { "type": "markdown", "label": "Notes" }
  },
  "actions": [
    { "id": "pdf", "label": "Generate PDF", "icon": "picture_as_pdf", "kind": "chat", "role": "accounting", "template": "templates/invoice.md" },
    { "id": "journal-sale", "label": "Record sale", "icon": "request_quote", "kind": "chat", "role": "accounting", "template": "templates/journal-sale.md", "when": { "field": "status", "in": ["sent", "paid"] } },
    { "id": "journal-payment", "label": "Record payment", "icon": "payments", "kind": "chat", "role": "accounting", "template": "templates/journal-payment.md", "when": { "field": "status", "in": ["paid"] } },
    { "id": "journal-void", "label": "Record void", "icon": "block", "kind": "chat", "role": "accounting", "template": "templates/journal-void.md", "when": { "field": "status", "in": ["void"] } }
  ]
}
```

`data/skills/invoice/SKILL.md`:

```markdown
---
name: invoice
description: A simple invoice ledger — create, list, edit, and remove invoices.
  Records live at `data/invoice/items/<id>.json`; the user views them at
  `/collections/invoice`. Each invoice references a client (`clientId` → the
  `clients` collection) and embeds the user's `profile/me` as the issuer.
  Subtotal / tax / total are host-computed — you don't write them.
---

# Invoice (schema-driven collection)

## Record shape (read `schema.json` for authoritative types)
- `id` — string, **primary key**. Format `INV-YYYY-NNNN` (year + zero-padded
  counter): `INV-2026-0001`. List `data/invoice/items/` first to find the highest
  number for the year, then increment; pick the next free number rather than
  overwriting.
- `issuer` — **display-only** embed of `profile/me` (the bill-from block). You do
  **not** write this — it carries no stored value. If the profile isn't set up,
  the view shows a "set it up" prompt; point the user at `/collections/profile`.
- `clientId` — ref → `clients`, **required**
- `issueDate` — ISO date `YYYY-MM-DD`, **required** (default today)
- `dueDate` — ISO date (optional)
- `status` — enum `draft | sent | paid | void`, **required** (default `draft`)
- `currency` — enum ISO 4217 code, **required**. Governs how `rate` and the
  computed totals render. Infer it from context (client locale, the user's
  `profile`, or what they state) — e.g. a Japan-based issuer billing in yen →
  `JPY`. When you genuinely can't tell, ask rather than defaulting to USD.
- `lineItems` — array of `{ description, quantity, rate }`. `rate` is a plain
  number in the invoice's `currency` (no symbol) — `20000` on a `JPY` invoice = ¥20,000.
- `taxRate` — decimal (e.g. `0.10` for 10%)
- `notes` — markdown
- `subtotal`, `tax`, `total` — **host-computed**; never write these.

## clientId resolution
`clientId` is a `ref` to `clients` — write the raw client slug. For "invoice Acme
for May consulting": list `data/clients/items/`, find the slug whose `name`
matches "Acme". No match → ask whether to create the client first (via `clients`)
or supply a literal slug. Never invent a clientId — it renders as a broken link.

## What to do
**Create**: derive an `id`, build the record, Write `data/invoice/items/<id>.json`.
Defaults: `status: "draft"`, `issueDate: <today>`. Set `currency` from context —
don't silently default to USD. Don't write `subtotal` / `tax` / `total`.

**Create from worklog hours** (common): when the user says "invoice Acme for the
work I did this month":
1. Resolve "Acme" → a real client slug from `data/clients/items/`.
2. List `data/worklog/items/` and filter to entries where `clientId` matches AND
   `date` falls in the requested period. (If there is no `worklog` collection,
   skip to manual line items.)
3. Group matching worklog entries into line items (simplest: one line item per
   entry — `description = entry.notes`, `quantity = entry.hours`, `rate = the
   user's standing rate or asked`).
4. If you have no rate on file, ASK via `presentForm` — don't invent one.
5. Write the invoice; the host displays Subtotal / Tax / Total automatically.

If the worklog has no matching entries (or doesn't exist), tell the user and ask
whether to create one-off line items instead.

**List / summarize**: read `data/invoice/items/`, answer from the files. Point at
`/collections/invoice` rather than reciting the table. For aggregates group by
clientId + date range and answer in one line.

**Mark sent / paid / void**: Read → change `status` → Write.
**Edit line items**: Read → mutate `lineItems` → Write. Preserve untouched fields.
**Delete**: confirm once if ambiguous, then remove the file.

## Linking to an invoice in chat
- Do: `[INV-2026-0002](/collections/invoice?selected=INV-2026-0002)`
- Don't: link the raw JSON path.
Always include `?selected=<id>`; omit it only for a general reference to the list.

## Host actions (detail-view buttons)
The detail view shows schema-declared buttons. Each opens a *new* chat in the
`accounting` role seeded with a template + the invoice data — you don't trigger
them yourself; point the user at the button if they ask.
- **Generate PDF** (always) — renders the printable document via `presentDocument`.
- **Record sale** (status `sent`/`paid`) — posts the receivable journal.
- **Record payment** (status `paid`) — posts the cash receipt.
- **Record void** (status `void`) — voids the entries posted for this invoice.

The bookkeeping actions have no shared id store, so every entry they post carries
the invoice `id` in its memo (e.g. `INV-2026-0001 sale`); payment/void locate
prior entries by searching memos for that id. They post into the issuer's
`defaultBookId` (from `profile`), or resolve the book at posting time when unset.

## When to ask vs. when to act
Clear info ("invoice Acme $5000 for May consulting") → just write it: one line
item (`description` "May consulting", `quantity` 1, `rate` 5000); `currency` USD
(the `$` is the tell; `¥` → `JPY`); `status` draft; today's `issueDate`. Use
`presentForm` only when something is ambiguous.
```

### Action templates

Also author these four files under `data/skills/invoice/templates/` (the bridge
mirrors `templates/*.md` alongside the schema). They are the natural-language
bodies the `accounting` role runs when the user clicks a detail-view button.

`data/skills/invoice/templates/invoice.md`:

````markdown
## Task: generate a printable invoice document

The invoice record is in the `<record_data_json>` block above (fields: `id`,
`clientId`, `issueDate`, `dueDate`, `status`, `lineItems[]` (`description`,
`quantity`, `rate`), `taxRate`, `notes`).

Produce a clean, print-ready invoice as a Markdown document (inline HTML is fine)
and present it in the canvas with the `presentDocument` tool. Steps:

1. **Resolve the recipient (Bill To).** Read `data/clients/items/<clientId>.json`
   for the client's `name`, `address`, `email`.
2. **Resolve the issuer (From).** Read `data/profile/items/me.json` for
   `companyName`, `taxRegistrationId`, `address`, `email`, `phone`,
   `paymentDetails`. **If that file does not exist**, stop and tell the user their
   business profile isn't set up — point them at `/collections/profile` — and do
   not write a half-blank invoice.
3. **Compute totals** from line items: `subtotal` = Σ(`quantity` × `rate`), `tax`
   = `subtotal` × `taxRate` (missing `taxRate` = 0), `total` = `subtotal` + `tax`.
   Format money with the invoice's `currency`.
4. **Render** a clean invoice layout (header with `id` / issue & due dates; BILL
   TO from the client; FROM from the profile; a line-item table with per-row
   amount = quantity × rate; subtotal / tax / total; a payment block from the
   issuer's `paymentDetails`). Omit any block whose source field is empty.
5. **Present it** with `presentDocument`: `title` = `Invoice {id}`, `markdown` =
   the rendered document, `filenamePrefix` = the invoice `id`. This is the only
   correct way to surface the document — don't paste markdown into chat or write a
   raw file.
6. **Confirm** in one short sentence that the invoice is ready in the canvas.
````

`data/skills/invoice/templates/journal-sale.md`:

````markdown
## Task: record the sale (account-receivable) journal for this invoice

The invoice record is in the `<record_data_json>` block above. You are the
`accounting` role and own `manageAccounting`. Post the double-entry sale journal.

### 1. Resolve the book
1. Read `data/profile/items/me.json`. If it has a non-empty `defaultBookId`, use
   it as `bookId` and skip the rest of this step.
2. Otherwise call `manageAccounting` `getBooks`. One book → use it. Several →
   keep books whose currency/country fit the invoice; if one remains use it; else
   prefer the book whose name matches the issuer's `companyName`; only if still
   ambiguous, `presentForm` to ask.
3. No book at all → tell the user to set one up first (the `accounting` role can
   `createBook`) and stop.

### 2. Resolve real account codes
Call `getAccounts` and pick actual codes — never invent one: **Accounts
Receivable** (asset, the debit), **Revenue / Sales** (income, credit for the
subtotal), **Output tax / VAT payable** (liability, credit for the tax;
`upsertAccount` one if missing and tax is non-zero). Note the A/R code.

### 3. Guard against double-posting (idempotency)
The **memo is the join key**. Before posting, look it up with a compact, bounded
ledger query — NOT `getJournalEntries`. Call `getReport` with `kind: "ledger"`,
`accountCode: "<A/R code>"`, `period: { "kind": "range", "from": "<issueDate>",
"to": "<today>" }`. If any row's memo contains this invoice `id` and the word
`sale`, the sale is already recorded — tell the user (link via `openBook`) and
stop; do not double-post.

### 4. Compute amounts
`subtotal` = Σ(`quantity` × `rate`); `tax` = `subtotal` × `taxRate` (0 if
missing); `total` = `subtotal` + `tax`. Don't trust any stored subtotal/tax/total.

### 5. Post one balanced entry
`addEntries` with a single entry dated the invoice `issueDate`: **Dr** A/R =
`total`; **Cr** Revenue = `subtotal`; **Cr** Output tax = `tax` (omit when 0). Set
the `memo` to include the invoice id and the word `sale` (e.g. `INV-2026-0001
sale`). Σ debit must equal Σ credit.

### 6. Confirm
One sentence on what was posted, and link the book with `openBook`.
````

`data/skills/invoice/templates/journal-payment.md`:

````markdown
## Task: record the payment (cash-receipt) journal for this invoice

The invoice record is in the `<record_data_json>` block above. You are the
`accounting` role and own `manageAccounting`. The invoice is paid; post the
cash-receipt journal that clears the receivable. Payment is always direct deposit
to the issuer's bank account (the issuer's `paymentDetails` on
`data/profile/items/me.json`), so the debit is the book's Cash / Checking account.

### 1. Resolve the book
Read `data/profile/items/me.json` for a non-empty `defaultBookId`; else `getBooks`
and pick as in the sale flow. No book → tell the user to set one up and stop.

### 2. Resolve real account codes
`getAccounts` — never invent: **Cash / Checking / Bank** (asset, the debit; if
several, match the one in the issuer's `paymentDetails`), **Accounts Receivable**
(asset, the credit — same account the sale debited). Note the A/R code.

### 3. Find the open receivable + guard against double-posting
The **memo is the join key**. Compact, bounded ledger query — NOT
`getJournalEntries`. `getReport` with `kind: "ledger"`, `accountCode: "<A/R
code>"`, `period: { "kind": "range", "from": "<issueDate>", "to": "<today>" }`.
Find the **sale** row whose memo contains this invoice `id`; if none, tell the
user to click **Record sale** first and stop. If a row's memo contains this `id`
and `payment`, payment is already recorded — tell the user (`openBook`) and stop.

### 4. Post one balanced entry
`addEntries` with a single entry dated the payment date (today if none) for the
invoice `total` (subtotal + tax, recomputed): **Dr** Cash/Checking = `total`;
**Cr** A/R = `total`. Set `memo` to include the invoice id and `payment` (e.g.
`INV-2026-0001 payment`). If `notes` carries a payment reference, append it;
otherwise don't prompt for one.

### 5. Confirm
One sentence confirming the cash receipt, link the book with `openBook`.
````

`data/skills/invoice/templates/journal-void.md`:

````markdown
## Task: void the bookkeeping journals for this invoice

The invoice record is in the `<record_data_json>` block above. You are the
`accounting` role and own `manageAccounting`. The invoice is voided; reverse the
journals posted for it.

### 1. Resolve the book
Read `data/profile/items/me.json` for a non-empty `defaultBookId`; else resolve
via `getBooks` (as in the sale flow). No book → nothing to void; say so and stop.

### 2. Resolve the Accounts Receivable code
`getAccounts` and note the **Accounts Receivable** code — step 3 uses it.

### 3. Find the entries to void (memo is the join key)
Compact, bounded ledger query — NOT `getJournalEntries`. `getReport` with `kind:
"ledger"`, `accountCode: "<A/R code>"`, `period: { "kind": "range", "from":
"<issueDate>", "to": "<today>" }`. Select entries with these deterministic rules:
1. **Keep only original sale/payment rows** — memo contains this invoice `id`
   **and** the word `sale` or `payment` (this excludes prior void reversals, whose
   memo is `Void INV-…`).
2. **Deduplicate by `entryId`**.
3. **Skip anything already voided** (a matching opposite-sign `Void INV-…`
   reversal already exists). If nothing survives, tell the user there's nothing to
   void and stop.

### 4. Confirm, then void
Voiding is irreversible. **Confirm via `presentForm` first** — list the entries
(date, accounts, amount, `entryId`) and ask. On confirmation, call `voidEntry`
once per entry with its `entryId` and a `reason` naming the invoice (e.g. `Void
INV-2026-0001`). `voidEntry` appends a reversing pair — the journal stays
append-only.

### 5. Confirm
One sentence on which entries were voided (or that there were none); link the book
with `openBook`.
````

---

## Done

Tell the user invoicing is ready at `/collections/invoice` (and their profile at
`/collections/profile`). The bridge mirrors the files and re-scans, so they appear
without a restart. Remind them: an invoice needs a `clients` collection to link a
recipient (Bundle A) and a filled-in `profile` to render the issuer block.
