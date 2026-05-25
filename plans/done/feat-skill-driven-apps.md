# Plan: Skill-driven Apps (PoC)

## Hypothesis

Per-feature plugins (worklog / client / invoice — ~3,000 lines each, requires
PR + build + plugin registration) can be replaced by:

1. A **small set of generic host primitives** (schema-driven CollectionView,
   later: template renderer, `$ref` resolver), and
2. **Feature-specific skills** that declare a schema, a folder layout, and
   workflow instructions for Claude.

The skill system already exists in MulmoClaude (preset → catalog → star →
`.claude/skills/`). This PoC adds the missing piece — a **schema-driven
CollectionView primitive** — and validates the model with one app (clients).

Out of scope for the PoC: migrating worklog or invoice. Those have richer
UX needs (drag-to-reorder line items, PDF export, cross-collection links)
that should only be tackled once the basic shape is proven.

---

## Architecture

### Reused as-is

| Piece | Path | Role |
|---|---|---|
| Skill discovery | `server/workspace/skills/discovery.ts` | Finds SKILL.md under `~/.claude/skills/` + `<workspace>/.claude/skills/` |
| Preset bundle | `server/workspace/skills-preset/<slug>/` | Source-tree home for launcher-shipped skills |
| Preset sync | `server/workspace/skills-preset.ts` | Boot-time copy preset → `data/skills/catalog/preset/` |
| Catalog → active | `server/workspace/skills/catalog.ts#starCatalogEntry` | `copyDirTree` from catalog into `.claude/skills/` |
| Files API | `server/api/routes/files.ts` | Generic file read/write — used by CollectionView for CRUD |

### What this PoC adds

1. **Generalize preset sync to copy entire skill directory.** Today
   `copySourcesIntoDest` copies only `SKILL.md`. Schemas, templates, and any
   other sibling files would silently get dropped on boot. Change it to walk
   the source skill directory recursively. `copyDirTree` in
   `catalog.ts` already does the right thing on the star side.

2. **Schema convention.** A skill that ships a `schema.json` alongside
   `SKILL.md` is *also* an "app" — the host renders its records via the
   CollectionView primitive. A skill without `schema.json` stays a normal
   instructional skill, unchanged.

3. **App discovery endpoint** (`GET /api/apps`): scans
   `~/.claude/skills/*/schema.json` + `<workspace>/.claude/skills/*/schema.json`
   (active skills only — not catalog), returns `[{ slug, title, icon, dataPath }]`.
   `GET /api/apps/:slug` returns `{ schema, items }`.

4. **`<AppCollectionView>` Vue primitive.** Schema-driven table + edit modal.
   Reads via `/api/apps/:slug`; writes via existing `/api/files/content` PUT
   (already supported for JSON files in workspace).

5. **Route `/apps/:slug`** in vue-router + App.vue switch case. Sidebar gets
   one "Apps" launcher that lists discovered apps.

6. **Sample app `mc-clients`** under `server/workspace/skills-preset/`.

7. **"Account beta" role** in `src/config/roles.ts` whose prompt instructs
   Claude to use the `mc-clients` skill and whose `availablePlugins` is
   intentionally tiny (just `presentForm`). Native Read / Write / Edit from
   the Agent SDK do the CRUD.

### Schema format (v0)

Minimal, JSON-Schema-ish but with UI hints inline. Lives at
`<skillDir>/schema.json`.

```json
{
  "title": "Clients",
  "icon": "people",
  "dataPath": "data/clients/items/",
  "primaryKey": "id",
  "fields": {
    "id":      { "type": "string",   "label": "ID",      "primary": true },
    "name":    { "type": "string",   "label": "Name",    "required": true },
    "email":   { "type": "email",    "label": "Email" },
    "address": { "type": "text",     "label": "Address" },
    "notes":   { "type": "markdown", "label": "Notes" }
  }
}
```

Supported field types for v0: `string | text | email | number | date | markdown`.

**Deferred** (will surface as needs emerge during migration of real apps):

- `ref` (cross-collection links) — needed for invoice → client / worklog
- `table` (nested array of objects) — needed for invoice line items
- `money` (currency-aware number) — needed for invoice
- `derived` (computed fields like `total`) — needed for invoice
- `actions` (status changes, export-PDF) — needed for invoice send/mark-paid
- Validation beyond `required`

### Sample app: `mc-clients`

- `server/workspace/skills-preset/mc-clients/SKILL.md` — Claude's instructions
  for clients CRUD, referencing `data/clients/items/<id>.json`
- `server/workspace/skills-preset/mc-clients/schema.json` — the schema above

