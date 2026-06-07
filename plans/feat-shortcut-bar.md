# Plan: Shortcut zone — pin frequently-used Collections & Feeds to the launcher

Adds a **manual pin** mechanism so a user can pin a specific collection or
feed and jump to it in **one click** from the top chrome, instead of going
through the `/collections` (or `/feeds`) index and picking it every time.

The shortcuts render as a **third zone inside `<PluginLauncher>`**, to the
right of the management group, separated by the same `‖` divider the bar
already uses between data-plugins and management.

```text
⏰Actions │ 📖Wiki │ ▦Collections │ 📡Feeds ‖ 🧠Skills │ 🎭Roles │ 📁Files  ‖  📊Invoices │ 🌤Weather
└──────── data plugins ────────┘     └──── management ────┘     └─ pinned shortcuts ─┘  (NEW)
```

## Decisions locked (from design discussion)

- **Layout**: extend `<PluginLauncher>`, do NOT make a separate bordered
  component. Append a third zone after a `‖` separator. Keeps one visual
  island in the chrome, not two.
- **Pin model**: **manual** only. No MRU / auto-frequency. The user
  explicitly stars what they want.
- **Persistence**: **server-side config file** (`config/shortcuts.json`),
  NOT localStorage. Pins are tied to *workspace content* (specific
  collection/feed slugs), so they belong with the workspace, survive a
  browser clear, and sync per-workspace — consistent with the "workspace
  is the database / files are the source of truth" philosophy. (Note: this
  deviates from the `useLayoutMode` localStorage precedent on purpose —
  layout is browser chrome, pins are workspace data.)
- **Pin entry points**: BOTH
  1. the index cards (`/collections`, `/feeds`) — a ★ toggle per card
  2. the individual view header (`/collections/:slug`, `/feeds/:slug`) — a
     ★ toggle in the header, to pin what you're currently looking at
- **Cap**: **none** — no limit on the number of pinned shortcuts. The
  shortcuts zone scrolls / wraps as needed (see §4 for overflow handling).
- **Reorder**: **none** — shortcuts render in pin (insertion) order. No
  drag-to-reorder.

## Hard constraint: zero domain-specific host code for the *target*

A shortcut is a thin, generic record:

```ts
interface Shortcut {
  kind: "collection" | "feed"; // which route family
  slug: string;                // the :slug param
  title: string;               // cached display label (user-named)
  icon: string;                // cached material-symbols glyph
}
```

Both collections and feeds already expose `{ slug, title, icon, source }`
(see `CollectionsIndexView.vue` → `CollectionSummary`; feeds reuse the same
`CollectionView`). Navigation reuses the **existing routes** —
`/collections/:slug` and `/feeds/:slug` — so the host gains **no new
collection/feed-specific navigation logic**. `title`/`icon` are cached into
the shortcut at pin time so the bar renders without re-fetching every index;
a stale title (collection renamed) is acceptable and refreshed on next pin
or via a lightweight reconcile (see Open questions).

---

## The pieces

### 1. Persistence — `config/shortcuts.json` + io module

- New `server/utils/files/shortcuts-io.ts` following the existing
  `*-io.ts` domain-module pattern (e.g. `roles-io.ts`). All writes go
  through `writeFileAtomic`. Reads tolerate a missing file → `[]`.
- File path constant in `server/workspace/paths.ts` (`WORKSPACE_FILES`) —
  never hardcode `config/shortcuts.json`.
- Shape on disk: `{ shortcuts: Shortcut[] }` (object wrapper, not a bare
  array, so the schema can grow).

### 2. Server route

- `GET /api/shortcuts` → `{ shortcuts }`
- `PUT /api/shortcuts` → replace the full list (client owns ordering /
  add / remove and sends the whole array; server validates shape).
  Single replace-endpoint avoids add/remove route sprawl.
- Register the route path in `src/config/apiRoutes.ts` (`API_ROUTES`) —
  no magic literal.
