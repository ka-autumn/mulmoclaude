## Task: record the payment (cash-receipt) journal for this invoice

The invoice record is in the `<record_data_json>` block above (fields:
`id`, `clientId`, `issueDate`, `dueDate`, `status`, `lineItems[]`
(`description`, `quantity`, `rate`), `taxRate`, `notes`). You are the
`accounting` role and own `manageAccounting`. The invoice has been paid;
post the cash-receipt journal that clears the receivable.

Payment is always **direct deposit to the issuer's bank account** (the
issuer's `paymentDetails` on `data/profile/items/me.json`), so the debit
is the book's Cash / Checking / Bank account — there is no other payment
method to consider.

### 1. Resolve the book

1. Read `data/profile/items/me.json`. If it has a non-empty
   `defaultBookId`, use it as `bookId`. Otherwise call `getBooks` and
   pick the book as in the sale flow (one → use it; several → narrow by
   currency/country, then by the book name matching the issuer's
   `companyName`, then `presentForm`).
2. If no book exists, tell the user to set one up and stop.

### 2. Resolve real account codes

Call `getAccounts` and pick the actual codes — never invent one:

- **Cash / Checking / Bank** (asset) — the debit (the bank account the
  deposit landed in). If several bank accounts exist, match the one in
  the issuer's `paymentDetails`; ask only if genuinely ambiguous.
- **Accounts Receivable** (asset) — the credit, the same account the sale
  entry debited. Note its code — step 3 needs it.

### 3. Find the open receivable + guard against double-posting

The **memo is the join key**. Look up the A/R activity with a **compact,
bounded ledger query** — NOT `getJournalEntries`, whose full-entry output
can exceed the tool-result size limit even when filtered. Call `getReport`
with:

- `kind: "ledger"`,
- `accountCode: "<A/R code>"` (the Accounts Receivable code from step 2),
- `period: { "kind": "range", "from": "<invoice issueDate>", "to": "<today>" }`.

This returns small rows (`entryId`, `date`, `memo`, debit/credit); the
`memo` concatenates entry- and line-level memos, so the invoice id is
searchable. Among the rows:

- Find the **sale** row whose memo contains this invoice `id` (and
  `sale`). If none exists, tell the user the sale hasn't been recorded
  yet — they should click **Record sale** first — and stop.
- If a row's memo contains this invoice `id` and the word `payment`, the
  payment is already recorded — **tell the user (`openBook`) and stop**;
  do not double-post.

### 4. Post one balanced entry

Call `addEntries` with a single entry dated the payment date (use today
if the record gives no payment date) for the invoice `total`
(= subtotal + tax, recomputed from `lineItems` + `taxRate`):

- **Dr** Cash / Checking — `total`
- **Cr** Accounts Receivable — `total`

Set the entry `memo` to include the invoice id and the word `payment`,
e.g. `INV-2026-0001 payment`. If the invoice `notes` field carries a
payment reference (a transfer id / deposit slip number), append it to the
memo; otherwise post without one — **do not prompt for a reference**.

### 5. Confirm

In one sentence, confirm the cash receipt was posted and link the book
with `openBook`.
