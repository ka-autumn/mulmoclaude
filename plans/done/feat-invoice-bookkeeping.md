# Plan: invoice → bookkeeping actions (sale / payment / void)

Builds on the schema-declared `actions` mechanism shipped in
`plans/done/feat-collections-actions.md` (#1511). Adds the bookkeeping side
of the invoice lifecycle: when an invoice you **issue** is sent, paid,
or voided, post the matching **double-entry journal** into the
accounting book — by handing the `accounting` role a templated
instruction, exactly as the new `actions` primitive already does for
"Generate PDF".

## Hard constraint (unchanged): generic host, domain data in the skill

No invoice/accounting literals in `server/` or `src/`. Each bookkeeping
action is a row in `mc-invoice/schema.json` (`kind: "chat"`,
`role: "accounting"`, a template name); the journal logic lives in
skill templates under `mc-invoice/templates/`. The host only renders
buttons, assembles the seed (record JSON + template), and starts the
chat — it already does all of this.

## Background: how the legacy plugin did it

`packages/plugins/invoice-plugin/` never wrote journals itself. It built
a plain-English instruction and seeded an `accounting`-role chat
(`chat.start({ initialMessage, role: "accounting" })`, `index.ts:487`).
Two triggers in `View.vue`:

- **Approve** (`:746`): "record the double-entry bookkeeping journal
  entries for approved Invoice {id}" + total/subtotal/tax/date/client +
  Book ID — and trusted the accounting role to derive the debits/credits.
- **Mark paid** (`:835`): "record the cash receipt journal entries
  (debit Checking/Cash, credit Accounts Receivable)" + total + payment
  reference + Book ID.

It carried a `bookId`/`bookName` in issuer settings to name the ledger.

## Scope: the receivable lifecycle (3 actions)

An invoice you issue is an **account receivable**. The three actions
mirror its lifecycle:

| Action id | Button | Shows when status… | Journal it asks the accounting role to post |
|---|---|---|---|
| `journal-sale` | Record sale | `sent` or `paid` | Dr **Accounts Receivable** (total) / Cr **Revenue** (subtotal) / Cr **output-tax** `24xx` (tax) |
| `journal-payment` | Record payment | `paid` | Dr **Cash/Checking** (total) / Cr **Accounts Receivable** (total) |
| `journal-void` | Record void | `void` | **Void** the original sale (and payment, if any) entries for this invoice — or post their reversal |

(**Out of scope:** accounts *payable* — recording vendor bills you owe —
is the mirror flow and a separate feature.)

## The actions (data — `mc-invoice/schema.json`)

Appended to the existing `actions` array (alongside `pdf`):

```jsonc
{ "id": "journal-sale",    "label": "Record sale",    "icon": "request_quote",   "kind": "chat", "role": "accounting", "template": "templates/journal-sale.md",    "when": { "field": "status", "in": ["sent", "paid"] } },
{ "id": "journal-payment", "label": "Record payment", "icon": "payments",        "kind": "chat", "role": "accounting", "template": "templates/journal-payment.md", "when": { "field": "status", "in": ["paid"] } },
{ "id": "journal-void",    "label": "Record void",    "icon": "block",           "kind": "chat", "role": "accounting", "template": "templates/journal-void.md",    "when": { "field": "status", "in": ["void"] } }
```

## One host change: an optional `when` visibility predicate

The three actions are status-driven, so showing all of them (plus
"Generate PDF") on every invoice is noise. Add a small, generic `when`
clause to the action schema:

```jsonc
"when": { "field": "<top-level field key>", "in": ["<value>", …] }
```

- **types/discovery**: `CollectionAction.when?: { field: string; in: string[] }`;
  validate `field` non-empty and `in` a non-empty string array.
- **CollectionView**: an action button renders only when
  `when` is absent OR `String(viewing[when.field])` ∈ `when.in`. Pure,
  generic, evaluated against the open record — no invoice knowledge.

This is the only host code in the feature. **DECIDED: include it** —
without it the detail header shows four always-on buttons.

## The templates (data — `mc-invoice/templates/`)

Each template gets the invoice record in the `<record_data_json>` block
(host-injected) and instructs the `accounting` role, which owns
`manageAccounting` (`addEntries`, `voidEntry`, `getReport`,
`getAccounts`, `getBooks`). Common preamble for all three:

1. **Resolve the book.** First read `defaultBookId` from the profile
   (`data/profile/items/me.json`); if set, use it. Otherwise call
   `getBooks`; if exactly one, use it; if several, narrow by the
   invoice's currency/country, then by the book name matching the
   issuer's `companyName`, and only if still ambiguous `presentForm` to
   ask. (Setting `defaultBookId` skips all of this — strongly preferred
   once books multiply.)
2. **Tag every entry** with the invoice id in the memo (e.g.
   `INV-2026-0001`) so payment/void can find it later.
3. **Idempotency / entry lookup.** Locate prior entries with a compact,
   bounded query: `getReport` `kind: "ledger"`, `accountCode: <A/R>`,
   `period: { kind: "range", from: <issueDate>, to: <today> }`. This
   returns small rows (`entryId`, `date`, `memo`) for just the A/R
   account in a narrow window; the `memo` concatenates entry+line memos,
   so the invoice id is searchable, and the `entryId` is what `voidEntry`
   needs. If a row's memo matches this invoice id + transaction type,
   it's already recorded — stop, don't double-post. **Do NOT use
   `getJournalEntries`**: its `accountCode` filter keeps the *whole*
   entry whenever *any* line touches A/R (≈ every entry in a receivables
   book), and full entries (~2KB each, no pagination cap) blow the
   tool-result size limit — observed twice in testing (~110 KB even when
   filtered). The ledger report is ~10× smaller per row.

Per-template specifics:

- **`journal-sale.md`** — compute subtotal/tax/total from `lineItems` +
  `taxRate`; post one balanced entry: Dr A/R, Cr Revenue, Cr output-tax
  (omit the tax line when `taxRate` is 0/absent). Use `getAccounts` for
  the real codes; never invent one.
- **`journal-payment.md`** — find the open receivable for this invoice;
  post Dr Cash/Checking, Cr A/R for the total. Payment is always direct
  deposit to the issuer's bank account (from the profile's `paymentDetails`),
  so the debit is the Checking/Bank account in the book — match it via
  `getAccounts`. If the invoice's `notes` field carries a payment
  reference, include it in the memo, otherwise post without one (do not
  prompt).
