# feat: `presentCollection` — inline editable collection card in chat

## Goal

Let the LLM present a collection (or a specific item) inline in a chat
session via a `presentCollection` MCP tool. The rendered card reuses the
**full `CollectionView`** surface: the collection list/grid in the card
body, and the existing detail / edit modal overlay popping **on top** when
an item is opened. Edits write back to the workspace through the existing
`/api/collections/...` REST routes — no new persistence layer.

Decision (confirmed with user): **inline card, editable**, and **reuse
`CollectionView` wholesale** rather than extracting field renderers.

## Why this shape

- The gui-chat-protocol render contract is already proven by the
  `present*` family (`presentForm`, `presentSpreadsheet`, …): an MCP tool
  returns a `ToolResult` whose `data` field is the host's
  render-eligibility signal; the plugin's `viewComponent` then renders
  with the `selectedResult` prop (`src/components/StackView.vue`).
- Editable-in-card CRUD is also already precedented — `canvas/View.vue`,
  `markdown/View.vue`, `presentSVG/View.vue` all `apiPut` real workspace
  data from inside the card. `CollectionView` already does the same via
  `apiPost`/`apiPut`/`apiDelete` against `API_ROUTES.collections.*`.
- So **no protocol change** and **no new server CRUD route** is needed.
  The card is a thin wrapper that mounts `CollectionView`; `CollectionView`
  fetches and mutates live workspace state itself.

## The one real refactor: decouple `CollectionView` from the router

`CollectionView.vue` is currently **router-driven**, not prop-driven:

| Concern | Today | Lines |
|---|---|---|
| which collection | `route.params.slug` | 1933, 1959 |
| which item is open | `route.query.selected` | 1606, 1952 |
| open/close item | `router.replace` (drop `?selected=`) | 1577–1581 |
| back to index | `router.push` | 1929 |

Mounted as-is in a chat card it would read the **chat** route (wrong
slug) and navigate the app away from chat on interaction. Fix: give it a
**prop-or-route** source and two modes.

### Changes to `src/components/CollectionView.vue`

1. Add optional props + emit (defaults keep standalone route mode intact):
   ```ts
   const props = defineProps<{ slug?: string; selected?: string }>();
   const emit = defineEmits<{ (e: "select", id: string | null): void }>();
   const embedded = computed(() => props.slug !== undefined);
   const activeSlug = computed(() =>
     props.slug !== undefined
       ? props.slug
       : (typeof route.params.slug === "string" && route.params.slug.length > 0 ? route.params.slug : undefined));
   const activeSelected = computed(() =>
     embedded.value
       ? props.selected
       : (typeof route.query.selected === "string" ? route.query.selected : undefined));
   ```
2. Replace `onMounted` + the `route.params.slug` watch with a single
   `watch(activeSlug, …, { immediate: true })` (same load/clear logic).
3. `syncViewToSelected()` reads `activeSelected.value` instead of
   `route.query.selected`; the `route.query.selected` watch becomes
   `watch(activeSelected, …)`.
4. `openView(item)`: in embedded mode also `emit("select", id)`.
5. `closeView()`: in embedded mode `emit("select", null)` and return
   (skip `router.replace`); standalone path unchanged.
6. Hide the header back button when `embedded` (`v-if="!embedded"`); a
   chat card has no "collections index" to go back to.

Everything else — the edit/create/detail modals, `EditState`,
`draftToRecord`, the CRUD calls, ref/embed/derived rendering — is
untouched. Standalone `/collections/:slug` behaviour is byte-for-byte
identical when no `slug` prop is passed.

**Known v1 limitation (follow-up):** `ref`-field `<router-link>`s in the
table/detail still navigate the app route; clicking one in an embedded
card leaves the chat. Acceptable for v1; document and revisit.

## The plugin (`src/plugins/presentCollection/`)

Built-in plugin; barrels (`metas.ts`, `index.ts`, `server.ts`) are
**auto-generated** by `yarn plugins:codegen` (predev/prebuild) — just drop
the directory.

- `meta.ts` — `definePluginMeta({ toolName: "presentCollection",
  apiNamespace: "presentCollection", apiRoutes: { dispatch: { method:
  "POST", path: "" } }, mcpDispatch: "dispatch" })`. Namespace is distinct
  from the host's `collections` REST routes, so no aggregator collision.
- `types.ts` — `PresentCollectionData = { collectionSlug: string; itemId?: string }`,
  `PresentCollectionArgs` (same shape).
- `definition.ts` — `TOOL_DEFINITION` with params
  `{ collectionSlug: string (required), itemId?: string }`; derive
  `TOOL_NAME = META.toolName`.
