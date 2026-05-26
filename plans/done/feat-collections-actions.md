# Plan: `actions` — schema-declared record actions for collections

Follow-up to the collections primitives shipped in
[plans/done/feat-skill-driven-apps.md](done/feat-skill-driven-apps.md) (fields), `feat-collections-ref-field`
(`ref`), and `feat-collections-embed` (`embed` + `singleton`). Adds a
generic **`actions`** declaration so a collection's read-only detail view
can offer per-record buttons that kick off work — the first kind being
"start a new chat in a role with a templated seed prompt" (e.g. the
invoice "Generate PDF" button).

## Hard constraint: zero domain-specific host code

This is a **generic mechanism**. The host (`server/`, `src/`) must contain
**no** invoice / PDF / accounting / `me` / `mc-*` literals. Everything
specific to a given collection lives in **data**:

- the action declaration (label, icon, role, template name) → the
  collection's `schema.json`
- the prompt body / layout / output instructions → a template file in the
  **skill folder** (`<skill>/templates/<name>.md`)

The host only knows how to: render a button per declared action, read a
named template from the skill dir, splice the record's data into a seed
prompt, and start a chat in the declared role. Same discipline as `ref`,
`embed`, and `singleton` — the host holds the primitive; the schema/skill
holds the meaning.

This mirrors what the legacy `packages/plugins/invoice-plugin/` did
(`buildSeedPrompt` at `index.ts:94`, `triggerPrintableGeneration` at
`View.vue:914`) — except that logic was hard-coded invoice plugin code;
here it becomes a generic collection capability driven entirely by data.

## Schema language addition

A new top-level `actions` array on the collection schema:

```jsonc
{
  "title": "Invoices",
  "primaryKey": "id",
  "fields": { /* … */ },
  "actions": [
    {
      "id": "pdf",                  // stable id (used in the route + testids)
      "label": "Generate PDF",      // button text (English, like field labels)
      "icon": "picture_as_pdf",     // Material icon name (optional)
      "kind": "chat",               // the only kind in v1
      "role": "accounting",         // role id the new chat runs in
      "template": "templates/invoice.md"  // file under the skill dir
    }
  ]
}
```

- `id`, `label`, `kind`, `role`, `template` required; `icon` optional.
- `kind` is an enum; v1 ships only `"chat"` (start a templated chat).
  Leaving it explicit reserves room for a future `"mutate"` kind
  (Mark Sent / Mark Paid) without another schema-shape change.
- `template` is a workspace-skill-relative path validated against the same
  safe-name rules the rest of the module uses (no `..`, no separators
  beyond a single `templates/` segment) — it becomes a file read.
- `role` is a plain string; the host does not hard-code any role id. (It
  may optionally warn-and-skip if the id isn't a known role, but that's a
  generic lookup, not a domain literal.)

The record's shape is unchanged — `actions` are pure UI/behaviour
directives, never persisted, never validated against record data.

## Host changes (all generic)

### Server (`server/workspace/collections/` + `server/api/routes/collections.ts`)

- **`types.ts`** — add `actions?: CollectionAction[]` to `CollectionSchema`;
  `CollectionAction = { id; label; icon?; kind: "chat"; role; template }`.
- **`discovery.ts`** — extend `CollectionSchemaZ` with an `actions` array
  schema; validate each action's fields and that `template` is a safe
  relative path. Bad actions reject the whole schema (consistent with the
  existing fail-closed validation).
- **`io.ts` / `paths.ts`** — a path-safe `readSkillTemplate(skillDir, name)`
  that resolves the template under the skill directory and refuses
  traversal (same containment check used for `schema.json` and item files).
- **`server/api/routes/collections.ts`** — a new generic endpoint:

  ```text
  POST /api/collections/:slug/items/:itemId/actions/:actionId
    → 200 { prompt: string, role: string }
    → 404 unknown slug / item / action
  ```

  Handler (no domain logic):
  1. load the collection + the record by `itemId`
  2. find the action by `actionId` in `schema.actions`
  3. read the action's `template` from the skill dir
  4. assemble the seed prompt = a security-boundary wrapper + the record
     serialized as an escaped JSON data block + the template text verbatim
  5. return `{ prompt, role: action.role }`

  Assembly stays server-side so the injection-escaping (mirroring the
  legacy `escapeForPrompt`) is centralized and the template never has to
  be shipped in the detail response. The endpoint does **not** itself
  create the chat — it returns the assembled prompt so the frontend can
  reuse the existing `startNewChat` path.

