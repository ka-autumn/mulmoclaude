# Plan: collections custom views — LLM-authored HTML views over any collection

Follow-up to the collections line (`feat-skill-driven-apps`,
`feat-collections-calendar-view`, `feat-manage-collection-tool`). Adds a
**third kind of renderer** for a collection — but unlike `table` / `calendar`
/ `kanban` / `dashboard`, which are a fixed host-controlled enum
(`src/utils/collections/collectionViewMode.ts`), a **custom view is authored
by Claude as an HTML file and stored in the collection's own skill folder**.

The host learns ONE generic concept: *"a collection may carry a list of
HTML views; render the selected one in a sandboxed iframe over the
collection's records."* It holds zero view-specific literals — no "year
view", no "gantt", no "roadmap". Each concrete view is data.

## Why this, not "add a year/quarter view"

A beta user wants a long-horizon (annual / quarterly) overview that no fixed
view provides — and observed that View requests are a bottomless pit (general
office workers routinely hand-roll their own templates in Excel / Typst
because fixed views never quite fit). Their own workflow today: author plan
JSON with Claude, then visualize it with a **Claude-generated Typst template**
(VS Code live preview); edits go back through Claude as JSON edits.

This is the exact shape MulmoClaude should own natively. Typst is just the DSL
they happened to know; for a web app the native DSL is **HTML**. Today's
collections already make the *app* data (`schema.json`); only the **view**
is still host-fixed. This plan closes that gap: views become data too —
"the workspace is the database, Claude is the interface" applied to the
view layer itself. Adding a fixed "year view" to the enum would be the first
step down the bottomless pit; this makes the pit the user's garden instead.

## Hard constraints

1. **Zero domain-specific host code.** No per-view literals anywhere in
   `server/` or `src/`. The selector, the renderer, and the data endpoints
   are generic; meaning lives in `schema.json` + the HTML files + the records.
2. **A custom view can never exceed the capability its token grants.** Views
   are LLM-authored and run sandboxed. The data they can reach is bounded by a
   **slug-scoped, action-scoped, short-lived capability token** — never the
   global bearer token. Least privilege: `read` is the default; `write` is an
   explicit opt-in declared in the view's registration. No `delete` surface
   for views in v1 (the global REST `DELETE item` route stays unreachable to
   views).
3. **No new exfiltration surface.** The sandboxed iframe keeps
   `sandbox="allow-scripts"` (opaque origin — cannot read the global token,
   localStorage, or cookies). CSP `connect-src` is widened only to the
   **server's own origin** (see WebKit note below), so a view can call the
   collection data endpoint but cannot phone home to a third party.

---

## What already exists (reuse, do not rebuild)

- **REST collections API** — `server/api/routes/collections.ts` already has
  list / detail / create-item / update-item / delete-item / refresh /
  item-action / collection-action. The frontend already drives these. We are
  NOT building a CRUD API; we add a **narrow, capability-token-gated data
  endpoint** for views and reuse the workspace layer underneath.
- **manageCollection workspace logic** — `enrichItems` (derived/toggle/embed
  resolution) and `validateRecordObject` (per-row validation) from
  `feat-manage-collection-tool` are the exact read/write primitives a view
  needs. The view data endpoint is `manageCollection`'s getItems/putItems
  logic exposed over HTTP behind capability-token auth — same actions, same
  validation, scoped to one slug. The invariant "a view can never do more than
  the agent itself" falls out of reusing this layer.
- **Sandboxed HTML rendering** — `src/plugins/presentHtml/View.vue` renders
  LLM HTML in `sandbox="allow-scripts"` iframes with the CSP from
  `src/utils/html/previewCsp.ts` and the postMessage height reporter
  (`src/utils/html/iframeHeightReporterScript.ts`, parent listener in
  `StackView.vue`). The custom-view renderer reuses this whole apparatus.
- **Bearer auth** — `server/api/auth/{token,bearerAuth}.ts`. One 32-byte
  startup token, `Authorization: Bearer <token>`, with a single
  `/api/files/*` exemption. The capability token is a **separate, scoped,
  signed** credential — we do not hand the global token to a view.
- **Chat-action primitive** — collections already have `actions` /
  `collectionActions` of `kind: "chat"` that seed a templated chat message.
  The "+" button reuses this mechanism (seeds a view-authoring prompt); we
  add no new "tell the LLM to do X" plumbing.