- `plugin.ts` — `executePresentCollection(_ctx, args)`: validate
  `collectionSlug` is a non-empty string, return
  `{ message, data: { collectionSlug, itemId }, jsonData, instructions }`.
  Pure / isomorphic (no Vue, no Node-only imports — it's bundled to the
  browser via `index.ts` and run server-side via `plugins.ts`). Existence
  of the slug is validated client-side by `CollectionView`'s `loadError`
  (`"not-found"`) path.
- `index.ts` — `REGISTRATION` with
  `viewComponent: wrapWithScope("presentCollection", View)` and
  `previewComponent: wrapWithScope("presentCollection", Preview)`.
- `View.vue` — thin wrapper: reads `selectedResult.data` →
  `{ collectionSlug, itemId }`; `selected` = `viewState.selected` (if the
  user navigated within the card) else `itemId`; mounts
  `<CollectionView :slug :selected @select>`; on `select` emits
  `updateResult` with `viewState: { selected }` so the open item survives
  re-render (the `presentForm` viewState pattern).
- `Preview.vue` — compact transcript card (collection title/slug + open
  item id if any).

## Host wiring

1. **`server/api/routes/plugins.ts`** (NOT auto-generated): add
   ```ts
   bindRoute(router, API_ROUTES.presentCollection.dispatch,
     wrapPluginExecute((req) => executePresentCollection(null as never, req.body)));
   ```
2. `yarn plugins:codegen` — regenerates `_generated/{metas,registrations,server-bindings}.ts`.
3. **`src/main.ts`** — add `presentCollection: API_ROUTES.presentCollection`
   to `pluginEndpointRegistry`. **Required**: `wrapWithScope` calls
   `pluginEndpoints("presentCollection")` at View setup, which THROWS
   `Unknown plugin endpoint scope` if the scope isn't registered here.
   The throw aborts setup, leaves the component subtree null, and the
   next `<App>` patch crashes with `emitsOptions` / `subTree` of null —
   surfacing only as Vue-internal errors, not the real cause. (This was
   the actual bug in the first cut.)
4. **`src/config/roles.ts`** — add `TOOL_NAMES.presentCollection` to
   `availablePlugins` of **General** and **Personal** (Office/accounting/
   investor use specialised tools, not generic collections). The tool
   description carries the when-to-use guidance, so no prompt edits.
5. **i18n** — add `pluginPresentCollection.*` keys (Preview labels only;
   the View inherits `CollectionView`'s existing `collectionsView.*`
   strings) to **all 8** locales in lockstep.

## Regression test

`e2e/tests/present-collection.spec.ts` — injects a `presentCollection`
tool result (with `itemId`) into a mocked session, mocks
`/api/collections/watchlist`, and asserts the card renders, the detail
modal opens, and **no uncaught page error fires** (guards the scope-
registration crash above).

## Validation

`yarn format && yarn lint && yarn typecheck && yarn build`. Manual: in
`yarn dev`, a chat in a role with the tool → LLM calls
`presentCollection({ collectionSlug })` → list card renders; opening a row
shows the detail modal over the card; Edit writes back and the list
refreshes.

## Follow-up: inline panels instead of modals

The item detail / edit / create surfaces were modals (`fixed inset-0`),
which felt unnatural — and in the chat card a full-viewport overlay over
a card is jarring. Replaced with **inline panels** (applies to both the
standalone `/collections/:slug` page and the chat card — `CollectionView`
itself):

- **Detail & edit** expand as a panel **directly under the open row**
  (`<tr>` + full-width `<td :colspan>`). Edit reuses the detail **2-col
  grid layout** (label + input), so detail↔edit is visually continuous.
- **Create** rides a **synthetic top row** (`CREATE_ROW_ID`) whose data
  row is hidden — only its expansion (the form) shows, pinned above the
  list. This keeps the edit form in a SINGLE template location (no
  duplication, no child component, no `vue/no-mutating-props` fight).
- **One panel open at a time** (`viewing` / `editing` single refs;
  `openView`/`openEdit`/`openCreate` clear the others). Clicking the open
  row toggles it closed. Panels cap at `max-h-[60vh]` with internal
  scroll so the list isn't pushed far down.
- Empty / no-match states are suppressed while creating so the create
  panel still renders on an empty collection.
- No `fixed`-overlay modal remains for records (the **chat** modal is
  unchanged). e2e asserts `.fixed.inset-0.z-30` count is 0 after Edit.

e2e (`present-collection.spec.ts`) covers: detail-on-mount, Edit→in-place
edit form, and Add→top create panel. All 12 existing collection specs
(standalone route) still pass.

## Out of scope (v1)

- ref-link in-card navigation (see limitation above)
- existence validation in the executor (handled client-side)
- e2e fake-agent detector for the new tool