Boot flow:
1. Preset sync copies `mc-clients/` (both files) → `data/skills/catalog/preset/mc-clients/`
2. User opens `/skills`, sees Clients in the catalog, clicks ★ → copied to `.claude/skills/mc-clients/`
3. Now both Claude (via skill discovery) and the host UI (via `/api/apps`) see it

### "Account beta" role

```ts
{
  id: "account-beta",
  name: "Account beta",
  icon: "science",  // beta flask
  prompt:
    "You are a beta accounting assistant testing the skill-driven app architecture.\n\n" +
    "You have a `mc-clients` skill that defines a client database. Use it whenever the user " +
    "asks to add, list, edit, or delete clients. Follow the conventions in that skill exactly — " +
    "the file layout is the source of truth; the UI reads the same files.\n\n" +
    "Use Read / Write / Edit directly for file I/O. Use presentForm when you need information " +
    "from the user that isn't already provided.",
  availablePlugins: [TOOL_NAMES.presentForm],
  queries: [
    "Add a client: Acme Corp, billing@acme.example, San Francisco",
    "List my clients",
    "What's Acme's email?",
    "Update Acme's address to 'One Market Plaza, San Francisco'",
  ],
  isDebugRole: true,  // hides from the default role picker until proven
}
```

---

## Implementation tasks

Tracked in the live TaskList:

1. Write this plan
2. Author `mc-clients` skill (SKILL.md + schema.json) under `skills-preset/`
3. Generalize preset sync to copy entire skill tree
4. Add `GET /api/apps` + `GET /api/apps/:slug` server endpoints
5. Build `<AppCollectionView>` Vue component
6. Wire `/apps/:slug` route + sidebar entry
7. Add "Account beta" role
8. Run yarn format / lint / typecheck / build

---

## Test plan

After `yarn build`:

1. **Boot**: `yarn dev` — verify log shows `mc-clients` in preset sync
2. **Star**: navigate to `/skills`, find Clients in the catalog, click ★ — verify
   `.claude/skills/mc-clients/{SKILL.md,schema.json}` exists in the workspace
3. **Role**: select "Account beta" → prompt
   `"Add a client: Acme Corp, billing@acme.example"` → verify
   `data/clients/items/<id>.json` is created with the right shape
4. **View**: navigate to `/apps/mc-clients` — verify Acme appears in the table
5. **Edit**: click the row → modify email → save → verify file updates
6. **Delete**: click delete in modal → verify file removed
7. **Add via UI** (not just via Claude): click "+" → fill form → verify file
   created and Claude can list it on next turn
8. **Refresh**: leave the app open while Claude adds another via chat → verify
   the new row appears (poll or pubsub — acceptable to require manual refresh
   for the PoC)

---

## Honest limits of the PoC

- **No bespoke UX**: CollectionView is generic table + form. Anything richer
  (drag-to-reorder, inline editing with keyboard nav, status badges with
  workflow rules) is out of scope. The escape hatch — letting a skill ship
  its own Vue component — is a separate design problem; the right time to
  solve it is after the generic path has shipped enough apps to know what's
  missing.
- **No relationships**: clients is a single-collection app. Cross-collection
  references (`invoice.clientId → client`) are deliberately deferred — they
  introduce the hardest design question (ref resolution, dangling-ref UX,
  cascade rules), and one of those is enough work for a separate iteration.
- **No template renderer**: PDF/HTML export is the second-biggest piece of
  the invoice plugin and is also deferred — it's an additive primitive, not
  a blocker for proving the schema-driven shape works.
- **Live updates**: if the user edits via UI while Claude is composing, or
  vice versa, the other side won't see it without a manual refresh. The
  existing file-change pubsub (`server/events/file-change.ts`) is the right
  long-term plumbing; PoC accepts manual refresh.

---

## What success looks like

After clients-as-a-skill is working end-to-end, the comparison vs.
clients-as-a-plugin (`packages/plugins/client-plugin/`, ~1,500 lines):

- **Skill side**: ~2 files (SKILL.md + schema.json), maybe ~100 lines total
- **Host side**: shared CollectionView reused for every future app
- **Adding a new app** (e.g. bookmarks, projects, contacts): drop a folder
  under `skills-preset/`, no PR to host code

If that comparison feels obviously better, migrate worklog next (simpler
than invoice, shares the same primitive). If it feels meaningfully worse —
e.g. the form UX is too generic, the schema language hits its limits too
quickly, or skill-authoring is harder than expected — the PoC is cheap to
abandon; the existing plugins keep working.
