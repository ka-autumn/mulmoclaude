# Plan: Client Plugin

Part of the [Solopreneur OS umbrella](feat-solopreneur-os.md). Reviewable and shippable independently — no dependency on Worklog or Invoice.

## Standalone value

An AI-native client and project record. Earns its keep before Worklog or Invoice exist:

- "What do I know about Acme?" → returns notes, contacts, recent project list, last interaction
- "Who am I meeting next week?" → cross-references calendar plugin if installed
- "Draft an intro email to Globex's new product lead." → uses stored context to compose
- "List my active clients." / "Show me clients I haven't touched in 60 days."

Compares to: Cardhop, Notion CRM databases, Airtable client trackers, the "Contacts" tab in HoneyBook. Differentiator: chat-driven, file-backed, AI-summarizable without ETL or schema editor.

## Data model

One markdown file per client, mirroring the existing `~/mulmoclaude/data/contacts/` convention. Projects nest under their client:

```text
~/mulmoclaude/data/clients/
  acme.md
  globex.md
  acme/
    projects/
      site-redesign.md
      mobile-app.md
```

```markdown
---
id: acme
name: Acme Corp
status: active                   # active | paused | archived
contacts:
  - { name: Jane Doe, email: jane@acme.com, role: PM }
rate: { amount: 200, currency: USD, unit: hour }
paymentTerms: net-30
tags: [retainer, enterprise]
firstEngagement: 2024-09-01
---

# Acme Corp

Free-form notes — context, deal history, gotchas, relationship dynamics. The LLM reads this when asked "what do I know about Acme?"
```

Project files use the same shape with `clientId: acme` plus project-specific fields (`scope`, `feeModel`, `startDate`, `expectedDeliverables`, `status`).

**Why nested directories** (`acme/projects/...`) rather than flat `data/projects/<id>.md` with `clientId`: a client with no projects is still a valid record; a project without a client is not. Directory structure encodes the constraint.

## Tool surface

```ts
manageClient({
  action: "create" | "update" | "list" | "show" | "createProject" | "showProject" | "listProjects",
  id?: string,
  patch?: Partial<Client>,
  projectId?: string,
  projectPatch?: Partial<Project>,
})
```

- `create` and `createProject` write candidate files for user approval (AI-on-a-leash).
- `update`, `show`, `list*` operate on user-approved records directly.
- No `delete`. Soft-delete via `update({status: "archived"})` preserves backrefs from worklogs/invoices.

The tool description tells Claude to call `show` (not `list`) when the user names a specific client — `list` is for "show me all my clients" and renders a table; `show` is for "tell me about Acme" and renders a card.

## GUI surfaces

Two views, standard runtime-plugin Vue components:

1. **Client card** (`show`): name, key fields, contacts table, project list with status, free-form notes rendered as markdown. The card is the answer to "tell me about X".
2. **Client list** (`list`): table of all clients with status filter, sortable by `firstEngagement` / `name` / `status`. Click-through opens the card.

Reuse existing markdown rendering for the notes section. The list view is ~80 lines of thin table Vue; reuse `src/plugins/spreadsheet/`'s table component if it generalizes, otherwise inline.

No preview view in MVP; clients are pulled by name, not browsed in a sidebar.

## Phases

| Phase | Scope | Effort |
|---|---|---|
| 1 | Tool handlers + frontmatter schema + file I/O (read / write / list) | 3 days |
| 2 | Client card and list views | 2 days |
| 3 | Project sub-records (nested directory + project handlers + project list view) | 2 days |
| 4 | i18n for all 8 locales + tests | 1 day |

Total: ~8 working days for a polished v1.

## Cross-plugin reads (informational)

Other plugins read from `data/clients/` but never write:

- Worklog reads `data/clients/*.md` to populate a dropdown of valid `clientId` values for inferred entries.
- Invoice reads `rate`, `paymentTerms`, and primary `contacts` to fill invoice metadata.

This plugin does not need to know about those readers. The contract is the on-disk schema.

## Success criteria

The plugin ships when the user can do this against their real client list:

1. "Add a new client: Globex, hourly rate $180, primary contact Jane Doe at jane@globex.com." → candidate appears, user approves, file written.
2. "What do I know about Acme?" → card appears with notes, projects, contacts.
3. "List my active clients." → table.
4. "Archive the Hooli engagement; it's been dormant for 6 months." → status flip, no data loss.

Not in scope for v1:

- Contact deduplication across clients
- Auto-import from email signatures, vcards, LinkedIn
- Relationship timeline visualization
- Cross-client "people I work with" rollup
- Per-client document attachments (the markdown body is enough)

## Open questions

1. **Project file naming.** `acme/projects/site-redesign.md` vs. `clients/acme/site-redesign.md` (drop the `projects/` segment). The former groups by record type; the latter is less typing in chat references. Pick before phase 3.
2. **Where do contacts live?** Inline in the client's frontmatter (current proposal) or in a separate `data/contacts/` namespace with backrefs? Inline is simpler but duplicates a contact who works for two clients. Default: inline; revisit if duplication bites.
3. **Tags.** Free-form strings or a controlled vocabulary? Free-form for MVP. Add a `manageClient(action: "listTags")` later if grouping becomes important.
4. **Contact-plugin overlap.** MulmoClaude already has a `contacts` plugin for personal contacts. Should a client's contacts link out to that plugin's records, or stay self-contained? Self-contained for v1; introducing a join breaks the "useful alone" principle.
