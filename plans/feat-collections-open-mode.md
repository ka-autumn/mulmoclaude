# feat: collections "open" (read-only detail) mode + `?selected=` handler

## Motivation

Record links emitted by skills (e.g. mc-invoice's "Linking to an invoice in
chat" section) point at `/collections/<slug>?selected=<id>`. The query param
was being produced but not consumed — landing on the collection just showed the
list. This adds the back half: `?selected=<id>` **opens** the referenced
record in a read-only detail view, distinct from the existing edit form.

## Naming

The query param is `?selected=<id>` (not `?highlight=`). "Highlight" implied
flagging a row in the list; the behavior is "open this record in detail mode",
so "selected" reads truer. Renamed across the classifier, CollectionView, the
link tests, and the three `mc-*` skill files.

## What shipped

### Link classifier: preserve the query string (`workspaceLinkRouter.ts`)

The first cut of open mode looked correct but the `?selected=` never
arrived: `classifyWorkspacePath` (which routes agent-markdown links into SPA
navigation) called `stripFragmentAndQuery` for **all** targets, so
`/collections/mc-invoice?selected=INV-2026-0001` became a bare
`/collections/mc-invoice`. Fix: a new `extractQuery` helper re-attaches the
query to `spa-route` targets only (`router.push(string)` parses it into
`route.query`). Wiki / file / session targets still strip — they route by
their own identifiers and take no query. Fragments stay dropped.

### CollectionView.vue

### Open mode (read-only detail modal)

- New `viewing = ref<CollectionItem | null>`, mutually exclusive with `editing`.
- A detail modal renders every field formatted for display (no inputs):
  - `boolean` → check icon / em-dash
  - `ref` → `<router-link>` to the target collection (`?selected=` chained, so
    you can hop record→record)
  - `money` → `formatMoney`
  - `derived` → `derivedDisplay` (evaluated against the item)
  - `table` → read-only sub-table of all rows/columns
  - `markdown` → full text, `whitespace-pre-wrap` (not the 80-char table clip)
  - scalar → `formatCell`
- Header shows the record's primary-key value (`viewTitle`) + an **Edit** button
  (`editFromView` hands off to the existing editor) + close.

### Entry points

- **Deep link**: `loadCollection` calls `syncViewToSelected` once items are
  loaded; a `watch` on `route.query.selected` covers same-collection link
  hops. `?selected=` is the single source of truth — `syncViewToSelected`
  opens the matching record, or **closes** the modal when the param is absent /
  empty / points at a missing id (so browser-back and stale/deleted links both
  land on the list, never leaving stale UI on screen).
- **Row click**: table rows are clickable → open mode. Rows are keyboard
  operable too (`role="button"`, `tabindex="0"`, Enter / Space, an
  `openItem` aria-label). Ref-links and the Edit/Remove action buttons use
  `@click.stop` so they keep their own behavior.
- `closeView` drops the `?selected=` query param so refresh / back doesn't
  reopen and the URL reflects the closed state.

## Review round (PR #1502)

- Modal now closes when `?selected=` is removed (browser back) or points at a
  missing id — `syncViewToSelected` replaced the open-only helper (Codex P2 +
  CodeRabbit).
- Row is keyboard/AT-accessible (`role`/`tabindex`/Enter+Space + aria-label).
- `viewTitle` stringifies a non-string primary key instead of dropping it.

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