### WebKit / opaque-origin CSP note (already documented in the codebase)

`buildHtmlPreviewCsp(origin?)` takes an explicit origin because a
`sandbox="allow-scripts"` iframe has an **opaque origin**, and WebKit refuses
to match `'self'` against it (see the comment block in `previewCsp.ts`,
which already substitutes the explicit origin into `img-src` for this exact
reason). The same applies to `connect-src`: to let a view `fetch()` the data
endpoint we must emit `connect-src <explicit-server-origin>`, **not**
`connect-src 'self'`. The plan threads the server origin through, mirroring
the existing `img-src` handling.

---

## The data flow (end to end)

```text
 ┌── parent (authenticated, holds global bearer) ──────────────────────────┐
 │ 1. user selects a custom view in CollectionView.vue                     │
 │ 2. parent mints a scoped token:                                         │
 │      POST /api/collections/:slug/view-token  { capabilities }          │
 │      (global-bearer auth) → { token, exp }                             │
 │ 3. parent fetches the HTML body of the selected view                   │
 │ 4. parent renders CollectionCustomView.vue:                            │
 │      sandboxed iframe, CSP connect-src <origin>, token injected        │
 └────────────────────────────────────────────────────────────────────────┘
                                  │ token in iframe (e.g. <meta> / window.__MC_VIEW)
                                  ▼
 ┌── sandboxed iframe (opaque origin, LLM-authored HTML) ──────────────────┐
 │  fetch('/api/collections/<slug>/view-data', {                           │
 │     headers: { Authorization: 'Bearer <scoped token>' } })             │
 │     → enriched records (getItems semantics)                            │
 │  // write views only, if token has "write":                            │
 │  fetch('/api/collections/<slug>/view-data', {                          │
 │     method:'PUT', headers:{Authorization:'Bearer <scoped>'},           │
 │     body: JSON.stringify({ items, mode }) })  → validated putItems     │
 └────────────────────────────────────────────────────────────────────────┘
```

The iframe never sees the global token; `connect-src <origin>` blocks any
third-party request; the capability token authorizes only `view-data` for one
slug, read (and optionally write), until `exp`.

---

## Part 1 — schema: register views with capabilities

`server/workspace/collections/types.ts` — extend `CollectionSchema` with one
optional field:

```ts
  /** Optional list of custom (LLM-authored) HTML views for this collection.
   *  Each renders in a sandboxed iframe over the collection's records.
   *  Absent ⇒ only the built-in field-derived views (table/calendar/…). */
  views?: CollectionCustomView[];
```

```ts
export interface CollectionCustomView {
  id: string;                 // stable id, safe-slug; selector key + localStorage key
  label: string;              // selector button label (i18n-exempt: author-authored)
  icon?: string;              // Material Symbols icon name; default a generic "dashboard_customize"
  file: string;               // "views/<name>.html", path-safe, under the skill folder
  capabilities?: ("read" | "write")[];  // default ["read"]
}
```

- **Validation** (`server/workspace/collections/discovery.ts`, Zod): `id`
  passes `safeSlugName`; `file` matches `^views/[A-Za-z0-9._-]+\.html$` (mirror
  `isSafeTemplatePath` in `templatePath.ts`, swap the prefix); `capabilities`
  ⊆ `{read, write}`, default `["read"]`; duplicate `id`s rejected. Invalid →
  boot-time schema diagnostic on the bell, same channel as the existing
  `calendarField` / `triggerField` cross-ref checks.
- No change to records or record I/O.

## Part 2 — the view file: storage + skill-bridge

Custom view HTML lives at `data/skills/<slug>/views/<name>.html`, authored by
Claude via the normal `Write`/`Edit` tools (no `manageCollection` action needed
— it only writes record JSON; confirmed in `feat-manage-collection-tool`).

**Skill-bridge decision:** rendering is host-side (the Vue frontend reads the
file via the data endpoint), NOT Claude-Code-side, so the HTML does **not**
need mirroring into `.claude/skills/<slug>/`. The skill-bridge allowlist
(`server/workspace/hooks/handlers/skillBridge.ts`: `SKILL.md`, `schema.json`,
`templates/*`) stays as-is. We read the HTML directly from the staging path
`data/skills/<slug>/views/*.html` server-side with the existing collection
path-safety (`resolveDataDir` / `isContainedInRoot` in
`server/workspace/collections/paths.ts`).

