# feat: collections "open" (read-only detail) mode + `?highlight=` handler

## Motivation

Record links emitted by skills (e.g. mc-invoice's "Linking to an invoice in
chat" section) point at `/collections/<slug>?highlight=<id>`. The query param
was being produced but not consumed — landing on the collection just showed the
list. This adds the back half: `?highlight=<id>` **opens** the referenced
record in a read-only detail view, distinct from the existing edit form.

## What shipped

Two files — no schema, server, or i18n changes.

### Link classifier: preserve the query string (`workspaceLinkRouter.ts`)

The first cut of open mode looked correct but the `?highlight=` never
arrived: `classifyWorkspacePath` (which routes agent-markdown links into SPA
navigation) called `stripFragmentAndQuery` for **all** targets, so
`/collections/mc-invoice?highlight=INV-2026-0001` became a bare
`/collections/mc-invoice`. Fix: a new `extractQuery` helper re-attaches the
query to `spa-route` targets only (`router.push(string)` parses it into
`route.query`). Wiki / file / session targets still strip — they route by
their own identifiers and take no query. Fragments stay dropped.

### CollectionView.vue

### Open mode (read-only detail modal)

- New `viewing = ref<CollectionItem | null>`, mutually exclusive with `editing`.
- A detail modal renders every field formatted for display (no inputs):
  - `boolean` → check icon / em-dash
  - `ref` → `<router-link>` to the target collection (`?highlight=` chained, so
    you can hop record→record)
  - `money` → `formatMoney`
  - `derived` → `derivedDisplay` (evaluated against the item)
  - `table` → read-only sub-table of all rows/columns
  - `markdown` → full text, `whitespace-pre-wrap` (not the 80-char table clip)
  - scalar → `formatCell`
- Header shows the record's primary-key value (`viewTitle`) + an **Edit** button
  (`editFromView` hands off to the existing editor) + close.

### Entry points

- **Deep link**: `loadCollection` calls `maybeOpenHighlighted` once items are
  loaded; a `watch` on `route.query.highlight` covers same-collection link
  hops. Unknown id → no-op (stale/deleted links just show the list).
- **Row click**: table rows are clickable → open mode. Ref-links and the
  Edit/Remove action buttons use `@click.stop` so they keep their own behavior.
- `closeView` drops the `?highlight=` query param so refresh / back doesn't
  reopen and the URL reflects the closed state.

## Testing

- `yarn format` / `lint` / `typecheck` / `build` / `test` (5141 unit) — green.
- No automated UI test: collections has **no** e2e harness yet (edit/create
  aren't covered either), so this was verified manually in the running app.
  Building a collections e2e mock layer is out of scope for this change.

## Out of scope / deferred

- Scroll-into-view + row pulse on the list itself (the original "highlight"
  literal reading) — superseded by "open the record", which is what the user
  asked for.
- `actions` field type (Mark Sent / Mark Paid) + PDF export — the remaining
  mc-invoice follow-up.
- A collections e2e mock harness.