- Validate: `kind ∈ {collection, feed}`, non-empty `slug`,
  dedupe on `(kind, slug)`. **No length cap.**

### 3. Client store — `useShortcuts` composable

- `src/composables/useShortcuts.ts` — loads via `apiGet`, mutates via
  `apiPost`/`apiPut` through `src/utils/api.ts` (bearer auto-attach).
  **Error handling required** on every fetch (network try/catch + `!ok`).
- Exposes: `shortcuts` (ref), `isPinned(kind, slug)`, `pin(shortcut)`,
  `unpin(kind, slug)`.
- Optimistic update with rollback on failure; surface failures on the
  notification bell (reuse existing notification path).

### 4. `<PluginLauncher>` — third zone

- Accept a `shortcuts` prop (the host passes them down; the launcher stays
  presentational, emits `navigate`).
- Render after the management group with a second `‖` separator. The
  current `separatorAfterIndex` logic handles ONE divider; generalize to
  support a divider before the shortcuts zone too. Keep the dev-only-filter
  index math intact.
- Each shortcut button is an **icon + short label pill** (`h-8 px-2.5
  flex items-center gap-1`, per the chrome-control sizing rules) — NOT
  icon-only, because collections/feeds are user-named and indistinguishable
  by glyph alone. Use `material-symbols-outlined` for the collection glyph
  (matches the index card) — note the index uses `material-symbols`, the
  rest of the launcher uses `material-icons`; keep the shortcut glyph in the
  collection's own font.
- `data-testid="plugin-launcher-shortcut-<kind>-<slug>"`.
- **Overflow (no cap on count):** the shortcuts zone gets
  `flex-nowrap overflow-x-auto` with a thin/hidden scrollbar so a long pin
  list scrolls horizontally instead of pushing the bar past the viewport or
  wrapping the chrome. The fixed groups (data plugins, management) stay
  `flex-none`; only the shortcuts zone scrolls.
- Active-state highlight when `currentPage === kind && route slug === slug`.
- Navigation: emit a target the host maps to
  `router.push({ name: kind, params: { slug } })`. Extend `onPluginNavigate`
  in `App.vue` to carry an optional `slug`.

### 5. Pin toggle — index cards (shared `<PinToggle>`)

**Confirmed: the two indexes are SEPARATE components** — `/collections` →
`CollectionsIndexView.vue` (cards `collections-index-card-<slug>`),
`/feeds` → `FeedsView.vue` (cards `feeds-card-<slug>`, drawn independently).
They share no list UI, so the ★ must be wired into **both**.

- To avoid duplicating the toggle logic, extract a small shared
  `src/components/PinToggle.vue` (`:kind :slug :title :icon`) that talks to
  `useShortcuts` itself (`isPinned` / `pin` / `unpin`). Both card
  components drop it in — one component, two call sites.
- Filled star when pinned, outline when not. (No cap, so no disabled
  state.)
- Stop click propagation so toggling the star does NOT also open the
  collection/feed.

### 6. Pin toggle — individual view header

- The `/collections/:slug` and `/feeds/:slug` header (in `CollectionView`
  or its wrapper) gains a ★ toggle in the control cluster, sized per the
  chrome rules (`h-8 w-8` icon-only is fine here — single contextual
  action).

### 7. Stale reconcile — pull-based, at read time (NO write-side hooks)

**Confirmed approach.** A pinned shortcut caches `{ title, icon }`, so a
renamed/deleted collection or feed drifts. We do NOT hook the
collection/feed rename/delete path (that would leak domain coupling into the
host — violates the zero-domain-host-code constraint). Instead reconcile is
**pull-based at view mount**, split across two complementary points:

1. **Index mount = bulk reconcile (free).** `CollectionsIndexView` /
   `FeedsView` already fetch the authoritative `{slug,title,icon}` list, so
   no extra fetch. On load, for shortcuts of that view's `kind`: prune dead
   slugs, refresh `title`/`icon` of survivors. If anything drifted,
   **PUT the corrected list back so `shortcuts.json` self-heals** (an
   in-memory filter alone would leave dead entries in the file forever).
   Each index only reconciles its own kind (collections index ignores feed
   shortcuts and vice versa) — that's sufficient.