> Decision to confirm: keep views staging-only (no `.claude` mirror). The
> alternative — extend the bridge allowlist to `views/*` — is only needed if
> we ever want Claude Code's skill tooling to *read* views, which it doesn't.

## Part 3 — capability token

`server/api/auth/viewToken.ts` (new). Stateless, HMAC-signed; **no storage**.

- **Shape**: `base64url(JSON({ slug, caps, exp })) + "." + HMAC`.
  - `slug` — the one collection this token authorizes.
  - `caps` — subset of `["read","write"]`.
  - `exp` — short TTL (default 1h; import from `server/utils/time.ts`,
    NO raw `3600000`). Re-minted by the parent on demand.
- **Key**: derive from the server startup token (`getCurrentToken()`), e.g.
  `HMAC-SHA256(key=startupToken, msg=payload)`. Server restart ⇒ old view
  tokens fail, same lifecycle as the global token.
- **Mint endpoint** — `POST /api/collections/:slug/view-token`, **global-bearer
  auth** (only the real frontend can mint). Body `{ capabilities }`; the
  server clamps requested caps to what the named view's `schema.views[].id`
  declares (a view registered `["read"]` can never be minted a `write` token,
  even if the frontend asks). Returns `{ token, exp }`.
- **Verify middleware** — `requireViewToken(action)`: reads
  `Authorization: Bearer <scoped>`, verifies HMAC + `exp` + `slug` matches the
  route param + `action ∈ caps`. On failure → 401 (generic message, mirroring
  `bearerAuth`). This middleware guards ONLY the `view-data` routes; the global
  `bearerAuth` continues to guard everything else. The two auth paths never mix
  — a scoped token cannot reach `DELETE /collections/:slug` or `/api/agent`.

## Part 4 — view-data endpoints (manageCollection over HTTP, scoped)

`server/api/routes/collections.ts` — two new routes, capability-token-gated:

- `GET /api/collections/:slug/view-data` — `requireViewToken("read")`.
  Returns enriched records via the **shared workspace layer** (`enrichItems`
  from `feat-manage-collection-tool`): derived evaluated, toggle projected,
  embed resolved. Same `ids`/`fields` query selectors + the same
  unselective-read cap (refuse >200 rows without `ids`/`fields`) as
  `manageCollection.getItems`. Record-controlled strings defanged
  (`defangForPrompt`) — defense in depth even though this isn't a prompt sink.
- `PUT /api/collections/:slug/view-data` — `requireViewToken("write")`.
  Body `{ items, mode? }`. Per-row `validateRecordObject` + computed-key
  rejection, then `writeItem` (atomic, id-sanitized, containment-checked).
  Returns `{ written, rejected }`. **Reuses `manageCollection.putItems` logic
  verbatim** — no new write path, no delete. `mode` ∈ `upsert|create|merge`.

Both handlers stay thin; the logic is the existing workspace layer, so the
function-size / complexity limits hold and UI/agent/view can never disagree on
a computed number.

## Part 5 — render harness: `CollectionCustomView.vue`

`src/components/CollectionCustomView.vue` (new). Props:

```ts
defineProps<{ schema: CollectionSchema; slug: string; view: CollectionCustomView }>();
```

- On mount / view change: mint a scoped token (Part 3) for `view.capabilities`,
  fetch the HTML body (a small authenticated `GET
  /api/collections/:slug/view-file?id=<viewId>`, global-bearer — reads the
  staging HTML path-safely), wrap with CSP via `buildHtmlPreviewCsp(origin)`
  **extended so `connect-src` is the server origin** (see Part 7), inject the
  token, render in a `sandbox="allow-scripts"` iframe.
- **Token injection**: emit a tiny inline bootstrap into the wrapped HTML head
  — `window.__MC_VIEW = { slug, token, dataUrl }` — so the view's own script
  reads it without parsing meta tags. Documented in the contract (Part 6).
- **Height**: reuse `iframeHeightReporterScript` injection + the existing
  `StackView.vue` postMessage listener. Confirm the listener generalizes to
  this mount (it keys off `mc-iframe-height`).
