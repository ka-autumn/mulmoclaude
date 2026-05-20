# Plan: Solopreneur OS — Vision and Architecture

## Vision

An AI-native business operations layer for solopreneurs, built as three independent MulmoClaude plugins:

- **Client** — relationship and project records
- **Worklog** — time and activity records
- **Invoice / Report** — billable artifacts

Each plugin delivers value on its own. Composed together, they let one chat session turn the user's actual work into billable business records — without forms, without bookkeeping screens, without leaving the conversation.

Target user: consultants, freelancers, developers, designers, creators, small agencies, independent researchers.

## The chat-as-interface promise

Existing SaaS for solopreneurs (HoneyBook, Toggl Track, FreshBooks, Bonsai) converge on the same shape: dashboards, forms, modals, table editors. Each captures one slice (CRM, time, invoices) and forces the user to maintain three parallel mental models.

MulmoClaude inverts this. The user types intent; the agent composes the right plugins and surfaces the right views. The three plugins are not three apps glued together — they are three sources of truth that one agent can read, write, and reconcile in a single turn.

The user should be able to say:

> "Show me what I billed Acme this quarter, then draft a renewal proposal."

…and have the agent walk worklogs → invoices → client notes → a generated proposal, with the right views appearing in the canvas as the work happens.

## Why three plugins (not one app, not many micro-apps)

**Not one app**, because the data models genuinely differ: clients are relational records, worklogs are append-only events, invoices are immutable artifacts. Forcing them into a single plugin couples evolution speed — Worklog will iterate fast as inference improves; Client schema should be stable. Two plugins changing nightly should not require a third unchanged plugin to ship a release.

**Not many micro-apps**, because the three boundaries map cleanly onto the user's mental model: *who I work with*, *what I did*, *what I got paid for*. Splitting further (separating contacts from clients, or projects from clients) creates joins the user has to manage.

Three is the count where each plugin earns its keep on its own.

## Independence principle

Each plugin must satisfy:

1. **Useful alone.** Installable and demoable without the others. A user who only wants time-tracking should get a complete time-tracker.
2. **Reads, never writes, the others.** The Invoice plugin reads from `~/mulmoclaude/data/worklogs/` and `~/mulmoclaude/data/clients/` if they exist, but never mutates them. If those directories are absent, Invoice falls back to inline chat values.
3. **No shared event bus in MVP.** Cross-plugin coordination happens through filesystem reads. If a third consumer of worklog data ever appears, revisit. Until then, an event bus is over-engineering.
4. **Shippable in any order.** No plugin's MVP blocks another's MVP.

The **recommended** build order (by ROI to a developer-founder using MulmoClaude themselves, not by dependency):

| Order | Plugin | Why this slot |
|---|---|---|
| 1 | **Worklog** | Most novel; only one whose value depends on Claude doing something hard; demos the platform's differentiation |
| 2 | **Client** | Identity layer that Worklog labels reference and Invoice addresses; cheapest of the three to build |
| 3 | **Invoice / Report** | The payoff plugin; trivial once Worklog and Client provide structured inputs |

Any order works; the plans below should be reviewed and approved independently.

## Architecture

### Plugin-vs-host boundary

All three live as runtime plugins under `packages/plugins/` per the CLAUDE.md plugin-vs-host rule. The host gets zero solopreneur-specific code. Each plugin owns:

- Its `meta.ts` (tool name, workspace dirs, channels)
- Its data directory under `~/mulmoclaude/data/<plugin>/` or `~/mulmoclaude/artifacts/<plugin>/`
- Its tool definition and dispatch endpoint
- Its Vue views (canvas + preview)

The only host-side concern is whether the runtime-plugin scaffold can handle a plugin that reads another plugin's workspace directory — it can, since filesystem access is host-level, not plugin-scoped.

### Shared conventions

All three plugins follow the same patterns, copied from the existing todo/calendar/contacts plugins. This is convention, not framework code:

- **Storage.** Markdown + YAML frontmatter for relational records (`data/clients/<slug>.md`); append-only JSONL for event streams (`data/worklogs/<YYYY-MM>.jsonl`); markdown for generated artifacts (`artifacts/invoices/<name>.md`).
- **AI-on-a-leash.** The LLM never writes a committed record. It writes a candidate file (under `candidates/`) that the user promotes via the approval UI. Matches the existing todo plugin's pattern.
- **Cross-references.** Foreign keys are file paths in frontmatter (`clientId: acme` → `data/clients/acme.md`), not joins.
- **i18n.** Every user-facing string goes through `src/lang/*.ts` in all 8 locales (per CLAUDE.md).
- **No new chrome buttons in MVP.** Plugins are invoked from chat; standalone routes (`/clients`, `/worklogs`, `/invoices`) appear only after the plugin has earned its keep.

### Cross-plugin orchestration (when all three are installed)

```
User: Prepare May invoice for Acme.
  → manageWorklog(action=list, clientId=acme, range=2026-05)
  → manageClient(action=show, id=acme)              [for rate, terms]
  → manageInvoice(action=generate, clientId=acme, range=2026-05)
  → invoice.md opens in canvas
```

This composition is not hard-coded anywhere — Claude decides the chain from the tool descriptions and the user's intent. The plugins do not know about each other.

## Shared workspace layout

```text
~/mulmoclaude/
  data/
    clients/<slug>.md
    clients/<slug>/projects/<slug>.md
    worklogs/committed/<YYYY-MM>.jsonl
    worklogs/candidates/<ts>.json
  artifacts/
    invoices/<date>-<client>-<num>.md
    reports/<period>-<client>.md
  config/
    worklog.json                  ← inference repo list, optional
    invoice.json                  ← numbering prefix, sender details, optional
```

Each plugin owns its subtree exclusively. No plugin reads or writes outside its own subtree, with the documented exception that Invoice may read from `data/clients/` and `data/worklogs/`.

## Out of scope for the umbrella

| Cut | Why |
|---|---|
| Cross-plugin event bus | One consumer per data source; defer until a second appears |
| PDF generation | Browser print-to-PDF suffices for v1 |
| Email / Stripe / accounting integrations | Each is its own plugin once the core three prove out |
| Multi-currency invoice math | Single-currency-per-client is enough |
| Revenue forecasting | Requires a model; ship reports first |
| Multi-user / team support | "Solopreneur" is in the name |
| Marketplace distribution | Coordinate with `plans/feat-plugin-sdk-rollout.md` |

## Plan documents

Each plugin plan is reviewable and shippable independently. Each will move to `plans/done/` once its plugin ships.

- [Client plugin](feat-solopreneur-client.md)
- [Worklog plugin](feat-solopreneur-worklog.md)
- [Invoice / Report plugin](feat-solopreneur-invoice.md)
