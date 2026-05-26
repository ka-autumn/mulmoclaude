## Task: record the sale (account-receivable) journal for this invoice

The invoice record is in the `<record_data_json>` block above (fields:
`id`, `clientId`, `issueDate`, `dueDate`, `status`, `lineItems[]`
(`description`, `quantity`, `rate`), `taxRate`, `notes`). You are the
`accounting` role and own `manageAccounting`. Post the double-entry sale
journal for this invoice into the user's accounting book.

### 1. Resolve the book

1. Read `data/profile/items/me.json`. If it has a non-empty
   `defaultBookId`, use that as `bookId` and skip the rest of this step.
2. Otherwise call `manageAccounting` `getBooks`. If exactly one book
   exists, use it. If several:
   - keep only books whose currency/country fit the invoice;
   - if that leaves exactly one, use it;
   - if it leaves several, prefer the book whose name matches the
     issuer's `companyName` from the profile (e.g. company
     "Pervasive Co Ltd." → book "Pervasive");
   - only if still ambiguous, `presentForm` to ask which book.
3. If no book exists at all, tell the user to set one up first (the
   `accounting` role can `createBook`) and stop.

### 2. Resolve real account codes

Call `getAccounts` for this book and pick the actual codes — never invent
one:

- **Accounts Receivable** (asset) — the debit.
- **Revenue / Sales** (income) — the credit for the subtotal.
- **Output tax / VAT / consumption-tax payable** (liability, e.g.
  "Sales Tax Payable", typically `24xx`) — the credit for the tax. If a
  suitable account doesn't exist and tax is non-zero, `upsertAccount` one
  (or ask the user) before posting.

Note the **Accounts Receivable** code — step 3 needs it.

### 3. Guard against double-posting (idempotency)

The **memo is the join key** — there is no shared id store. Every entry
this invoice's journals post carries the invoice `id` in the memo. Before
posting, look it up with a **compact, bounded ledger query** — NOT
`getJournalEntries`, whose full-entry output can exceed the tool-result
size limit even when filtered. Call `getReport` with:

- `kind: "ledger"`,
- `accountCode: "<A/R code>"` (the Accounts Receivable code from step 2),
- `period: { "kind": "range", "from": "<invoice issueDate>", "to": "<today>" }`.

This returns small rows (`entryId`, `date`, `memo`, debit/credit) for just
the A/R account in a narrow date window; the `memo` concatenates the
entry- and line-level memos, so the invoice id is searchable. If any row's
memo contains this invoice `id` and the word `sale`, **tell the user the
sale is already recorded (link the book with `openBook`) and stop — do not
post a duplicate.**

### 4. Compute the amounts

From `lineItems`: `subtotal` = Σ(`quantity` × `rate`). `tax` = `subtotal`
× `taxRate` (treat a missing/zero `taxRate` as 0). `total` = `subtotal` +
`tax`. (Do not trust any `subtotal`/`tax`/`total` in the record — those
are host-computed display fields and may be absent here.)

### 5. Post one balanced entry

Call `addEntries` with a single entry dated the invoice `issueDate`:

- **Dr** Accounts Receivable — `total`
- **Cr** Revenue — `subtotal`
- **Cr** Output tax — `tax` *(omit this line entirely when tax is 0)*

Set the entry `memo` to include the invoice id and the word `sale`, e.g.
`INV-2026-0001 sale`. Σ debit must equal Σ credit.

### 6. Confirm

In one sentence, confirm what was posted (the accounts + total) and link
the book with `openBook` so the user can review.