- **Refresh**: re-mint on expiry (catch a 401 from the view → parent re-mints
  and reloads, or proactively re-mint before `exp`). Keep simple in v1:
  proactive re-mint on each (re)render; a long-lived view that outlives `exp`
  reloads.
- **All error paths handled** (mint fetch, file fetch): try/catch + `!ok`,
  surface a small in-card error state — never a blank iframe. (CLAUDE.md fetch
  rule.)

## Part 6 — the authoring contract: `helps/custom-view.md`

`server/workspace/helps/custom-view.md` (new) — the DSL reference Claude reads
at runtime to author a view (same role as `collection-skills.md`). It is the
single most important artifact for the feature: a view Claude can't author
correctly is dead weight. Must cover, terse and operational:

- **Where the file goes**: `data/skills/<slug>/views/<name>.html`, and how to
  register it in `schema.json` `views[]` (`id`, `label`, `icon`, `file`,
  `capabilities`). Worked JSON snippet.
- **How to read data**: `const { slug, token, dataUrl } = window.__MC_VIEW;`
  then `fetch(dataUrl, { headers:{ Authorization:'Bearer '+token }})` →
  records with computed fields already resolved. Document the `ids`/`fields`
  query params and the >200-row rule.
- **How to write data** (write-capability views only): `PUT` to `dataUrl` with
  `{ items, mode }`, the validation contract, and the per-row `rejected`
  shape to surface to the user. Note: **no delete**.
- **How to open a record**: `window.__MC_VIEW.openItem(id, mode)` posts an
  `mc-open-item` ping to the host, which opens the record in its shared
  detail/edit modal (`mode`: `"view"` default / `"edit"`). Needs **no `write`
  capability** even for `"edit"` — the host owns the save, so it's a user action
  through trusted UI, not a view-code write. Pair with `onChange` to repaint
  after the user saves.
- **The sandbox rules**: inline `<script>`/`<style>` only; external resources
  limited to the CDN allowlist (`HTML_PREVIEW_CSP_ALLOWED_CDNS` — jsdelivr /
  unpkg / cdnjs / Google Fonts / plotly); **`fetch` is allowed only to
  `dataUrl`** (connect-src is the server origin, not the open internet) — no
  phoning home, no third-party analytics.
- **Capabilities = least privilege**: declare `["read"]` unless the view edits
  data; only declare `["write"]` for genuinely interactive editors.
- **Two complete worked examples** (copy-paceable), doubling as the v1 sample
  views (Part 8).

Also add a short pointer to this from `collection-skills.md` (the "views" key
in the schema-key table + a one-paragraph "Custom views" section) — same PR,
and NOT before the feature ships (live help must never describe unbuilt
behaviour).

## Part 7 — selector: the "+" button and dynamic view list

`src/components/CollectionView.vue` (toggle group at ~line 145) +
`src/utils/collections/collectionViewMode.ts`:

- **Extend the mode space.** Today `CollectionViewMode = "table" | "calendar"
  | "kanban" | "dashboard"`. Generalize to `BuiltInViewMode | CustomViewRef`
  where a custom ref is `` `custom:${viewId}` ``. `activeView` collapses an
  unknown `custom:*` (view removed from schema) back to `table`, mirroring the
  existing stale-mode collapse. localStorage persistence
  (`collection_view_modes`) is unchanged — it already stores an opaque string
  per slug.
- **Render a button per `schema.views[]`** entry (icon + label pill, standard
  chrome sizing `h-8 px-2.5 flex items-center gap-1` per CLAUDE.md), after the
  built-in toggles, each `data-testid="collection-view-custom-<id>"`.
- **"+" button** at the end of the group (`h-8 w-8` icon-only, `add` icon,
  `data-testid="collection-view-add"`). Clicking it fires a **chat-action**
  that seeds the chat with a view-authoring instruction, e.g.:
  > このコレクション「{title}」のカスタムViewを作りたい。何を俯瞰／編集したいか私に質問してから、`data/skills/{slug}/views/<name>.html` を作成し `schema.json` の `views[]` に登録して。読むだけなら `capabilities:["read"]`、編集できるViewなら `["write"]`。詳細は custom-view ヘルプ参照。

  Reuse the existing chat-action seed path (the same mechanism behind
  `collectionActions`); the host adds NO new "instruct the LLM" plumbing — it
  injects a templated prompt and Claude does the rest (ask → author → register
  → the new view appears in the selector on the next schema reload).
