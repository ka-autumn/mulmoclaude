# Plan: Invoice / Report Plugin

Part of the [Solopreneur OS umbrella](feat-solopreneur-os.md). Reviewable and shippable independently — no dependency on Client or Worklog.

## Standalone value

An AI-native invoice and report generator. Earns its keep before Client or Worklog exist:

- "Generate an invoice for Acme: $5000 for May consulting." → produces a polished markdown invoice with a line item.
- "Draft a weekly status report for Globex covering the migration work." → produces a markdown report; user supplies the bullets in chat.
- "Make an invoice for last month's retainer to Hooli: $3000 retainer + 6 hours overage at $200." → multiple line items, computed total.
- "List my unpaid invoices." → table with totals per client.

In manual mode the plugin is a **formatter and file manager** for invoices — taking informal chat input and producing a sendable artifact with consistent layout, sequential numbering, status tracking, and a paper trail.

When Client and Worklog plugins are present, the same tool surface auto-populates: client metadata from `data/clients/`, line items from `data/worklogs/`. The user does not learn a new flow — they say "generate an Acme invoice for May" and the plugin uses whatever sources are available.

Compares to: FreshBooks invoice generator, Wave, Bonsai. Differentiator: chat input, markdown-native artifacts, no template editor, no SaaS lock-in.

## Data model

Each invoice is a markdown file with rich frontmatter:

```text
~/mulmoclaude/artifacts/invoices/
  2026-05-31-acme-INV-0042.md
  2026-04-30-acme-INV-0041.md
  2026-05-15-globex-INV-0043.md
```

```markdown
---
id: INV-0042
clientId: acme                     # free string if Client plugin absent
issueDate: 2026-05-31
dueDate: 2026-06-30
status: draft                      # draft | sent | paid | void
currency: USD
lineItems:
  - { description: May consulting hours, quantity: 24, unit: hour, rate: 200, amount: 4800 }
  - { description: April overage carry-forward, quantity: 1, unit: flat, rate: 200, amount: 200 }
subtotal: 5000
tax: 0
total: 5000
paidDate: null
paymentReference: null
---

# Invoice INV-0042

**To:** Acme Corp
**From:** Satoshi Nakajima
**Issue date:** 2026-05-31
**Due:** 2026-06-30

| Description | Qty | Rate | Amount |
|---|---|---|---|
| May consulting hours | 24 | $200 | $4,800 |
| April overage carry-forward | 1 | — | $200 |

**Total: $5,000**

Payment terms: Net 30. Bank transfer details on file.
```

The markdown body is the human-readable invoice; the frontmatter is the machine-queryable state. Same pattern as the rest of the workspace.

Reports use the same shape under `~/mulmoclaude/artifacts/reports/` with simpler frontmatter (no `total`, no `lineItems`, just `period` and `clientId`).

## Tool surface

```ts
manageInvoice({
  action:
    | "generate"        // create new invoice from inline or fetched data
    | "list"            // query invoices by client / status / range
    | "show"            // open one invoice in canvas
    | "markPaid"        // status flip + paidDate stamp + paymentReference
    | "void"            // status flip; record reason in notes; ID is NOT reused
    | "generateReport", // same flow for a non-billing report
  clientId?: string,
  range?: { from: string; to: string },
  lineItems?: LineItem[],          // explicit override; skips worklog fetch
  invoiceId?: string,
  reportKind?: "weekly" | "monthly" | "custom",
})
```

### `generate` data sourcing — cascading fallbacks

1. If `lineItems` provided in the call → use them verbatim. (Manual mode.)
2. Else if Worklog plugin present and `range` provided → read worklogs for that client in range, group by project, multiply hours × rate. (Auto mode.)
3. Else prompt the user via chat for line items. (Interactive mode.)

### Client metadata sourcing

1. If `clientId` matches a `data/clients/<id>.md` → use frontmatter (`rate`, `currency`, `paymentTerms`, primary contact).
2. Else use the bare string as the recipient name; prompt for any missing required fields.

### Invoice numbering

Scan existing invoice IDs at generation time, increment, pad to 4 digits. Configurable prefix in `~/mulmoclaude/config/invoice.json`. Voided IDs are not reused — gaps in the sequence are intentional for audit.

## GUI surfaces

1. **Invoice preview** (default for `generate` and `show`): renders the invoice markdown with a print-styled wrapper. Browser print-to-PDF produces a sendable PDF without a generation pipeline.
2. **Invoice list** (`list`): table grouped by status, filterable by client / range. Sums per status at the bottom.
3. **Report view**: same as invoice preview but without the totals row.

No standalone `/invoices` route in MVP.

## Phases

| Phase | Scope | Effort |
|---|---|---|
| 1 | Schema + markdown writer + `generate` (manual mode) + `show` view | 4 days |
| 2 | `list` + `markPaid` + `void` + invoice numbering | 2 days |
| 3 | Client-plugin integration (auto-fill from `data/clients/`) | 1 day |
| 4 | Worklog-plugin integration (auto-fill `lineItems` from `data/worklogs/`) | 2 days |
| 5 | `generateReport` + report view + templates per `reportKind` | 3 days |
| 6 | i18n + tests + polish | 2 days |

Total: ~14 working days.

**Ship phases 1–2 as v1 (manual-only, standalone).** Phases 3–4 ship as v1.1 once Client and Worklog plugins exist. Phase 5 is independent and can land any time after v1.

## Cross-plugin reads (informational)

- Reads `data/clients/<id>.md` to fill recipient metadata and rate.
- Reads `data/worklogs/committed/*.jsonl` to auto-populate line items.

Both reads are **best-effort**: missing data prompts the user rather than failing. This is the key to standalone shippability — the plugin works in a workspace with no other solopreneur plugins installed.

## Success criteria

**v1 (manual, standalone):**

1. "Generate an invoice for Acme, $5000 for May consulting." → invoice opens in canvas with one line item, status: draft.
2. "List my unpaid invoices." → table with totals.
3. "Acme paid INV-0042 on June 15." → status flips to paid, list re-renders.
4. "Void INV-0043; client cancelled the engagement." → status flips, ID is not reused on next generate.

**v1.1 (composed with Client + Worklog):**

5. With Client + Worklog installed: "Generate May invoice for Acme." → line items derived from worklog totals × rate from client file. User reviews, approves.
6. "Weekly status report for Globex." → report markdown with bullet summary of the past week's activity.

Not in scope:

- PDF generation pipeline (browser print is sufficient)
- Email delivery
- Payment-link generation (Stripe / PayPal)
- Recurring invoice schedules
- Sales tax computation per jurisdiction
- Currency conversion / multi-currency invoices
- Invoice templates (the markdown body is the template; one shape for now)

Each is its own follow-up plugin once v1 ships and a real client demands it.

## Open questions

1. **Invoice numbering scope.** Per-client (`ACME-0001`) or global (`INV-0042`)? Global is simpler and easier for accounting; per-client is what some users expect. Default to global, make prefix configurable.
2. **Tax handling.** A `tax` field exists in the schema but is always 0 in MVP. When does the user actually need it? Defer until asked; the schema accommodates future addition.
3. **Report templates.** `reportKind: "weekly" | "monthly"` implies fixed structure. Should custom templates live as user-editable markdown in `~/mulmoclaude/config/invoice/templates/`? Yes, but post-MVP.
4. **Sender details.** Where does the user's own name / address / payment instructions live? Proposal: a single `~/mulmoclaude/config/invoice.json` with `sender: {...}`. Read once at generation, embedded in the markdown body. Keeps the invoice self-contained (sender details survive even if config is later edited).
