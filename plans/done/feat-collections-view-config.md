# Collections: view config page, drop dashboard, custom views for feeds

Follow-up to `plans/feat-collections-custom-views.md` (now merged). Three
independent changes, shippable separately. Discussed 2026-06-14.

**STATUS: all three parts landed** on `feat/collections-view-config`
(2026-06-14). Part 1 — dashboard removed. Part 2 — config modal +
`DELETE /api/collections/:slug/views/:viewId`. Part 3 — feeds get custom views
(gate flip + source-aware author prompt + help docs).

## Background (current state)

- **Built-in views** live in `CollectionView.vue`: `table` (always),
  `calendar` (has date field), `kanban` (has enum field), `dashboard` (has
  enum field). Mode strings + availability in
  `src/composables/collections/collectionViewMode.ts`.
- **Custom views** are schema-declared (`schema.views[]:
  CollectionCustomView`), HTML authored under `views/<id>.html`, rendered in a
  sandboxed iframe by `CollectionCustomView.vue` via a scoped view-token. The
  server read (`server/workspace/collections/io.ts` → `readCustomViewHtml`) is
  already **source-aware**: project collections read from
  `data/skills/<slug>/`, user/feed collections from their own `skillDir`.
- **Dashboard** is `src/components/CollectionDashboardView.vue` — read-only
  stat cards + `notifyWhen` alert + grouped list. Toggle button at
  `CollectionView.vue:187-198`; gated by `hasDashboard` (enum field present).
- **Adding** a custom view: the `+` button (`CollectionView.vue:214-224`,
  `canAddCustomView` at :1482) seeds a chat with `addViewPrompt`. **No delete
  UI exists.** Feeds are explicitly excluded (`!isFeed.value`).

---

## Part 1 — Remove the built-in dashboard view

Rationale: low value as a fixed view; anyone who wants it can author a custom
view. Removal, not deprecation.

**Frontend**
- Delete `src/components/CollectionDashboardView.vue`.
- `CollectionView.vue`: remove the dashboard toggle button (:187-198), the
  dashboard body branch (search `dashboardActive` render block ~:397-405), the
  `hasDashboard` computed (~:1444), `dashboardActive` (:1505), and the
  `dashboard` arm of the `activeView` fallback (~:1457). The import.
- The enum-field anchor `<select>` (:239-248) currently shows when
  `kanbanActive || dashboardActive` — drop the `dashboardActive` term, keep
  `kanbanActive`.
- The view-group `v-if` (:147) and outer `v-if` (:118) list `hasDashboard` —
  remove that term from both.