- **`journal-void.md`** — find the sale entry (and payment entry, if
  posted) tagged with this invoice id via `getReport`; `voidEntry` each
  by its `entryId` (confirm via `presentForm` first, per the accounting
  role's voidEntry guidance); if no entry exists, say so.

All three end by confirming in one sentence what was posted and linking
to the book (`openBook`) so the user can review.

## Profile additions (data — `mc-profile` / `data/profile/items/me.json`)

The business profile already carries the bank/remit-to info: the
existing **`paymentDetails`** markdown field ("Payment details (bank /
wire / PayPal)") is free-form and is already rendered in the invoice's
PAYMENT block by `invoice.md`. We reuse it rather than add a duplicate
`bankDetails` field. `journal-payment.md` treats its presence as
confirmation that payment lands in the Checking/Bank account.

One genuinely new field, optional:

- **`defaultBookId`** (string) — the accounting book the journal
  templates post into (decision #2). Templates read it first; fall back
  to `getBooks` resolution when unset.

No host code — this is a skill-schema field the `mc-profile` collection
and the journal templates consume.

## Entry-linking convention (the load-bearing decision)

Payment and void must reference the original sale entry. The mechanism
has no shared id store, so the **memo is the join key**: every journal
entry the sale template posts carries the invoice id in its memo, and
the payment/void templates locate entries by searching memos for that
id. Documented in all three templates + a one-line note in
`mc-invoice/SKILL.md`.

## Decisions (all confirmed)

1. **`when` predicate** — DECIDED: include it (the only host code).
2. **Book resolution** — DECIDED: add a `defaultBookId` field to
   `mc-profile` (`data/profile/items/me.json`) that the templates read
   first; fall back to `getBooks` resolution when unset.
3. **Void mechanism** — DECIDED: `voidEntry` the original entries (the
   accounting plugin's native reversal); locate them by invoice-id memo
   and confirm via `presentForm` before voiding.
4. **Payment reference** — DECIDED: no payment-ref field added to the
   `mc-invoice` schema. Payment is always direct deposit to the issuer's
   bank account (profile `paymentDetails`), so the method is fixed; the
   payment template reads the optional `notes` field for a reference if
   the user put one there, otherwise it posts without one and does not
   prompt.
5. **Bank account on profile** — DECIDED: reuse the existing free-form
   `paymentDetails` markdown field on `mc-profile` (already rendered in
   `invoice.md`); do NOT add a duplicate `bankDetails` field. The issuer
   types their direct-deposit details however their country/bank expects.

## Test plan

- discovery tests: accept actions with a valid `when`; reject `when`
  missing `field` or with an empty/!array `in`.
- A pure visibility helper (`actionVisible(action, record)`) unit-tested:
  no `when` → always; `in` match / non-match; missing field → hidden.
- Manual (no collections e2e harness): set an invoice to `sent` → only
  "Record sale" (+ PDF) shows → click → accounting chat posts Dr A/R /
  Cr Revenue / Cr tax tagged with the invoice id; set to `paid` → "Record
  payment" posts the cash receipt; set to `void` → "Record void" voids
  the tagged entries. Re-clicking detects the existing entry and refuses
  to double-post.
- `yarn format` / `lint` / `typecheck` / `test` / `build` green.

## Deferred / out of scope

- **Accounts payable** (vendor bills you owe) — separate flow.
- **`kind: "mutate"`** auto-posting on a status change (no chat) — these
  stay user-clicked `kind: "chat"` actions for now.
- **Auto-firing** an action when the user flips `status` in the edit
  form — out of scope; the buttons are explicit.
- Richer `when` operators (`notIn`, numeric comparisons) — add when a
  real schema needs them.

## What success looks like

- The full issue → pay → void bookkeeping loop is driven from the
  invoice detail view, each step posting a correct, invoice-tagged,
  idempotent journal into the accounting book.
- The only host code is the generic `when` predicate (~15 LoC across
  types + discovery + CollectionView); everything invoice/accounting
  specific is three schema rows + three skill templates.