### Frontend (`src/components/CollectionView.vue`)

- Render an action button per `schema.actions` entry **only in the
  read-only detail modal** (where a saved record is open — `viewing`
  set). Skipped in the list table and the edit form. Buttons sit in the
  modal header next to **Edit**; icon + label, generic.
- On click: `POST` the action endpoint, then call
  `useAppApi().startNewChat(res.prompt, res.role)`
  (`src/composables/useAppApi.ts:10`). `CollectionView` is inside the
  `App.vue` provide/inject subtree, so `startNewChat` is available — it
  creates a session in the role and submits the seed in one call,
  replacing all of the legacy plugin's bespoke chat-start plumbing.
- Standard `fetch` error handling (network + `!res.ok`) per CLAUDE.md.
- Labels come from the schema (English), consistent with field labels —
  no new `src/lang/*` keys for the button text itself. (Any host-owned
  failure toast would use an i18n key, added across all 8 locales.)

## Skill-side (data only — the invoice's responsibility)

- `server/workspace/skills-preset/mc-invoice/schema.json` — add the
  `actions` entry above.
- `server/workspace/skills-preset/mc-invoice/templates/invoice.md` — a new
  template carrying **all** invoice-specific content: the print layout
  (lifted from the legacy `${…}` template in `invoice-plugin/index.ts`)
  plus instructions telling the agent to read the client
  (`data/clients/items/<clientId>.json`) and issuer
  (`data/profile/items/me.json`) records, render the document, write it to
  `artifacts/invoices/<id>.md`, and show a preview. The host injects only
  the invoice record JSON; the agent resolves the referenced files itself
  (it has Read/Write in any role). The preset sync already copies the full
  skill tree, so `templates/` ships automatically.
- `mc-invoice/SKILL.md` — a short note that the host renders a "Generate
  PDF" action on the detail view and that the agent should never write the
  artifact unprompted.

## Decisions (locked unless you say otherwise)

1. **Role** = `accounting` (existing, `src/config/roles.ts:262`). It's a
   schema value, not host code, so it's trivially changeable per
   collection. Base Read/Write tools are available in every role; the role
   governs the system prompt + plugin tools.
2. **"PDF"** = a printable markdown artifact at `artifacts/invoices/<id>.md`
   rendered in chat → browser print-to-PDF, exactly like the legacy flow.
   No headless PDF renderer in v1.
3. **Assembly** = server-side endpoint returning `{ prompt, role }`;
   frontend reuses `startNewChat`. (Keeps escaping centralized; keeps the
   template out of the detail payload.)
4. **Scope** = `kind: "chat"` only. `"mutate"` actions (Mark Sent / Paid)
   deferred to a later PR — the enum reserves the seam.

## Test plan

- `discovery` tests: accept a schema with a valid `actions` entry; reject
  missing `id`/`label`/`role`/`template`; reject a `template` with path
  traversal; reject an unknown `kind`.
- A pure, exported seed-assembly helper (record + template text →
  prompt) unit-tested for: the record JSON block is present and escaped,
  the template text is included verbatim, and a record value containing
  markup can't break out of the data block.
- Route smoke (if/where a harness exists): unknown slug/item/action → 404;
  valid → `{ prompt, role }`.
- Manual (no collections e2e harness): open an invoice → "Generate PDF" →
  lands in a new accounting chat that renders + writes the artifact.
- `yarn format` / `lint` / `typecheck` / `test` / `build` green.

## Deferred

- `kind: "mutate"` actions (status transitions) — needs a write-back path
  and a confirm step.
- Headless / binary PDF generation.
- Action visibility conditions (e.g. only show "Generate PDF" when
  `status === "draft"`) — a `when` predicate on the action; defer until a
  real need.
- Passing resolved `ref`/`embed` records into the data block host-side
  (v1 lets the agent read those files itself, keeping the host generic).

## What success looks like

- One new generic primitive (`actions`) costs ~the same as `ref`/`embed`:
  types + discovery + one route + a detail-view button loop.
- The invoice "Generate PDF" feature adds **zero** host code — only a
  `schema.json` entry and a template file in the skill folder.
- The same mechanism can drive a "Generate report", "Draft email", etc.
  on any other collection purely from its schema + skill templates.