- `collectionViewMode.ts`: remove `"dashboard"` from the mode union and its
  availability branch; ensure a persisted `"dashboard"` value collapses to
  `"table"` (the existing unknown-mode fallback should already cover this —
  verify a stored `collection_view_modes` entry of `dashboard` doesn't wedge).

**i18n** — remove keys across **all 8 locales** (`src/lang/*.ts`):
`collectionsView.viewDashboard`, `dashboardAlertHeading`, `dashboardAllItems`,
and any other `dashboard*` keys under `collectionsView`. Keep key order
consistent.

**Tests / docs**
- Remove any e2e/unit referencing `collection-view-toggle-dashboard` testid or
  `CollectionDashboardView`.
- Update `docs/ui-cheatsheet.md` if the collections block lists a Dashboard
  toggle.
- Grep for stray `dashboard` references in `enumFields`/`notifyWhen` docs.

Open question: `schema.notifyWhen` was surfaced **only** by the dashboard
alert. Decide whether `notifyWhen` keeps earning its place (it also drives
bell notifications via `server/workspace/collections/notifications.ts` — likely
yes, leave the schema field untouched; only the dashboard UI goes away).

---

## Part 2 — Per-collection setup/config page (with view delete)

The immediate need is **deleting a custom view**; the broader move is a home
for per-collection configuration.

**Server — new delete-view endpoint**
- Add `DELETE /api/collections/:slug/views/:viewId` to
  `server/api/routes/collections.ts`.
- Handler (new fn in `server/workspace/collections/`, e.g. `views.ts` or extend
  `io.ts`): source-aware, mirroring `readCustomViewHtml`'s base resolution.
  1. Resolve the schema.json location (project → `data/skills/<slug>/`, user/feed
     → `skillDir`).
  2. Remove the matching entry from `schema.views[]`.
  3. `unlink` the referenced `views/<file>.html` (path-safe via the existing
     `resolveTemplatePath` containment check — never delete outside the views
     dir).
  4. Write schema.json through the domain IO layer / `writeFileAtomic`.
  5. For project collections, check whether the active `.claude/skills` mirror
     needs a re-derive (`derive.ts`/`watcher.ts`) so the discovered schema
     reflects the removal. Custom-view HTML is staging-only, but the `views[]`
     array lives in the mirrored schema — confirm which copy discovery reads
     and keep both consistent.
- Return `{ deleted: true, viewId }`. 404 when the view id isn't in the schema;
  forbid on preset collections consistent with `deleteCollection` rules.
- Register the route key in `src/config/apiRoutes.ts`.

**Frontend — config surface** (decided: **modal**, **views-only** scope; the
header `+` button **stays** — it's the discoverable add-view entry point)
- Add a gear/settings icon-button to the `CollectionView.vue` header chrome
  (icon-only, `h-8 w-8 flex items-center justify-center rounded`, standalone
  only — `!embedded`). Opens a **modal** (match the record/deck-modal pattern,
  e.g. `CollectionRecordModal.vue` for structure) — not a dedicated route. A
  route can come later if config grows (rename, schema edit, ingest config).
- v1 modal content — a single **Views** section:
  - List each `schema.views[]` entry (icon + label) with a delete button per
    row (confirm before delete). Wire to the new DELETE endpoint via
    `src/utils/api.ts` (`apiDelete`), with network + `!response.ok` handling.
    On success, refetch the collection detail so the toggle row updates.
  - **Keep the `+` "add view" button in the header toggle group**
    (`CollectionView.vue:214-224`, the existing `addCustomView` seed-chat path)
    — it's far more discoverable than burying add inside a settings modal. The
    modal owns delete; the header owns add. (Optionally also surface an "Add
    view" row inside the modal as a secondary entry point, but the header `+`
    is the primary one and must remain.)
- The toggle-group `v-if` (`:147`) and outer `v-if` (`:118`) keep their
  `canAddCustomView` term (the `+` stays in the header). The gear icon gets its
  own gate (collection present, `!embedded`, and there's something to manage —
  i.e. `hasCustomViews`, since delete is the only modal action today).
- New i18n keys (all 8 locales): modal title, "Views" heading, delete
  confirm/label, empty state. (No new "Add view" key needed — `addView` already
  exists and stays on the header `+`.)

---

## Part 3 — Custom views for feeds

Server already supports feed custom views end-to-end (`readCustomViewHtml`
handles `source !== "project"` → `skillDir`; view-token / view-data routes are
slug-based and source-agnostic). The gaps are **frontend gating** and **the
authoring prompt path**.

- `CollectionView.vue:1482`: drop `!isFeed.value` from `canAddCustomView` so the
  `+` button appears for feeds too. (Part 2's delete UI then covers feeds for
  free.)
- `addViewPrompt` (i18n, all 8 locales) hardcodes
  `data/skills/{slug}/views/...` and "register it in the collection's
  schema.json". For feeds the HTML lives at `feeds/<slug>/views/...` and the
  schema is `feeds/<slug>/schema.json`. Either:
  - (a) parameterize the prompt with the correct base path computed from the
    collection source and pass it in, or
  - (b) split into `addViewPrompt` vs `addViewPromptFeed`.
  Prefer (a) — one templated `{viewsPath}` / `{schemaPath}` placeholder keeps a
  single string per locale.
- `helps/feeds.md` (and the custom-view help) don't mention feed custom views —
  add a short section so the agent knows the data contract + correct paths.
- Verify the view-token mint + view-data GET/PUT actually resolve for a feed
  slug (manual: author a trivial feed view, confirm it renders and reads data).
  No code change expected, but it's untested today.

---

## E2E coverage (Playwright, `e2e/`)

These are **mocked-browser** tests (no backend): `mockAllApis(page, …)` then
`page.route(...)` to stub the specific collection/feed endpoints, fixtures hold
the detail JSON inline. Model the new specs on `e2e/tests/present-collection.spec.ts`
and `collection-calendar.spec.ts` (both stub `/api/collections/:slug` with a
detail fixture and assert on `data-testid`s). Each part ships its spec in the
same PR.

**Part 1 — dashboard gone** (`collection-view-dashboard-removed.spec.ts` or fold
into an existing collections spec):
- Stub a detail whose schema has an enum field (the old dashboard trigger);
  assert `collection-view-toggle-dashboard` has count 0 and that table/kanban
  still render.
- Assert a persisted `collection_view_modes` localStorage value of `dashboard`
  falls back to the table view rather than wedging (seed `localStorage` before
  `goto`).

**Part 2 — config modal + delete view** (`collection-view-config.spec.ts`):
- Stub a detail whose schema has 1–2 `views[]` entries; intercept
  `DELETE /api/collections/:slug/views/:viewId` with `route.fulfill({ json:
  { deleted: true, viewId } })`, and serve an updated detail (one fewer view) on
  the post-delete refetch.
- Flow: open the gear modal → assert each view row is listed → click delete →
  confirm → assert the DELETE was called (capture the request) → assert the row
  and the header toggle button both disappear after refetch.
- Assert the header `+` add-view button **remains** (`collection-view-add`) and
  still triggers the seed-chat path (`sendTextMessage` / `startNewChat` —
  stub/spy as the other specs do).
- New `data-testid`s to add for these handles: e.g.
  `collection-config-open` (gear), `collection-config-modal`,
  `collection-view-delete-<id>`. Update `docs/ui-cheatsheet.md` for the
  collections chrome.

**Part 3 — feeds get custom views** (`feed-custom-view.spec.ts` or extend the
above):
- Stub a **feed** detail (schema carries `ingest`) with a `views[]` entry;
  assert the custom-view toggle button renders and the gear modal shows the
  add/delete affordances for the feed (i.e. the old `!isFeed` exclusion is
  gone).
- The sandboxed iframe render itself (`CollectionCustomView.vue` →
  view-token/view-data) is awkward to assert in mocked e2e; cover the
  token-mint + view-data path with a **server-side unit test** instead
  (`test/` mirror of the collections routes) and/or a **live e2e** smoke (see
  below). The mocked spec only needs to prove the toggle + config surface
  appear for feeds.

**Server unit (`test/`, node:test):** add coverage for the new delete-view
handler — source-aware schema resolution (project staging vs feed/user
`skillDir`), `views[]` entry removed, HTML `unlink`ed, path-containment refusal
for a crafted `viewId`/file, and 404 for an unknown view id.

**Live e2e (`e2e-live/`):** optional follow-up — authoring a real feed custom
view and confirming it renders + reads data end-to-end is the one path mocks
can't prove. Read `docs/e2e-live-testing.md` before adding; gate appropriately
(this path needs no LLM, so it can run in the `E2E_LIVE_NO_LLM=1` matrix).

## Sequencing

1. **Part 1 (dashboard removal)** — self-contained, smallest blast radius. Land
   first.
2. **Part 2 (config page + delete-view)** — introduces the delete endpoint +
   config surface.
3. **Part 3 (feeds)** — trivially small once Part 2 exists; mostly the gate flip
   + prompt path + docs.

## Checks before done (each PR)

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, plus `yarn test`
(server units) and `yarn test:e2e` (Playwright) green with the new specs above.
Update the i18n lockstep (8 locales) and `docs/ui-cheatsheet.md` where the
collections chrome changes. Move this plan to `plans/done/` when all three land.