2. **Target view mount = dead-click safety net.** Covers the "user never
   revisits the index, collection gets deleted via chat" gap: clicking the
   shortcut lands on `/collections/:slug` for a slug that no longer exists.
   `CollectionView` renders a not-found state AND self-prunes that shortcut.

Priority: **delete → dead click** is the must-fix (point 2). **rename →
stale label** is cosmetic (nav still works); it self-corrects on the next
index visit (point 1). No background job, no write-side coupling.

### 8. i18n — all 8 locales

New keys (extract to `src/lang/en.ts` first, then translate in all 8):
`shortcuts.pin`, `shortcuts.unpin`,
`shortcuts.zoneAriaLabel`, plus any toast strings. Product/brand names stay
English. Keep key order consistent across locales.

### 9. Docs

- Update the **Top-level chrome** ASCII block in `docs/ui-cheatsheet.md`
  to show the new shortcuts zone + the `[plugin-launcher-shortcut-*]`
  testids (same-PR discipline).
- If a new shared helper lands (e.g. a shortcut-key builder), add a 1-line
  entry to `docs/shared-utils.md`.

### 10. Tests

- Unit: `shortcuts-io` (read missing → `[]`, write atomic, dedupe on
  `(kind, slug)`) under `test/` mirroring source layout.
- E2E (`e2e/`): pin from index card → shortcut appears in launcher →
  click navigates to `/collections/:slug`; unpin removes it.
  Use `mockAllApis(page)` and `data-testid` selectors.

---

## Touch list

| File | Change |
|---|---|
| `server/workspace/paths.ts` | add `shortcuts.json` to `WORKSPACE_FILES` |
| `server/utils/files/shortcuts-io.ts` | NEW domain io module |
| `server/api/routes/shortcuts.ts` | NEW `GET`/`PUT` handlers |
| `server/api/routes/index.ts` (or router barrel) | mount route |
| `src/config/apiRoutes.ts` | add route path constant |
| `src/composables/useShortcuts.ts` | NEW client store |
| `src/components/PluginLauncher.vue` | third zone + second separator |
| `src/App.vue` | pass shortcuts prop; extend `onPluginNavigate` with slug |
| `src/components/PinToggle.vue` | NEW shared ★ toggle (used by both indexes + headers) |
| `src/components/CollectionsIndexView.vue` | `<PinToggle>` per card + index-mount reconcile (collections) |
| `src/components/FeedsView.vue` | `<PinToggle>` per card + index-mount reconcile (feeds) |
| `CollectionView` header / wrapper | `<PinToggle>` in header; not-found state self-prunes dead shortcut |
| `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | new keys ×8 |
| `docs/ui-cheatsheet.md` | update chrome ASCII + testids |
| `test/...`, `e2e/...` | io unit tests + pin/navigate E2E |

---

## Resolved (was open)

- **Feeds index is a SEPARATE component** (`FeedsView.vue`, own
  `feeds-card-<slug>`). ★ wired into both indexes via a shared
  `<PinToggle>` — see §5.
- **Stale reconcile = pull-based at view mount**, no write-side hooks:
  index mount bulk-reconciles + self-heals the file, target view mount
  catches dead clicks + self-prunes — see §7.
- **No cap** on shortcut count; zone scrolls horizontally on overflow
  (§4).
- **No reorder**; render in pin (insertion) order.

## Open questions (resolve before / during implementation)

_None — all design decisions are locked._

---

## Out of scope (v1)

- Auto / MRU / frequency-based shortcuts.
- Pinning anything other than collections & feeds (no wiki pages, skills,
  roles, files).
- Drag-to-reorder (render in pin order).
- Cross-device sync beyond what the per-workspace file already gives.
