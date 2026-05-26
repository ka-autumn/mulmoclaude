# Plan: `mc-invoice` Collection (bundled field-type work)

End of the invoice-migration arc that started with
[plans/done/feat-skill-driven-apps.md](done/feat-skill-driven-apps.md)
(PR #1483) and continued with PR #1495 (`ref`). Bundles **money +
enum + table + derived + mc-invoice skill** into a single PR so the
schema-language additions ship with a real consuming skill — none
of the new field types are exercisable in isolation, so splitting
into intermediate PRs (the earlier PR-B / PR-C / PR-D plan) hit a
"can't actually test" wall the moment PR-B opened.

## What ships

### Field types

| Type | What | Form input | Table cell |
|---|---|---|---|
| `money` | decimal stored verbatim | `<input type="number" step="0.01">` | `Intl.NumberFormat(locale, { style: "currency", currency })` |
| `enum` | string from a closed list | `<select>` populated from `values: string[]` | raw value (per-value badge styling deferred) |
| `table` | array of records | mini-table inside the form with add-row / remove-row buttons | `"N items"` summary |
| `derived` | read-only computed value (formula) | shown but disabled, live-updated from current draft | computed against the loaded item |

### Derived formula language (deliberately tiny)

Just enough for invoice:

- **Number literal**: `0`, `1.5`
- **Identifier ref**: `subtotal`, `taxRate` (top-level fields on the record)
- **Arithmetic**: `+ - * /` with normal precedence + parens
- **Sum over a table column or product of two columns**:
  - `sum(lineItems[].quantity * lineItems[].rate)` — typical "subtotal" pattern
  - `sum(lineItems[].amount)` — single-column sum

Anything else (string concat, conditionals, function calls beyond
`sum`) is rejected at parse time. The evaluator is a pure helper
under `src/utils/collections/derivedFormula.ts` with its own unit
tests so the parser quirks are pinned independently from the Vue
component.

### Skill

`server/workspace/skills-preset/mc-invoice/`:

- `SKILL.md` — teaches Claude how to derive an invoice ID, resolve
  client name → slug, build line items, default status to `draft`,
  and NEVER write derived fields (`subtotal` / `tax` / `total`).
- `schema.json` — the full invoice shape:

```json
{
  "title": "Invoices",
  "icon": "receipt_long",
  "dataPath": "data/invoice/items",
  "primaryKey": "id",
  "fields": {
    "id":        { "type": "string", "label": "ID", "primary": true, "required": true },
    "clientId":  { "type": "ref",    "to": "mc-clients", "label": "Client", "required": true },
    "issueDate": { "type": "date",   "label": "Issued", "required": true },
    "dueDate":   { "type": "date",   "label": "Due" },
    "status":    { "type": "enum",   "values": ["draft","sent","paid","void"], "label": "Status", "required": true },
    "lineItems": {
      "type": "table", "label": "Line items",
      "of": {
        "description": { "type": "string", "label": "Description", "required": true },
        "quantity":    { "type": "number", "label": "Qty", "required": true },
        "rate":        { "type": "money",  "currency": "USD", "label": "Rate", "required": true }
      }
    },
    "subtotal":  { "type": "derived", "label": "Subtotal",
                   "formula": "sum(lineItems[].quantity * lineItems[].rate)",
                   "display": "money", "currency": "USD" },
    "taxRate":   { "type": "number", "label": "Tax rate (e.g. 0.10 for 10%)" },
    "tax":       { "type": "derived", "label": "Tax",
                   "formula": "subtotal * taxRate",
                   "display": "money", "currency": "USD" },
    "total":     { "type": "derived", "label": "Total",
                   "formula": "subtotal + tax",
                   "display": "money", "currency": "USD" },
    "notes":     { "type": "markdown", "label": "Notes" }
  }
}
```

## Out of scope (explicit defer to follow-up)

- **`?highlight=<id>` scroll/ping handler** — the mc-* SKILL.md
  files now instruct Claude to link records as
  `/collections/<slug>?highlight=<id>` (so chat links open the
  rendered collection table rather than the raw JSON file). The
  query param is currently inert: CollectionView opens the table
  but doesn't yet scroll-to / visually flag the matching row. A
  follow-up should read `route.query.highlight`, scroll the row
  into view, and pulse it. Once shipped, every already-emitted
  link starts working with no skill change.
- **`actions`** field type — explicit "Mark Sent" / "Mark Paid" /
  "Export PDF" buttons. v0 user changes status via the enum
  dropdown in the edit form. Manual but works.
- **PDF template rendering** — invoice export to PDF. Requires
  Handlebars (or similar) + a server route + the action wiring.
- **Per-value enum badge styling** — gray pill for `draft`, green
  for `paid`, etc. Cosmetic; defer until invoice ships and the
  desired palette is obvious.
- **Server-side ref / enum / formula validation** — client UI
  constrains input; Claude could write whatever string into the
  JSON. Acceptable for personal-workspace use.
- **Nested tables** — `table.of.<subField>.type` can be the new
  types (string / number / money) but NOT another `table` /
  `derived` (no `derived` columns in line items; no tables in
  tables). Worth enforcing in the Zod refine to fail loudly rather
  than render nothing.

## Test plan

After `yarn dev` (and re-star of `mc-invoice` from `/skills`):

1. `/collections/mc-invoice` → `+` to create
2. Pick a client from the ref dropdown
3. Set issue date, due date, tax rate (e.g. `0.10`)
4. Add line items in the inline table: rows for "Web design × 10 @ $150" etc.
5. As rows are added/edited, the **Subtotal / Tax / Total fields in the form update live**
6. Set status (`draft`), save
7. Table row appears with `lineItems` column showing `"2 items"` and the derived columns showing the computed values
8. Edit the row, change status to `paid` via the dropdown, save
9. Add a second invoice for a different client → independent record

Unit tests cover:
- Discovery accepts money / enum / table / derived shapes; rejects malformed (money empty currency, enum no values, table no `of`, derived no formula, nested table-in-table)
- Formula evaluator: each operator, parens, identifiers, `sum()`, missing field → null, divide by zero / non-finite → null, malformed input → null

## Why one PR

Each of money / enum / table / derived has zero user-visible value
in isolation — they only make sense inside a record-shape that uses
them. Without `mc-invoice` shipping in the same PR, the only way to
test them is a hand-rolled throwaway schema, which the user (the
human reviewing) reasonably refused. Bundling lets one round of
review cover the whole feature and one round of manual testing
validates that invoice actually works end-to-end.

The PR will be large (~600 LoC host + ~150 LoC skill) but the
**field-type extension pattern** is already proven by PR #1495
(`ref`) — each new type is mechanical: enum addition + Zod refine +
form input branch + table cell branch.