- **Dispatch**: `activeView` starts with `custom:` → render
  `<CollectionCustomView :view="...">`; else the existing built-in branches.

## Part 8 — v1 sample views (the beta user's actual need)

Ship two reference views in `helps/custom-view.md` as copy-pasteable examples,
which also double as the migration target for the beta user:

1. **Annual / quarterly overview (read)** — a year-at-a-glance grid: months ×
   weeks (or a 4-quarter band), plotting records by a date field, spanning
   multi-date records as bars. `capabilities:["read"]`. This is the long-
   horizon俯瞰 no built-in view provides — and the direct answer to the
   feedback.
2. **Weekly planner (write)** — a 7-day board where dragging a record between
   days `PUT`s the new date back. `capabilities:["write"]`. Demonstrates the
   mutation path and the validation round-trip.

These are *examples in a help doc*, not host components — proving the host
holds zero view-specific code while still giving the user something to start
from on day one.

---

## Files touched

| File | Change |
|---|---|
| `server/workspace/collections/types.ts` | `+views?: CollectionCustomView[]` on `CollectionSchema`; new `CollectionCustomView` type |
| `server/workspace/collections/discovery.ts` | Zod validation for `views[]` (id/file/capabilities, dup-id, boot diagnostic) |
| `server/api/auth/viewToken.ts` | **new** — mint + verify scoped HMAC capability tokens; `requireViewToken(action)` middleware |
| `server/api/routes/collections.ts` | **new routes**: `POST view-token` (bearer), `GET view-file` (bearer), `GET/PUT view-data` (capability-token), reusing `enrichItems`/`validateRecordObject`/`writeItem` |
| `src/utils/html/previewCsp.ts` | extend builder so `connect-src` can be the server origin (not `'none'`) for the view variant; keep presentHtml's `'none'` default unchanged |
| `src/components/CollectionCustomView.vue` | **new** — mint token, fetch HTML, sandboxed iframe render, height + error handling |
| `src/components/CollectionView.vue` | dynamic custom-view buttons + "+" chat-action seed + dispatch branch |
| `src/utils/collections/collectionViewMode.ts` | widen mode type to include `custom:<id>`; stale-collapse |
| `src/config/apiRoutes.ts` | add `view-token` / `view-file` / `view-data` route constants (host-fixed) |
| `server/workspace/helps/custom-view.md` | **new** — authoring contract + 2 sample views |
| `server/workspace/helps/collection-skills.md` | add `views` schema key row + a short "Custom views" section pointing at custom-view.md |
| `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | "+" button tooltip / add-view strings, all 8 in lockstep |
| `docs/ui-cheatsheet.md` | update the collections ASCII block to show custom-view buttons + "+" |
| `docs/shared-utils.md` | append a line IF a reusable helper is extracted (e.g. view-token codec) |

## Tests

- **Unit** (`test/`, node:test):
  - `viewToken` — mint/verify round-trip; tampered payload fails; expired
    fails; wrong-slug fails; `write` action rejected for a `read`-only token;
    cap clamping at mint (asking `write` for a `read` view yields `read`).
  - `discovery` — `views[]` validation: bad `file` path, bad `id`, unknown
    capability, duplicate id all surface diagnostics; valid passes.
  - `previewCsp` — the view variant emits `connect-src <origin>` (not `'none'`,
    not `'self'`); presentHtml default still emits `connect-src 'none'`.
- **Integration** (server): `GET view-data` returns enriched records and honours
  `ids`/`fields` + the >200 cap; `PUT view-data` writes valid / rejects invalid
  per-row / rejects computed keys / honours `mode`; capability-token middleware
  401s on missing/expired/wrong-slug/insufficient-cap; the global `DELETE
  collections/:slug` is NOT reachable with a scoped token.
- **E2E** (`e2e/`, Playwright, mocked): a collection with a `views[]` entry
  shows the custom-view button + "+"; selecting it mounts the iframe; the "+"
  button seeds a chat message (assert the seeded text). A collection with no
  `views[]` shows no custom button (only "+"). Use the `data-testid`s above;
  `mockAllApis(page)` before `goto`.
- **Manual** (`docs/manual-testing.md`): real round-trip — ask Claude to build
  a year-overview view, confirm it authors the HTML + registers it, the button
  appears, the iframe renders records, and (write sample) a drag writes back.

## Out of scope / follow-ups

- **Delete from a view** — no `delete` capability in v1; the REST `DELETE item`
  stays bearer-only. Add a `"delete"` cap + scoped route only if a real view
  needs it.
- **Cross-collection views** — a view reads only its own slug's data. A view
  that joins multiple collections would need a multi-slug token; defer until
  asked.
- **View marketplace / sharing across workspaces** — views are per-collection
  files; packaging/sharing them is a separate idea.
- **Live data push** — v1 is fetch-on-load (+ manual refresh inside the view);
  no websocket/pubsub stream into the iframe. Revisit if views need to react to
  external record changes live.
- **A generic view *registry*** — the built-in modes stay a switch; this plan
  adds custom views alongside them, not a plugin-point that unifies both.

## Decisions (settled in design chat — build to these)

1. **Token transport into the iframe** — **`window.__MC_VIEW` inline
   bootstrap**. The view reads `window.__MC_VIEW.{slug,token,dataUrl}`; this is
   the easiest shape for Claude to author against. (Not a `<meta>` tag, not a
   `dataUrl` query param.)
2. **Token TTL** — **1 hour**, with proactive re-mint on each (re)render. A
   view that outlives `exp` re-mints/reloads on the next render or on a 401.
3. **View file storage** — **staging-only**: `data/skills/<slug>/views/*.html`,
   **not** mirrored into `.claude/skills/`. Authoring, editing, and rendering
   all work from the staging path (the host renderer reads it directly; Claude
   edits it directly via the `views[].file` path in `schema.json`). The
   skill-bridge allowlist (`SKILL.md` / `schema.json` / `templates/*`) is
   unchanged. (Revisit only if terminal Claude Code ever needs to auto-discover
   view HTML as part of a loaded skill — no such need today.)
4. **`connect-src` scope** — **server origin only**. A view may `fetch()` only
   its own collection's `dataUrl`; all third-party origins are blocked by CSP
   (no phone-home, no external analytics, no fetching weather/quotes/etc.
   directly from the view). Widening to an allowlisted external API is
   explicitly out of scope for v1; if ever wanted, it is a deliberate, audited
   CSP change, never a default.

## Sequencing

1. ✅ **DONE (branch `feat/collections-custom-views`)** — **Part 1 + Part 3 +
   Part 4** (schema + capability token + view-data endpoints): the secure data
   plane. `views[]` schema + Zod validation; `server/api/auth/viewToken.ts`
   (HMAC mint/verify/clamp/`requireViewToken`); `POST view-token`, `GET/PUT
   view-data` reusing the `manageCollection` handler; bearer + CSRF exemptions
   in `server/index.ts`. Unit tests: `test/server/test_viewToken.ts`,
   `test/workspace/collections/test_discovery_views.ts`. Uncommitted.
2. ✅ **DONE** — **Part 5 + Part 7** (render harness + selector "+"):
   `CollectionCustomView.vue` (sandboxed iframe, token mint + view-file fetch +
   `__MC_VIEW` srcdoc via `src/utils/html/customViewSrcdoc.ts`); `view-file`
   route; `buildCustomViewCsp` (connect-src = origin); view-data CORS +
   preflight; selector custom buttons + "+" + dispatch in `CollectionView.vue`;
   `collectionViewMode` widened to `custom:<id>`; i18n in all 8 locales. Tests:
   `test/utils/html/test_customViewSrcdoc.ts`.
3. ✅ **DONE** — **Part 6 + Part 8** (authoring contract + sample views):
   `server/workspace/helps/custom-view.md` (the `__MC_VIEW` contract, read/write
   API, sandbox rules, year-overview [read] + weekly-planner [write] samples);
   `collection-skills.md` + `index.md` pointers; `docs/ui-cheatsheet.md` block.
4. i18n + cheatsheet + tests, then `yarn format && yarn lint && yarn typecheck
   && yarn build`.

Can ship as one PR or split 1 / (2+3) if review size warrants. Move this file
to `plans/done/` when the PR lands.
