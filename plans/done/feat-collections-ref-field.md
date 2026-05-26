# Plan: `ref` Field Type for Collections

Follow-up to [plans/done/feat-skill-driven-apps.md](done/feat-skill-driven-apps.md)
(PR #1483) and [plans/done/feat-skill-driven-apps-worklog.md](done/feat-skill-driven-apps-worklog.md)
(PR #1489). First of three follow-up PRs aimed at making the
schema-driven collection primitive expressive enough for invoice
migration. This PR adds **only** the `ref` field type — `money`,
`table`, `derived`, and `actions` are deferred to subsequent PRs.

## Why this PR alone

`mc-worklog` declares `clientId` as a plain `string` today. Its
SKILL.md tells Claude to manually resolve client names to slugs by
listing `data/clients/items/` first — a "soft" cross-collection
reference that's the LLM's responsibility to honor. The host
validates nothing and the UI shows just the raw slug.

`ref` turns that informal convention into a first-class schema
construct: the field declares which collection it points at, the
host renders a clickable link (Acme Corp → `/collections/mc-clients`),
and the form provides a dropdown picker. Pulling this out as its own
PR also tests the **pattern** for adding a new schema feature — a
template that PR-B (`money` + `table` + `derived`) and PR-C
(`actions` + template renderer + invoice skill) can both follow.

## Architecture

### Schema language addition

```jsonc
"clientId": {
  "type": "ref",
  "to": "mc-clients",      // collection slug the value references
  "label": "Client",
  "required": true
}
```

The record stores the **slug** of the target item — no shape change
(`{"clientId": "acme-corp"}` looks identical before and after).
The schema just gives the host enough metadata to:

- render a clickable link instead of plain text,
- present a dropdown picker instead of a free-text input,
- (later) validate the slug exists in the target collection.

### Host changes

**Server** (`server/workspace/collections/`):

- `types.ts`: add `"ref"` to `CollectionFieldType`; `CollectionFieldSpec`
  gains an optional `to?: string`.
- `discovery.ts`: extend `FieldSpecSchema` so `type: "ref"` requires
  a non-empty `to`; bare `type: "ref"` (no `to`) rejects the schema.

No runtime validation (the slug being a real client) — deferred. The
SKILL.md still tells Claude to use real client slugs; the schema
declaration plus dropdown UI is the safety net for human input.

**Frontend** (`src/components/CollectionView.vue`):

- New `refCache: Record<targetSlug, Record<itemSlug, displayName>>`
  loaded after the current collection's items arrive. One fetch per
  unique target collection, regardless of how many ref fields point
  there.
- **Table cell**: `<router-link>` to `/collections/<to>` (with
  `?highlight=<slug>` query). Displays the heuristic name (prefers
  `name` field, falls back to `title`, then primaryKey value).
- **Form input**: `<select>` populated from the cached items;
  falls back to plain text input if the target collection has no
  items or hasn't loaded.
- `draftToRecord` / `openCreate` / `openEdit` / required-check:
  ref values bucket with text (same string-typed slot, no boolean-
  style preservation needed).

Highlight rendering (scroll-into-view + visual ping on the matching
row) is deferred — query param is set, scroll handler is a small
follow-up.

### Skill update

`server/workspace/skills-preset/mc-worklog/schema.json`: change
`clientId` from `type: "string"` to:

```json
{ "type": "ref", "to": "mc-clients", "label": "Client", "required": true }
```

`SKILL.md`: drop the "## clientId resolution (until `ref` exists)"
section that walked Claude through the manual lookup. Replace with
a brief note that the host UI provides a picker and that Claude
should still pick a real existing slug rather than inventing one
(the picker is for the human; Claude writes the raw slug).

## Test plan

After `yarn dev` reboot, the auto-update sync will pick up the new
mc-worklog SKILL.md + schema.json (no manual re-star needed).

- [ ] `/collections/mc-worklog` table shows the `Client` column as
      clickable links displaying the client's `name` (e.g. "Acme
      Corp"), not the raw slug
- [ ] Clicking a client link lands on `/collections/mc-clients?highlight=acme-corp`
- [ ] `+` on mc-worklog renders the Client field as a `<select>`
      populated with all clients; selecting one saves the slug
- [ ] Editing an existing entry shows the current client pre-selected
- [ ] If the dropdown is empty (e.g. user deleted all clients), the
      field falls back to a text input so the form still works
- [ ] A schema declaring `type: "ref"` without `to` is rejected on
      discovery (warn-and-skip; covered by new test)
- [ ] All existing apps tests + 437 e2e tests still pass

## Deferred (the gap from a full ref implementation)

- **Runtime referential integrity**: writing a worklog with
  `clientId: "nonexistent-slug"` is currently accepted. Server-side
  validation is straightforward (the host already loads target
  collections for the dropdown) but adds the question of what to
  do with orphaned refs when a target gets deleted (cascade /
  reject / soft-orphan). Defer until the question forces itself.
- **Display field declaration**: target collections currently
  surface a heuristic name (`name` / `title` / primaryKey). Adding
  `displayField` to the schema gives the author explicit control
  but adds a knob; defer until a real schema wants something other
  than the heuristic.
- **Highlight on landing**: the link sets `?highlight=<slug>` but
  CollectionView doesn't yet scroll-into-view + visual ping. Small,
  cosmetic; defer.
- **Reverse navigation** (`/collections/mc-clients` showing "used by
  N worklog entries"): would require an index across collections.
  Out of scope for ref alone.

## What success looks like

- One new field type costs ~50 LoC across types + discovery + UI
  (matches the boolean cost from PR #1489)
- `mc-worklog` SKILL.md shrinks (drops the manual-resolution section)
- Clicking a client in the worklog table lands on the client view
- The pattern (schema enum extension + UI branch + cache + skill
  migration) is reusable for the remaining field types in PR-B/C
