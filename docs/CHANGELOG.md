# Changelog

All notable changes to MulmoClaude are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions use [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- **`@mulmoclaude/collection-plugin@0.5.2`** — record ids accept interior dots (new `safeRecordId`): natural keys like a Slack ts (`1718900000.123456`) or SemVer (`1.2.3`) are now addressable via `manageCollection`, fixing the asymmetry where a dotted-id record appeared in a full listing but was rejected by get-by-id / put / delete (#1735). `..`, path separators, and leading/trailing dots stay rejected; `safeSlugName` stays strict for slugs / dir names / `ref` targets / view ids. Also factors discovery's post-Zod acceptance gates into `acceptParsedSchema`.
- **`@mulmoclaude/collection-watchers@0.1.1`** — the reconciler only warns `trigger date unparseable` for a value that is present but malformed; an absent/empty optional trigger date is suppressed silently instead of logging a WARN on every reconcile tick.
- **`@mulmoclaude/workspace-setup@0.1.2`** — the `collection-skills.md` help doc steers schema edits through `manageCollection` `schemaDocs` / `getSchema` / `putSchema` (not raw file edits) and documents the record-id charset rule, referencing `safeRecordId` as the single source of truth.
- **`@mulmoclaude/html-plugin@0.2.2`** — review hardening (CodeRabbit) on the 0.2.x View extraction, no behaviour change for valid input: `executeHtmlDispatch` validates `path`/`html` are strings before touching FileOps (the host casts the dispatch body from `unknown`); `htmlArtifactPreviewUrl` rejects `..`/empty path segments so the derived iframe URL can't escape `artifacts/html/`; and the `previewUrl` docblock now documents the `filePath` fallback instead of the old "empty frame" behaviour. Adds in-package tests for the dispatch router + preview-URL derivation.
- **`@mulmoclaude/html-plugin@0.2.1`** — review fix on the 0.2.0 View extraction: the "PDF" button derived its print base URL from `data.previewUrl` only, so it was a no-op for already-presented results that have no persisted `previewUrl` — even though those pages now render. Print now uses the same `previewUrl ?? htmlArtifactPreviewUrl(filePath)` fallback as the iframe, via a single shared `previewBaseUrl` computed, so render and print stay in lockstep.
- **`@mulmoclaude/html-plugin@0.2.0` — Vue View extraction (presentHtml phase 2)** — the plugin gains a `./vue` entry (View / Preview + a shipped `./style.css`), so MulmoTerminal can import the presentHtml UI the way it imports chart / form / markdown. The View is host-agnostic: it renders via a host-injected `data.previewUrl` (relative asset refs still resolve), loads/saves source through `useRuntime().dispatch({ kind: "loadHtml" | "saveHtml" })` routed to the package's `executeHtmlDispatch` against the generic `files.artifacts`, and live-refreshes via the scoped `file:<path>` pubsub channel. MulmoClaude shrinks further: `src/plugins/presentHtml/` no longer ships its own `View.vue` / `Preview.vue` (−449 lines) and the `pluginPresentHtml.*` i18n keys moved into the package's own 8 locales. New host wiring: `server/plugins/html-builtin.ts` (built-in "html" dispatch handler) + a `plugin:html:file:…` forward in `server/events/file-change.ts`. No user-facing change in MulmoClaude.
- **`@mulmoclaude/html-plugin@0.1.0` — NEW shared package (presentHtml server core)** — the `presentHtml` tool's schema + save/validate logic is extracted from the MulmoClaude built-in into a shared, MulmoTerminal-consumable npm package, mirroring the proven chart-plugin / x-plugin pattern (Option B, phase 1). Server-only `.` entry: `TOOL_DEFINITION`, `executeHtml` / `executeHtmlUpdate` written against the generic gui-chat-protocol `files.artifacts` capability, plus the `isHtmlArtifactPath` containment guard. The MulmoClaude host shrinks to thin adapters (the `/api/html` route injects `files.artifacts` and keeps only host file-change pub/sub; `definition.ts` / `index.ts` re-export from the package). META / REGISTRATION shapes are unchanged, so the generated barrels and the host View/Preview are untouched. The Vue View (`./vue`) lands in phase 2. No user-facing change in MulmoClaude.
- **`@mulmoclaude/collection-plugin@0.5.1`** — review follow-ups to 0.5.0's router-optional links (both only affect a router-less host; MulmoClaude is unchanged): keyboard access on the ref/embed links when the host provides no `recordHref` (`role="link"` + `tabindex` + Enter/Space), and a guard so the `file` links don't deaden the click when `navigate` is absent. Centralised into `src/vue/refLink.ts`.
- **`@mulmoclaude/collection-plugin@0.5.0` — consumable by a router-less host** — the plugin no longer hard-assumes vue-router or a `body` teleport, and it now ships a `ToolPlugin` entry on `./vue` (`plugin` + `PresentCollectionView` / `PresentCollectionPreview`) like chart/form/markdown, so a runtime host (MulmoTerminal) can register it directly. Ref/file cell links navigate through the binding (`navigateToRecord` / `recordHref` / `navigate`) instead of `<router-link>`; the record modal teleports to an overridable target (`modalTeleportTarget`, default `body`). MulmoClaude is unchanged — it wires the new capabilities to vue-router. The `pluginPresentCollection.*` i18n keys moved into the package's own locales. No user-facing change.
- **`@mulmoclaude/collection-plugin@0.4.1`** — review fixes on the 0.4.0 extraction: add the missing `common.close` key to all 8 plugin locales (was falling back to the raw key on close buttons), and harden the locale-sync setup against a sticky first-failure. (`0.4.0` had the View-layer + i18n extraction below; these are inside the published package, hence the patch.)
- **`@mulmoclaude/collection-plugin@0.4.0` — Vue UI layer extraction COMPLETE (Phase 2)** — the whole collection frontend now lives in the package's `./vue` entry: every View component (`CollectionView` and its sub-components, the record / config / custom-view modals, and the browsable `CollectionsIndexView` / `FeedsView` index pages) behind a `configureCollectionUi()` host binding, plus the plugin's OWN self-contained vue-i18n instance (all 8 locales, no host i18n dependency). MulmoTerminal can now import the entire collection UI the way it imports the chart / form plugins. No user-facing behaviour change; the host renders the same components from the package.
- **`@mulmoclaude/collection-plugin@0.3.0` — Vue UI layer extraction (Phase 2, first pass)** — the package gains a `./vue` entry (and a shipped `./style.css`) built through a real Vue-SFC pipeline (`@vitejs/plugin-vue` + `@tailwindcss/vite`, d.ts via `vue-tsc`). Six View components move into the package behind a `configureCollectionUi()` host binding — `CollectionRecordModal`, `CollectionEmbedView`, `CollectionCalendarView`, `CollectionDayView`, `CollectionKanbanView`, `CollectionRecordPanel` — so MulmoTerminal can import the collection card UI the way it imports the chart/form plugins. No user-facing behaviour change; the host renders the same components from the package. `CollectionView` + its two config/custom-view modals follow in a later pass.

---

## [0.8.0] - 2026-06-16

Collections graduate from "spreadsheets with bells" into a real DSL platform. The headline change is **custom views** — LLM-authored HTML pages that render alongside the built-in table/calendar, sandboxed in an iframe with the collection's records JSON injected for live filtering, charting, dashboards, even podcast players. A companion **`manageCollection` MCP tool** gives Claude the same affordances the host has — computed-aware reads + schema-validated writes — replacing the previous "Claude writes JSON files directly via Write" pattern. **`spawnBackgroundChat`** lands as a generic parallel-chat primitive that underpins collection-level actions and broader fan-out workflows. Side dishes: per-column sort with localStorage persistence, multi-file attach in the chat input (up to 10), expandable notification bodies, and a fistful of UI / scheduler / CSP fixes.

### Added
- **Custom views for collections** — drop an `views/<slug>.html` (or `.html.tmpl`) under a collection's data folder and a new view picker appears next to table/calendar. The page renders inside a sandbox iframe with the records JSON injected, so vanilla JS / CSS / chart libraries / `<audio>` / `<video>` all work end to end. A view config modal in the CollectionView header lets users reorder, rename, and delete views without leaving the canvas. The (rarely-used) built-in dashboard view is replaced by "author one as a custom view". (#1686, #1687)
- **`manageCollection` MCP tool** — LLM-callable read/write API symmetric to CollectionView. Reads include computed / derived fields; writes go through the same schema validator the UI uses, so a bad record is rejected at call time rather than silently corrupting the data folder. Becomes the canonical way for LLMs to mutate collection records. (#1681)
- **`spawnBackgroundChat` agent primitive** — any tool can now spawn a sibling chat in a different role with a templated seed prompt and get a handle back for status polling. Foundation for the new collection-level actions and broader fan-out workflows (e.g. an invoice action spawning a parallel payment-recording chat). (#1678)
- **Tracked-lessons collection recipe + collection-level actions** — second canonical collection recipe (after invoicing). Demonstrates a *collection-level* action button (vs. the existing per-record kind), the `presentHtml` action target, and the schema-validated write contract end to end. (#1669)
- **Per-column sort in CollectionView's table** — clickable column header cycles ascending → descending → off; the choice persists per (workspace × collection) in localStorage so revisits restore the same order. (#1674, #1677)
- **Multi-file attach in chat input** — paste / drop / file-picker up to 10 attachments per turn (was 1). Each attachment renders in the composer with its own remove button; the send-enabled rule treats text *or* any attachment as a valid send. (#1660)
- **Notification body expansion** — clicking a bell entry now expands its full body (markdown / record snapshot) inline. Faster triage for the daily news brief and collection completion bells. (#1619)

### Changed
- **Dashboard view mode removed** — the fixed, enum-driven dashboard rarely earned its keep; anyone who wants one can now author a custom view tuned to their schema. A persisted `dashboard` value in localStorage falls through to `table` via the existing unknown-mode safety net. All dashboard i18n keys are dropped from the 8 locales. (#1687)
- **CollectionView header shorter** — shaves ~24px off the chrome so on small canvas cards the table body gets more rows visible above the fold without scrolling. (#1689)
- **`MarpSplitEditor` extracted as a shared component** — the marp split-pane editor moves into a reusable component so other markdown surfaces can adopt the same chrome. (#1665)

### Fixed
- **Scheduler state persistence race** — replaced the static `scheduler.tmp` write path with a unique-tmp helper so two scheduler ticks landing in the same millisecond can no longer trample each other's writes (one would publish a half-written JSON). (#1693)
- **CSP blocked audio/video in custom views** — the custom-view CSP omitted `media-src`, so a podcast-feed custom view's `<audio src="https://...mp3">` fell through to `default-src 'none'` and the browser refused to load. Added a `media-src` with the same `https:` + `data:` + `blob:` allowlist as the existing iframe CSP. (#1688)

### Docs / Research
- **"DSLs as Harnesses"** arXiv pre-print — theoretical scaffolding for the collections-as-DSL bet: a DSL can serve as a harness that constrains, validates, and structures an agent's reasoning. CC BY 4.0 + a revision after external review. (#1691, #1692, #1694)
- **"The Workspace Is the Self-Improving Agent"** arXiv pre-print — companion paper framing the workspace + collection corpus as the substrate for "owning the learning loop", from single user up to firm scale. (#1683, #1695, #1696)
- **"Software for an Audience of One"** essay — refines the collections-and-custom-views thesis: applications are data, the schema is the harness, Claude is the runtime. (#1690)
- **Terminal-native chat plan** — design doc for eliminating `claude -p` in favour of a terminal-native chat surface, with permissions also moving terminal-native. (#1697, #1699)

---

## [0.7.0] - 2026-06-10

Three large built-ins move out of the launcher in favour of the schema-driven collections model: **Calendar**, the **Todo plugin**, and the **Encore** recurring-obligation built-in are all removed; their use cases are now expressed as collections (`calendarField` for dated items, `config/helps/todo-collection.md` for todo lists, `triggerField` + `spawn` for recurring obligations). The bundled **invoicing suite** moves the same way — from preset skills to on-demand help-file recipes. No data is deleted; the records on disk are left in place.

### Changed
- The **invoicing suite** (`clients`, `worklog`, `invoice`, `profile`) moved from bundled `mc-*` preset skills to on-demand **help-file recipes** (`config/helps/billing-clients-worklog.md` + `config/helps/billing-invoice.md`), discoverable via two Personal-role sample prompts ("Set up client and time tracking…", "Set up invoicing…"). New workspaces no longer carry the four presets in the skill catalog; the recipes scaffold bare-slug collections (`/collections/invoice`, etc.) over the same prefix-free `data/*/items` record folders. On launch, any lingering starred `mc-{clients,worklog,invoice,profile}` skill is **removed** from `.claude/skills/` (records under `data/*/items` are left untouched), and a one-time bell explains the change — re-running a recipe re-attaches to the same data, so existing records reappear. No data is ever deleted.

### Removed
- The standalone **Calendar view** and the **`manageCalendar`** tool have been removed. Dated items are now modelled as schema-driven collections with a `calendarField` (the collection-native calendar view) — see `config/helps/collection-skills.md`. The `/calendar` launcher button, the `/calendar` route (now redirects to `/automations`), and the `data/scheduler/items.json` file-preview special case are gone. **Automations is unaffected** — `manageAutomations`, the `/automations` view, the `/api/scheduler` routes, and the task-manager all keep working (automations now owns the shared scheduler API namespace). Existing `data/scheduler/items.json` is left in place on disk.
- The **Todo plugin** (`@mulmoclaude/todo-plugin`, the `manageTodoList` tool, the `/todos` route, and the `TodoExplorer` kanban / table / list view) has been removed. Todo lists are now built as schema-driven collections via the `config/helps/todo-collection.md` recipe (status enum + `done` toggle + priority bells), which is the canonical replacement. Existing todo-plugin data (`data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json`) is left in place on disk and is **not** migrated automatically — re-author the list as a collection following the recipe.
- The **Encore** built-in (recurring-obligation DSL, hourly tick, dashboard, `defineEncore` / `manageEncore` tools, `/encore` route) has been removed. Collections now covers recurring obligations via time-driven bells (`triggerField` / `triggerLeadDays`) and host-driven recurrence (`spawn`); the only Encore-unique capability left was graduated multi-phase severity escalation, which did not justify maintaining a second time-driven harness.

---

## [0.6.5] - 2026-05-26

Fixes a production regression where `npx mulmoclaude@latest` failed to load the ToDo and Spotify runtime plugins (e.g. "ToDo の読み込みに失敗しました" on first launch) because the published tarball did not ship them. They now travel with `mulmoclaude` as regular npm dependencies, so a fresh `npx` install boots with ToDo and Spotify available out of the box. Other runtime plugins (`debug`, `edgar`) stay dev-only by design and no longer log misleading `preset package not resolvable` warns in production.

### Fixed
- `npx mulmoclaude` no longer fails to mount ToDo / Spotify on first launch — `@mulmoclaude/todo-plugin@^0.1.0` and `@mulmoclaude/spotify-plugin@^0.1.0` are now real npm dependencies of `mulmoclaude` (#1513, #1515).
- Preset loader downgrades the missing-package log to `debug` for entries flagged `devOnly: true`, so legitimately dev-only presets stop scaring production users (#1513).

### Added
- Two new published npm packages backing the runtime plugins:
  - [`@mulmoclaude/todo-plugin@0.1.0`](https://www.npmjs.com/package/@mulmoclaude/todo-plugin/v/0.1.0)
  - [`@mulmoclaude/spotify-plugin@0.1.0`](https://www.npmjs.com/package/@mulmoclaude/spotify-plugin/v/0.1.0)

---

## [0.6.4] - 2026-05-20

Four-day patch focused on a new **Encore** built-in (cycle-state planning + bell-reconciled todos), a **CodeMirror-based inline JSON editor** for workspace configs, **Docker-aware MCP catalog with stdio→HTTP shim** (so stdio-only MCP servers run inside the sandbox), and a **role split** that pulls personal-assistant workflows out of `General` into a dedicated `Personal` role. Plus the system-prompt build path was rearchitected (literals out to files, helps-injection deleted, topic-memory context index-only) and a handful of UI polish wins (srcset rewriter, app version in Settings, notification-history collapse, TODO kanban done-column menu).

### Highlights

#### Encore — cycle-state planning + bell-reconciled todos
- New **`/encore` dashboard page** with an icon-only top-bar entry, backed by an Encore built-in plugin (#1427, #1443).
- Split **structural `defineEncore`** (one-shot schema definition) from **operational `manageEncore`** (ongoing ticket ops) so the LLM can't confuse the two (#1437).
- Single-reconciler bell-state model with **unsnooze**, timezone-correct triggers, directory hygiene, ticket-rename support, and ghost-ticket rescue (#1433, #1440, #1441).

#### CodeMirror-based inline JSON editor (#833 Phase 1)
- Workspace JSON configs now open in an in-page editor (Files view, #1418).
- Lazy-loaded CodeMirror 6 backend with syntax-aware editing replaces the textarea (#1450, #1448).

#### MCP catalog becomes transport-aware (#1421)
- Docker-only stdio MCPs get a clear **"this won't run inside the sandbox"** note in the catalog; GitHub MCP now points at the HTTP transport (#1422).
- Opt-in **stdio→HTTP shim** lets stdio-only MCP servers run inside the Docker sandbox via a side-process bridge — covers the previous gap (#1436).

#### Role split — General + Personal (#1430)
- `General` is split into a lean `General` (research / coding) and a new **`Personal`** role (memory, journal, calendar, TODO, photos). Encore's seed role is pinned to Personal.
- Roles now rely directly on the per-role prompt files; the old `helps`-injection layer is deleted (#1431).

#### Wiki / image / UI polish
- `<img>` / `<source>` **`srcset` rewriter** in both wiki and PDF surfaces (#1407, closes #1275).
- Wiki external/workspace markdown links restyled for clarity (#1453).
- TODO kanban **done-column menu** with check icon and click-outside dismiss (#1452); plugin-seeded first turns render as a **skill-style card** (#1447).
- Settings modal shows the **app version** (#1412, closes #1410).
- NotificationBell **collapses history beyond 5 rows** behind a toggle (#1439); notifier gains an **update op + action-style priority alerts** for todos (#1451).

#### Skill catalog UX
- Add-repo flow now offers **fill-form suggestions**, repo link, and expandable description for each preset (#1415, closes #1413).

### Added
- **Encore** built-in: dashboard page, `defineEncore` / `manageEncore` tools, unified bell reconciler with unsnooze (#1427, #1437, #1433, #1443).
- CodeMirror 6 JSON editor for workspace files (#1418, #1450).
- MCP transport-aware catalog + stdio→HTTP shim (#1421 / #1422 / #1436).
- New `Personal` role split off from `General` (#1430).
- Skill add-repo suggestions UX (#1415, closes #1413).
- `srcset` rewriting on `<img>` / `<source>` for wiki + PDF (#1407, closes #1275).
- App version surfaced in Settings (#1412).
- NotificationBell history collapse + notifier update op / priority alerts (#1439, #1451).
- TODO kanban done-column menu polish (#1452).
- Plugin-seeded text-response renders as a skill-style card (#1447).

### Changed
- System prompt internals refactored: static literals extracted to `server/prompts/`, `helps`-injection deleted, topic-memory context is index-only, dead readLegacyMemoryFile / buildWikiContext branches removed (#1425, #1431, #1434, #1435).
- Wiki external-link styling distinguishes workspace vs external (#1453).
- `Skill` tool added to the agent allowlist so user-installed `.claude/skills/` are invokable (#1445).
- Built hook dispatcher relocated to `server/build/`, sourcemap dropped (#1449).

### Fixed
- `optionalDeps` notification title/body wording (#1429).
- e2e-live `L-ERR` / `L-15b` flakiness on real-Claude runs (#1446).
- `publish smoke` Puppeteer Chromium download + plugin-probe race (#1442, #1428).
- Encore review P0s + form-schema validation LLM-trap (#1441).
- Skill `flex-1` restored after StackView selector was scoped (#1408, follow-up to #1277).
- Playwright browsers auto-installed via the test script chain (#1411).

### Security
- Opt-in stdio→HTTP shim (#1436) lets stdio MCP servers run inside the Docker sandbox via a bridged HTTP transport, closing a gap where catalog entries were silently host-only.

---

## [0.6.3] - 2026-05-16

Three-day patch centred on the **external skill catalog** (a multi-PR `#1383` / `#1335` track), an **MCP reliability trio**, and **graceful degradation when optional host tools are missing**. Skills are now browsable / star-able / preview-able from a hierarchical catalog that can pull from external Git repos. MCP servers get boot-time preflight, a runtime failure monitor, and catalog-derived error hints. Missing `ffmpeg` / `docker` no longer crash startup — the app degrades and tells you which features are off.

### Highlights

#### External skill catalog (#1383 / #1335)
- Skills are split into **catalog** (browsable, not in the system prompt) vs **active** (loaded). Star to activate; Preview and Run-once before committing.
- Catalog can pull skills from **external Git repos** (backend C1, hierarchical UI C2, per-repo Update button C3). Recommended presets seeded, including `obra/superpowers`.
- `/skills` legend now shows inline category icons; nested preset scanning.

#### MCP reliability trio
- **Boot-time preflight (#1352)** — catalog-backed MCP servers with missing required config are skipped with a warning instead of spawning a subprocess that fails every call silently.
- **Runtime failure monitor (#1353)** — a server that fails repeatedly raises a bell notification.
- **Error hint chip (#1354)** — MCP tool errors in the right sidebar carry a catalog-derived "how to fix" hint.

#### Graceful degradation for optional host dependencies (#1385)
- Missing `ffmpeg` / `docker` / other optional host tools degrade gracefully (clear notification + affected-feature list) instead of hard-exiting at startup.
- New `--disable-sandbox` flag plus bundled boolean CLI flags (#1089 / #1397).

#### Multi-day calendar events (#1368)
- Calendar now renders events that span multiple days.

#### Role-aware empty state
- A fresh chat shows clickable starter queries tailored to the active role.

#### Investor role gains X (Twitter) access
- `searchX` / `readXPost` added to the Investor role.

### Added
- External skill catalog: catalog/active split, Star, Preview, Run-once, external Git repo install + update (#1383, #1335).
- MCP boot preflight (#1352), runtime failure monitor (#1353), error-hint chip (#1354).
- Optional-dependency graceful degradation + `--disable-sandbox` / bundled boolean CLI flags (#1385, #1089, #1397).
- Multi-day calendar events (#1368).
- Role-aware empty state with clickable starter queries.
- `searchX` / `readXPost` for the Investor role.
- `liveIsRunning` session predicate (#1195).
- Scheduled Claude-free e2e-live workflow (daily 03:00 JST) + expanded fake-echo scenario coverage.

### Changed
- Dropped `?result=` URL persistence — sessions default to the latest result on load.
- `helps` model names aligned with the `presentMulmoScript` canonical structure (#1009).
- `auth-token` persistence across server restarts documented (#1351); ffmpeg prerequisite documented.

### Fixed
- `presentMulmoScript`: silent beats now advance by duration during Play (#1073); inline error chip + retry on movie-generation failure (#1197).
- `StackView`: `flex-1` neutralisation scoped to vertical flex only (#1277).
- CodeRabbit sweep follow-up — starter-query key collision, magic-number / hardcoded-path cleanup, and a pre-existing `@types/which` typecheck break on `main` (#1379 / #1364 / #1371).

### Security
- MCP boot preflight (#1352) stops half-configured catalog servers from spawning subprocesses that would otherwise fail every tool call silently (401 / missing-credentials), reducing the chance of a misconfigured server being mistaken for a working one.

---

## [0.6.2] - 2026-05-13

Three-day patch focused on **Settings UX**, **agent control surface**, and **bridge security hardening**. The Settings modal is now a grouped sidebar (4 categories) and exposes a new **Model** tab for tuning Claude's reasoning effort. New built-in plugins (`presentSVG`, `edgar`) and an **Investor** role land alongside a re-shaped preset-skill system (`mc-settings`, `mc-cooking-coach`). All 6 webhook bridges grow rate limiting + trust-proxy hardening, and several reflected-XSS paths are closed.

### Highlights

#### Configurable reasoning effort (#1320 / #1323)
- New **Model** tab in Settings exposes the `claude --effort` level (`low` / `medium` / `high` / `xhigh` / `max`). Persisted under `<workspace>/config/settings.json`; unset → Claude's default. Settings reload per-run, so the change applies on the next message without restart.

#### Settings menu reorganised (#1333)
- The horizontal tab strip is now a **grouped left sidebar** (LLM / Servers / Workspace / Plugins). Modal grows from 36rem to 52rem but caps at 95vw on smaller viewports. Existing `data-testid` selectors preserved — no e2e breakage. Active item carries `aria-current="page"`; nav label is fully translated.

#### File drop on the chat panel (#1289)
- Drag-and-drop now lights up the entire chat panel (was: just the input), with a clear visual affordance. The window default guard prevents the browser from navigating away when the drop lands outside the panel.

#### EDGAR + SEC built-in plugin
- New `edgar` plugin (server-only — no Views) gives the agent direct access to SEC EDGAR filings. Bundled into a new **Investor** role alongside Yahoo Finance instructions.

#### presentSVG plugin
- New built-in plugin renders generated SVGs as inline canvas surfaces. Roles can opt in via `availablePlugins`.

#### Preset skills replace fixed roles
- `cookingCoach` role → `mc-cooking-coach` preset skill (#1286). `settings` role → `mc-settings` preset skill (#1283), then split into 3 focused skills. Preset skills are user-editable and version-controllable; fixed roles aren't.

#### Agent permission scaffolding
- Workspace-scoped allow rules are now provisioned at server startup, so first-run permission prompts no longer block routine tool invocations.

### Added
- `effortLevel` field in app settings + `--effort` CLI plumbing (#1323).
- Settings **Model** + **Sidebar** UI; nav `aria-label` localised across all 8 locales.
- `presentSVG` and `edgar` built-in plugins.
- `Investor` role with EDGAR + Yahoo Finance instructions.
- Preset skills: `mc-settings` (3 focused subskills) and `mc-cooking-coach`.
- Workspace-scoped agent permission provisioning at startup.
- File-drop visual affordance + chat-panel-wide drop target (#1289 Step 1 + Step 2).
- `docs/shared-utils.md` catalog + CLAUDE.md guardrail (#1304).
- Stdio-MCP-under-Docker warning surfaced in the MCP settings UI (#1334).

### Changed
- Settings modal: top tabs → sidebar with 4 groups (#1333).
- Accounting amount formatting consolidated into one helper (#1308).
- Date formatting in plugin Views routed through `src/utils/format/date.ts` (#1307).
- `truncate()` callsites consolidated into `server/utils/text.ts` (#1306).
- Inline error normalisation migrated to `errorMessage()` helper (#1305).
- New shared `formatBytes()` helper (#1309).
- Wiki bullet `[[slug|display]]` rows now share the same parser as inline wiki links.
- DOM-pure wiki-page helpers relocated under `src/lib/wiki-page/` (#1297).
- `uuid` bumped to 14.0.0.

### Fixed
- pdf.ts: switched to `waitUntil: "load"` for Puppeteer 24 type compatibility.
- wiki: score-based fuzzy resolve replaces iteration-order matching (#1194).
- chat: generated-file references in LLM replies now linkify reliably (#1300).
- pdf responses: skip Content-Security-Policy header (#1299).
- chatinput: drop overlay clears on window-boundary `dragleave` (#1327 follow-up).
- Docker sandbox: stdio MCP entries are dropped (they can't run inside the minimal image — #1334).
- runtime-plugin: HEAD probes on plugin assets bypass bearer auth.
- hooks: atomic mirror write + API_ROUTES constant in tests.
- Codex/Sourcery follow-ups across #1316, #1318, #1325, #1326, #1328, #1331.

### Security
- All 6 webhook bridges: express-rate-limit added on POST + `env`-driven trust-proxy.
- Bridges: `hub.challenge` echoed as `text/plain` with whitelisted shape (CodeQL `js/reflected-xss`).
- wiki: HTML-escape target + display in `renderWikiLinks` (XSS).
- `keyGenerator` routed through `ipKeyGenerator` for IPv6-safe rate-limit keys.

---

## [0.6.1] - 2026-05-10

Two-day patch with several visible additions: a **wiki-syntax embed** family (`[[amazon:...]]`, `[[isbn:...]]`, `[[youtube:...]]`) usable across every markdown surface, **photo location capture** that pulls lat/lng from EXIF on every saved/forwarded image, and the **Map plugin** wired up to `@gui-chat-plugin/google-map`. Notifications fired by the `notify` MCP tool inside a chat now carry a click target back to the source session.

### Highlights

#### Wiki-syntax embeds (#1221)
- Author markdown can now write `[[amazon:B00ICN066A]]`, `[[isbn:9780062316097]]`, or `[[youtube:dQw4w9WgXcQ]]` instead of raw URLs and get a clickable card / link / inline player. The renderer is registry-driven so future prefixes plug in cleanly.
- **YouTube** plays inline via `youtube-nocookie.com` (no profile cookies until click), wrapped in a 16:9 box. **Amazon** shows the product cover thumbnail and links to the user's locale-appropriate storefront (`amazon.co.jp` for `ja`, `amazon.de` for `de`, …, falls back to `.com`). **ISBN** links to OpenLibrary.
- External markdown links across wiki / files / chat artifact / sources / skill body now open in a new tab on click instead of being dead-clicks.

#### Photo locations (#1222)
- Every photo MulmoClaude saves (chat attachments, bridge-forwarded images, file uploads) now has its EXIF parsed: lat/lng + timestamp + camera + lens captured into a sidecar JSON under `data/photo-locations/`. HEIC / HEIF / TIFF supported alongside JPEG.
- New built-in `managePhotoLocations` plugin lets the agent and user list / search / open photos by date, place, or camera.
- Photos tab in Settings exposes the auto-capture toggle.
- LINE bridge now forwards inbound image messages to the agent for the same processing.

#### Map plugin (#1227)
- Integrated `@gui-chat-plugin/google-map@0.4.0`. Add a Google Maps API key under Settings → Map and the agent can show locations, add markers, find places, and request directions inline in the chat canvas.
- Available in `general` / `guide` / `debug` roles.

#### Notifications open the source chat (#1262)
- When the `notify` MCP tool fires from inside a chat session (typically a scheduled background chat reporting completion), the bell entry now carries a navigate target. Clicking opens that chat session instead of just dismissing.

### Added
- `[[amazon:...]]` / `[[isbn:...]]` / `[[youtube:...]]` wiki-embed renderers + extension registry (#1252 / #1261 / #1265 / #1269).
- `managePhotoLocations` built-in plugin + Photos settings tab (#1247 / #1250 / #1251).
- Map plugin wiring + Settings → Map tab + role enablement (#1241 / #1255 / `4c5b3e1`).
- LINE bridge: inbound photo forwarding (#1264, `b3aab94`).
- `notify` MCP tool: chat-session linkback via `navigateTarget` (#1262).
- Plan files for #1221, #1222, #1244, and Encore Phase 2 (DSL + compiler + runtime architecture).

### Changed
- Runtime plugins relocated from `packages/<name>-plugin/` to `packages/plugins/<name>-plugin/` for a cleaner monorepo layout (#1242). No npm package names change.
- `marked` config: external links inject `target="_blank" rel="noopener noreferrer"` automatically — wired into all 6 markdown / sheet renderers (#1252).
- Roles now gate runtime plugins by `availablePlugins` (#1266); previously runtime plugins were universally exposed regardless of role.
- DOMPurify call sites for skill body / manageSkills / sources description now go through a shared `sanitizeMarkdownHtml` wrapper that selectively allows YouTube embeds while keeping every other iframe stripped.

### Fixed
- StackView no longer over-grows iframes on remeasure or in stack layout — postMessage height path now caps at the viewport (`a2017c4` / `0ae82df` / `5817790` / `4aa6461`).
- Map plugin: `googleMapKey` flows through StackView; View force-remounts when the key transitions null → set; key gated to `mapControl` only so other plugins can't read it (`f45067c` / `894ef3c` / `79a7cbf` / `1b04a34`).
- presentMulmoScript: beat edits now persist across page reload + in-SPA nav (#1074, `adcca77` / `7dc74b0`).
- Workspace links: percent-encoded image self-repair + multibyte URL routing fixed (#1102, `b8899fb` / `c8b14e0`).
- Photo EXIF: lat/lng rescue path covers more vendor variants; HEIC/HEIF/TIFF registered for capture (#1222, `8c9aea7`).
- mulmoclaude launcher deps: `@gui-chat-plugin/google-map` and `exifr` declared so the published tarball boots (`c798a20` / `5e17513`).
- CI cache path now includes `packages/plugins/*/dist` after the workspace move (`830a5145`).

### Security
- DOMPurify wrapper enforces a strict allowlist for iframes — only `https://www.youtube-nocookie.com/embed/<11-char-id>` survives the hook; foreign hosts and the cookie-tracking `youtube.com` host are stripped.
- Map plugin: `googleMapKey` only reaches the `mapControl` plugin; other plugins receive `null` (`1b04a34`).

---

## [0.6.0] - 2026-05-08

A two-week release. The themes: a usable **Accounting plugin**, the start of the **personal-use plugin sets** (recipe-book, reading-list / articles / quotes, map), a **Memory system** with proactive recall and edit UI, the **Notifier (Encore) prototype**, the **Spotify plugin**, **MulmoScript** quality-of-life polish, and a swarm of dev-experience wins.

### Highlights

- **Accounting plugin** — bookkeeping with batch journal entry, invoice-system T-number handling, BS/PL shortcuts, time-series view, account naming with codes, dedicated Accounting role.
- **Memory system** — proactive recall during turns + in-app edit UI for memory entries.
- **Personal-use plugin sets begin shipping** — recipe-book (Cooking Coach PR-A), reading-list / articles / quotes (My Library PR-A/B/C), map plugin scaffold. Roadmap in #1169.
- **Skill body collapsed in canvas** (#1220) — invoking a skill shows a card (name + description), expandable to the full markdown body. No more wall-of-text in the canvas.
- **Spotify plugin** — OAuth + listening data + search + player controls.
- **Notifier (Encore) prototype** — early cross-channel notification surface.
- **MulmoScript polish** — lightbox toolbar (#918), background-movie load (#888 / #889), General role can author MulmoScripts (#887).
- **MCP catalog expansion** — Spotify, YouTube, GitHub, Linear, Google OAuth presets out of the box (#867 / #868 / #869 / #872 / #873).

### Added

- **Wiki edits show inline in chat** (#989) — when the LLM `Write`s/`Edit`s a `data/wiki/pages/*.md`, the canvas renders the page automatically from the snapshot taken at that exact moment.
- **Wiki page history UI** (#917 / #946) — browse a page's edit history and roll back.
- **`presentHtml` becomes editable** (#988 / #1001 / #982) — the agent can iteratively edit a generated HTML doc instead of regenerating from scratch.
- **Copy chat as Markdown** (#1065) — one-click copy of the whole conversation.
- **Skills tab in suggestions** (#886) — invoke saved skills from the suggestions panel.
- **Today's journal shortcut** (#879) — sidebar shortcut to today's journal entry.
- **Session bookmark + delete** (#953) — pin or remove sessions from the sidebar.
- **Bridge skill shortcut** (#967) — bridge messages starting with `/<slash>` route to the matching saved skill, so phone-side users can invoke skills with one keystroke.
- **`tool_result` payloads carry an `artifactPath`** field (#983) — cards link directly to the underlying file.
- **Image rendering unified across PDF, presentHtml, and the chat canvas** (#969 / #972 / #974) — workspace-relative `![]()` references resolve consistently everywhere.
- **Translation service** for role queries (#1172 / #1173).
- **`/debug` page** (#1192) and dev-mode debug role (#1186), gated on `VITE_DEV_MODE=1`.
- **`create-mulmoclaude-plugin` CLI** (#1163) — scaffolder for new runtime plugins.
- **Preset skills** shipped with the launcher (#1211).
- **Plugin error boundary** (#1147) — when a plugin crashes, the canvas shows a fallback card instead of breaking the whole pane.
- **Tool-call history persists across reloads** (#1101) — the right-sidebar history pane reconstructs from the session JSONL.

### Changed

- **`manageWiki` MCP tool removed** — wiki edits auto-render via Write/Edit. Browse / lint flows direct the user at the `/wiki` UI. View-only `PluginEntry` retained so historical sessions still render their `manageWiki` cards (#989).
- **Todo plugin migrated to `packages/todo-plugin/`** runtime-plugin shape; existing `~/mulmoclaude/data/todos/{todos,columns}.json` auto-migrates on first launch (#1149).
- **`yarn dev` skip-if-fresh package build** (#1208) — cold-restart 8.5s → 0.04s when source is unchanged.
- **`yarn package`** one-liner builds a publishable `mulmoclaude-X.Y.Z.tgz` with stale-tarball cleanup (#1230).
- **MCP server presets** — Spotify / YouTube / GitHub / Linear / Google OAuth available without manual registration (#867 / #868 / #869 / #872 / #873).
- **Atomic writes v2** (#885 / #890) — workspace files (wiki pages, journal, todos, …) write via tmp-and-rename so a kill -9 mid-save can't leave a half-written file.
- **`gui-chat-protocol` bumped to 0.3.0** (#1123) → 0.3.2 mid-cycle (typed runtime endpoints).
- **`zod` v4** for built-in plugins (#1204).

### Fixed

- **Sandbox mode silently disabled in published npm package** — `Dockerfile.sandbox` and `sandbox-entrypoint.sh` are now bundled (carried over from 0.5.3 with extra tarball asserts).
- **`presentHtml` iframe height** (#1228) — long HTML docs scroll naturally instead of clipping at the pane bottom.
- **`presentHtml` Safari CSP** (#991) — Safari's inline bootstrap scripts no longer blocked.
- **`/files` HTML preview relative paths** (#980), **`artifacts/html` sibling images resolve** (#981).
- **Wiki page-edit publish failure no longer 500s** the snapshot route — the snapshot is already on disk; a publish error logs a warning instead of failing the response.
- **Notifier validation + emit safety** (#1199 / #1223).
- **Chat attachment leak** (#1069) — attachment uploads no longer carry over between chats.

### Security

- **Strict data gating** for plugin scope roots (#1181) — plugins can only read/write inside their scoped data directory; lexical traversal checks prevent `..` escapes.

### Breaking Changes

- **`manageWiki` MCP tool definition removed** (#989). Custom roles listing it still load (lenient zod parse silently drops the name) but the LLM can no longer call it. Agents that needed `manageWiki action='page'` to display a page in the canvas no longer need that call — wiki Writes/Edits auto-render.
- **Built-in todo plugin moved to `packages/todo-plugin/`** (#1149). Existing data auto-migrates on first launch. Custom code importing from `src/plugins/todo/` will fail to resolve — switch to `@mulmoclaude/todo-plugin/{shared,composables,vue}`.

### Packages published during this cycle

- `@mulmobridge/client@0.1.5` (#994), `@mulmobridge/chat-service@0.1.3` (#993).

---

## [0.5.3] - 2026-04-29

### Fixed

- **Sandbox mode silently disabled in published npm package** — `Dockerfile.sandbox` and `sandbox-entrypoint.sh` were not bundled into the `mulmoclaude` tarball, so on `npx mulmoclaude` the server logged `Failed to set up sandbox, running unrestricted` and fell back to unrestricted execution. Both files are now copied by `prepare-dist.js` and listed in `files`, and `scripts/mulmoclaude/tarball.mjs` asserts their presence in the packed tarball to prevent regressions.
- **`mulmoclaude --version` printed stale `0.5.1`** — the launcher had a hard-coded version string that drifted from `package.json` after 0.5.2. Now matches the published version.

---

## [0.5.2] - 2026-04-29

### Fixed

- **Image rendering in HTML / PDF** — LLM-generated content emitting `<img src="/artifacts/images/…">` (web-rooted convention) now renders correctly. The path-traversal hardening from #384 was correct but didn't recognise the leading-slash form, so:
  - PDF generation logged `image path escapes workspace` and produced a broken `<img>`.
  - presentHtml plugin's iframe srcdoc 404'd the image because `/artifacts/` isn't served at the SPA origin.
  Both paths now treat leading-slash as workspace-rooted while keeping the workspace boundary check intact (e.g. `/etc/passwd` is still rejected). (#961)

---

## [0.5.1] - 2026-04-27

### Fixed

- **MCP catalog Notion entry** — switched from the legacy `OPENAPI_MCP_HEADERS` JSON-string form (with a hardcoded `Notion-Version: 2022-06-28`, three years stale) to the official `NOTION_TOKEN` env var, which the upstream README marks as recommended. Users who installed Notion via the catalog before this change still work, but their `~/mulmoclaude/config/mcp.json` keeps the old shape — re-install from Settings → MCP to pick up the new env shape and access the 2025-09-03 API features (data sources, 7 new tools). (#852 / #860)
- **Wiki / sources help text**: align on-disk YAML key names so the help-file driven hints match the keys the agent emits (#855 / #861).
- **E2E**: stop flakiness in the chat-target notification test (#863); update Notion catalog test for the new `NOTION_TOKEN` env shape.

### Changed

- **CI**: shard e2e across 2 parallel runners; add `restore-keys` + `packages/dist` cache for Windows speedup; skip `lint_test` + `e2e` on docs / plans / markdown-only PRs (#862, #864).

---

## [0.5.0] - 2026-04-27

### Highlights

- **Notifications grew up** — macOS Reminders sink (Darwin-only, opt-out by default via `MACOS_REMINDER_NOTIFICATIONS=0`); `notify` exposed as an MCP tool so the agent can fire notifications directly; deep-link permalinks let a notification jump to its target todo / wiki page / chat session; per-item read state — clicking or dismissing a single notification decreases the badge count.
- **Sources got its own page** — `/sources` replaces the Source Manager built-in role with a page-scoped chat composer plus filter chips by fetcher kind / schedule. Suggested queries on the Sources view start chats already aware of the active filter.
- **News viewer (`/news`)** — unread management UI, per-article chat composer that scopes the new session to that article.
- **`manageScheduler` split into `manageCalendar` + `manageAutomations`** (#824) — clearer per-surface tools; legacy view-only fallback keeps pre-split chat sessions readable.
- **MCP catalog UI** (#823) — Phase 1 ships a curated list of preset MCP servers with checkbox install for config-free entries; Phase 2 adds a per-server config form and 6 new entries.
- **`presentForm` in General role** (#826) — choice / yes-no / feature-toggle prompts surface as clickable forms; submit text reads as a markdown bullet list (`- {label}: {value}`) instead of a JSON wrapper, so chat history stays human-readable.
- **Wiki**: tag-based filtering on the index, "Create this wiki page" empty-state CTA, "Lint My Wiki" button, interactive GFM task checkboxes that round-trip to disk, Unicode hashtags accepted in index bullets.
- **Session history side panel** (#728) — independent toggle (canvas and history can coexist), expand-to-full-width, badge moved onto the toggle button. The standalone `/history` route is retired in favor of the panel.
- **Files view** (#832) — system-managed file description banner; file-tree icons tinted by edit policy (read-only / system-managed / writable).
- **Thinking… indicator** (#839, #731 PR2) — shared across slide and stack views, per-tool elapsed time, gated on whether _this_ session is running rather than the global isRunning.
- **Server observability** (#779) — structured `log.{error,warn,info,debug}` audit; layered logging on 10+ routes (plugin / files / todos / chart / config / html / roles / sessions / skills / image).
- **Smoke-tested `mulmoclaude` tarball in CI** (#667) — pre-publish smoke workflow verifies the npm package boots before release.
- **Slack ack reaction** (`@mulmobridge/slack@0.4.0`) — `SLACK_ACK_REACTION=1` adds 👀 on receive so the user sees the bot saw the message before the agent finishes (#695).
- **Per-platform default role for relay** — `RELAY_<PLATFORM>_DEFAULT_ROLE` lets relay assign different default roles per platform (#739).

### Added

- **`/news`** viewer with unread management; per-article chat composer.
- **`/sources`** page with chat composer + filter chips by fetcher kind / schedule; suggested-queries list.
- **macOS Reminders notification sink** — Darwin-only, on by default, disable with `MACOS_REMINDER_NOTIFICATIONS=0`; title/body passed via argv (not osascript attribute) to close a string-injection vector (#789).
- **`notify` MCP tool** — agent can fire push-style notifications directly.
- **Notification permalinks** — every notification deep-links to its target item (#762).
- **`manageCalendar` + `manageAutomations`** plugins (split from `manageScheduler`, #824).
- **MCP catalog UI** — preset server list, checkbox install, per-server config form, 6 curated entries (#823).
- **`presentForm` in General role** with prompt nudge for choice questions and `required: true` instruction (#826).
- **Wiki**: tag filter chips on index, "Create this wiki page" CTA on empty pages, "Lint My Wiki" header button, interactive GFM task-checkbox toggle (#775), Unicode hashtag support, per-page chat composer extracted into reusable `PageChatComposer`.
- **Files**: system-managed file description banner, edit-policy-tinted file-tree icons (#832).
- **`fetchWithTimeout` helper** — `AbortController`-based; wired into MCP + X API call sites (#722).
- **Layered logging** on plugin routes / files / todos / chart / config / html / roles / sessions / skills / image (#779).
- **Smoke-test workflow** for the published `mulmoclaude` tarball — dep audit, drift check, tarball smoke, CI artifact upload (#667).
- **Slack ack reaction** — opt-in `SLACK_ACK_REACTION` env (#695).
- **Per-platform default role** — `RELAY_<PLATFORM>_DEFAULT_ROLE` (#739).
- **Artifact directory sharding** by `YYYY/MM` to keep folders manageable (#764).
- **Side-panel expand toggle** — full-width session-history view (#728 follow-up).
- **History filter via URL path param** — `/history/unread`, `/history/scheduler`, … bookmarkable (#677).
- **Suggestions trigger** moved into the composer button column for closer reach.
- **Tab-bar origin badge overlaid on role icon**; bold unread labels.

### Changed

- **`manageScheduler` is now split** into `manageCalendar` + `manageAutomations`. Pre-split sessions render via a legacy view-only fallback (#824). See **Breaking Changes** below.
- **`/history` retired** — history is now the side panel only; the route + entrance composable were removed.
- **Source Manager and Role Manager built-in roles removed** — sources live on `/sources`, roles on `/roles`.
- **`currentRoleId` is user-owned**; `RoleSelector` ownership refactored so role state isn't trapped in a chat composable (#714).
- **`presentForm` submit text** — JSON `{"formSubmission":{...}}` → markdown bullet list (`- {label}: {value}`). Free-form text values use indented continuation; checkbox selections render as a nested sub-list to avoid comma-ambiguity (#826).
- **Slug rule unified** across journal / todos / wiki / files (#732). Single canonical `slugify` (`server/utils/slug.ts`) — non-ASCII deterministically hashed (16-char base64url SHA-256 prefix), ASCII lowercased + hyphenated. `isValidSlug` and the slug-output cap both moved from 64 → 120 chars. **Breaking** — see below.
- **`FilterChip` component** unified across panels — Sources, History, Wiki tag filter all share one chip implementation.
- **Top-bar and panel-header control sizing** standardized (`h-8` square / `h-8 px-2.5 pill` / `flex items-center gap-2 px-3 py-2` row container). Panel-header layouts collapse into one row to match.
- **`@mulmobridge/slack`** v0.3.0 → **v0.4.1** — ack reaction, then a stable-version bump as part of the bridge package sweep.
- **`@mulmobridge/protocol`** → **v0.1.4**, **`@mulmobridge/chat-service`** → **v0.1.2**, **`@mulmobridge/client`** → **v0.1.3** → **v0.1.4** — opaque `options` passthrough from bridge env to the host app, narrower `bridgeOptions` types.
- **`@mulmobridge/cli`** → **v0.1.3**, **`@mulmobridge/telegram`** → **v0.1.3**, all other 22 bridges → **v0.1.1** — workspace-dep range tightening + README catch-up sweep.

### Fixed

- **Wiki**: per-entry tag chips set the filter (no longer toggle the active filter off); index-table images resolve under `data/wiki/`; distinguishes missing vs empty page; route GET `/api/wiki?slug=...` through `buildPageResponse`; backtick-stripped index-table headers; tag filter cleared on Index/Log/Lint navigation; toolbar padding + frontmatter visibility cleaned up.
- **Files**: large audio/video preview in `/files` + audio-file icon; PDF filename derived from content with `yyyy-mm-dd` suffix (#831).
- **Image plugin**: workspace-rooted refs + bridge timeout (#782); legacy `markdowns/` and `spreadsheets/` paths migrated and rejected at the validator (#773).
- **Notifications**: per-item read state — click or dismiss decreases the badge; chat-target test pre-seeds a session to avoid the `/chat` auto-create race; agent-completion bell muted (duplicate of session panel badge).
- **Sessions**: `isRunning` split into global vs active-session scoped; URL query preserved when `activateSession` runs on URL-driven path; current session id cleared off `/chat` so unread doesn't clear on background finish.
- **Skills Run button** routes through `startNewChat` so the user sees the response.
- **Spreadsheet preview cards** simplified; e2e canonical paths under `artifacts/spreadsheets/`.
- **i18n**: 6 user-facing English strings translated (closes #713); German typographic-quote handling rule added (`„` U+201E / `"` U+201C in `de.ts`); aria-labels on send/attach/suggestions buttons.
- **Settings**: reference + workspace dirs auto-save on add/remove (#716); modal-level Save/Cancel dropped (Tools tab keeps its own); MCP form serializes `persistMcp` and updated E2E for new save UX.
- **Wiki self-heal**: `taskPersistChain` recovers when `persistWikiPage` rejects (#795).
- **Build / CI**: i18n cache reset between wiki page-save tests (Windows / Node 24 flake); Playwright runs on dedicated port 45173; ci-stub for Claude Code CLI in launcher pre-flight; smoke-verified mulmoclaude tarball uploaded as workflow artifact.
- Many follow-up commits addressing Codex / CodeRabbit / human review feedback across ~30 PRs.

### Security

- **macOS Reminders sink**: title/body now passed via argv to `osascript` instead of the system attribute, closing a string-injection vector that could land in a Reminder if a notification body contained `osascript`-meta characters (#789).
- **Sandbox + smoke**: smoke driver runs with `DISABLE_SANDBOX=1` on CI (no `~/.claude` available), but ships sandbox-on for end-users.

### Breaking Changes

- **`manageScheduler` is split into `manageCalendar` + `manageAutomations`** (#824). Pre-split chat sessions still render their tool-results via a view-only legacy fallback (`legacyManageSchedulerEntry`), but agents can no longer call `manageScheduler` — new prompts must target the right half (`manageCalendar` for events / `manageAutomations` for recurring tasks).
- **Source Manager and Role Manager built-in roles removed**. Existing chat sessions keep working; new manageSource / manageRoles calls flow through their respective dedicated pages (`/sources`, `/roles`) and any role still on the legacy id falls back to `general`.
- **Slug rule unification (#732)** — same impact as documented in the prior `[Unreleased]`:
  - **Journal topics with non-ASCII names**: `slugify` previously dropped non-ASCII characters and collided distinct Japanese names onto a single `topic.md`. After #732 each distinct name maps to a unique `<hash>.md`. **Migration**: none — old `topic.md` files become orphans under `<workspace>/conversations/summaries/topics/`; the journal regenerates fresh summary files on the next pass and operators may delete the orphans at their own pace.
  - **Todo columns**: default column id `in_progress` becomes `in-progress`, new custom-column ids use the hyphen separator. Existing `data/todos/columns.json` is read as-is so workspaces keep their stored ids; the new defaults apply only to fresh workspaces.

### Packages published during this cycle

- `mulmoclaude@0.5.0` (this release)
- `@mulmobridge/slack@0.4.1`, 0.4.0, 0.3.0
- `@mulmobridge/protocol@0.1.4`
- `@mulmobridge/chat-service@0.1.2`
- `@mulmobridge/client@0.1.4`, 0.1.3
- `@mulmobridge/cli@0.1.3`
- `@mulmobridge/telegram@0.1.3`
- `@mulmobridge/{bluesky,chatwork,discord,email,google-chat,irc,line,line-works,mastodon,matrix,mattermost,messenger,nostr,rocketchat,signal,teams,twilio-sms,viber,webhook,whatsapp,xmpp,zulip}@0.1.1`

---

## [0.4.0] - 2026-04-23

### Highlights

- **13 new messaging bridges** bring the total bridge count to 20+ — bots can now talk to Mastodon, Bluesky, Chatwork, XMPP / Jabber, Rocket.Chat, Signal, Microsoft Teams, Viber, LINE Works, Nostr, plus three generic connectors (Webhook / Twilio SMS / IMAP-SMTP Email).
- **Path-based URLs** for Wiki (`/wiki/index`, `/wiki/pages/<slug>`), Files (`/files/<path>`), History (`/history`), and Chat (`/chat/:id`, lands on the latest session when naked). Back/forward/bookmark work everywhere; the browser history IS the navigation source of truth.
- **Internationalization goes live** — vue-i18n skeleton (#559), auto-detect locale from the browser, and **8 locales** ship out of the box (en, ja, zh, ko, es, pt-BR, fr, de). Dozens of components had hard-coded strings extracted into the locale files across 17 extraction batches.
- **Agent respects the user's timezone** — requests now carry the browser's IANA zone, and the system prompt tells the model to interpret bare times ("15:00") in that zone without re-asking every turn. Scheduler UI mirrors the change — daily triggers render in the viewer's local zone (`Daily 05:00 GMT+9`) instead of UTC.
- **Favicon rebuilt around the mascot** (#470 follow-up): mascot logo in the rounded frame, background color carries state (idle / running / done / error), red dot surfaces **any** unread session, not just the active one.
- **Dev-server port fallback** — `yarn dev` no longer crashes when 3001 is already in use; the walk-forward logic from `npx mulmoclaude` now lives in a shared `server/utils/port.mjs` and drives both entry points.

### Added

- **Bridges** (13 new; all new packages, `v0.1.0` each):
  - `@mulmobridge/mastodon` — subscribes to the user notification stream (WebSocket), handles DMs and optionally public mentions, inherits visibility on reply, forwards image attachments, chained thread replies for long output, proactive direct-visibility push mentions the recipient.
  - `@mulmobridge/bluesky` — polls `chat.bsky.convo.getLog` via the atproto-proxy header, forwards DMs, auto-refreshes the session JWT on 401, cursor-at-startup for missed DMs.
  - `@mulmobridge/chatwork` — Japanese business chat, polls unread messages per room via REST, strips Chatwork markup.
  - `@mulmobridge/xmpp` — XMPP / Jabber over TLS with JID + password.
  - `@mulmobridge/rocketchat` — personal-access-token auth, paginated `im.list` + `im.history`, seeds cursor to `now - pollInterval` on first discovery so the message that created the DM room isn't lost.
  - `@mulmobridge/signal` — talks to a local [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) daemon, groups routed to `group.<id>` chatIds (not mixed with DMs), E.164 source validation, module-scoped exponential backoff on reconnect.
  - `@mulmobridge/teams` — Microsoft Teams via Bot Framework (`botbuilder` SDK). Conversation-reference cache for push, AAD object-id allowlist. Requires a public URL.
  - `@mulmobridge/webhook` — generic HTTP bridge; POST JSON, get the AI reply in the response body. Optional `x-webhook-secret`.
  - `@mulmobridge/twilio-sms` — Twilio Programmable Messaging, `X-Twilio-Signature` HMAC-SHA1 verification, number-based allowlist.
  - `@mulmobridge/email` — IMAP poll / SMTP reply with threading preserved (`In-Reply-To` + `References`).
  - `@mulmobridge/line-works` — enterprise LINE via service-account JWT → OAuth, separate from consumer LINE.
  - `@mulmobridge/nostr` — NIP-04 encrypted DMs across multiple relays, periodic resubscribe after relay drops, last-seen cursor persisted to `~/.mulmoclaude/nostr-cursor.json` so restarts don't lose messages, hex / nsec key input with pubkey allowlist.
  - `@mulmobridge/viber` — Viber Public Account bot, `X-Viber-Content-Signature` HMAC-SHA256.
- **Wiki**: per-page chat composer (`pages/<slug>` leaf view) that spawns a new session scoped to the page; back-arrow now walks browser history instead of forcing index; slug path-traversal rejection; empty-slug guard; exact-title lookup for non-ASCII pages.
- **Files view**: path-based URL (`/files/<path>`) with query-form back-compat, internal workspace link router routes markdown-embedded links to the right view.
- **History view**: promoted to `/history`, "unread only" filter pill, session-origin filter (human / scheduler / skill / bridge).
- **Chat**: naked `/chat` lands on the most recent session; MulmoClaude logo/title click resumes the latest session; `/chat/:id` push via `router.push` (no replace).
- **i18n**: vue-i18n skeleton, auto-detect locale from `navigator.language` when `VITE_LOCALE` unset, 7 new locale files (ja, zh, ko, es, pt-BR, fr, de — en remains the source of truth), vue-i18n lint wiring via `batch/i18n-dump.ts`.
- **UI**: MulmoClaude mascot-based favicon with state-colored background + red unread dot, scheduler frequency hints, ChatInput attach-file discoverability, source labels on preview cards.
- **Server**: session-origin tag on every session, chat-index + journal force-run env flags, reference directory mounts into Docker sandbox.
- **Canvas**: PNG file as source of truth so drawings survive reload; POST `/api/canvas` + PUT `/api/images/:filename` endpoints with unit tests.
- **Prompt**: compact plugin bullets, per-section size monitoring with threshold warning, summary-only inlining for large help files.
- **Tests**: E2E right-sidebar hidden on plugin views, `/files/<path>` character coverage, workspace link routing unit + E2E, ChatInput attach discoverability, internal-link-navigation assertion for path-based Files, regression tests for session behavior fixes.

### Changed

- **`@mulmobridge/slack`** (v0.2.0 → **v0.3.0**): `SLACK_SESSION_GRANULARITY=thread` auto-creates a Slack thread on the first bot reply to a top-level channel post; unrelated top-level messages now get one thread per topic. `channel` (default) and `auto` unchanged; DMs unaffected (#661 / closes #658).
- **`@mulmobridge/client`** (v0.1.1 → **v0.1.2**): exports `chunkText` from `./text`; required by every new bridge.
- **`@mulmobridge/mock-server`** (v0.1.0 → **v0.1.1**): internal refactor + README catch-up.
- **`@mulmobridge/relay`** (v0.1.0 → **v0.2.0**): four new platform plugins — WhatsApp, Messenger, Google Chat, Microsoft Teams — plus Durable Object hibernation recovery and subpath exports.
- Dev server port resolution: shared `server/utils/port.mjs` drives both `yarn dev` and the `npx mulmoclaude` launcher; explicit `PORT=3099` exits on conflict, default walks forward through 20 slots.
- Scheduler UI: daily triggers render in viewer's local timezone (e.g. Tokyo sees `Daily 05:00 GMT+9` instead of `Daily 20:00 UTC`).
- Agent prompt: new `## Time & Timezone` section instructs the model to default bare time expressions to the user's browser timezone and only clarify for explicit cross-zone mentions. "Today's date" is now computed in that zone.
- Wiki tabs (Index / Log / Lint) styled to match PluginLauncher; PDF download button aligned with TextResponse view; index rows condensed to single line.
- Bridges moved from `packages/<name>/` into `packages/bridges/<name>/` subdirectory.
- CLAUDE.md: i18n rule — all 8 locales must move in lockstep; `id-length` lint promoted to `error`.
- ChatInput: focus expansion dropped, padding tightened, buttons equalized.
- Tool-results card timestamps overlaid on top border instead of inline.
- Express request-id header normalization (CRLF stripped before multi-paragraph plugin check).

### Fixed

- **Wiki**: back arrow walks browser history instead of resetting to index (#wiki-nav); same-origin markdown links no longer trigger full page reloads; relative links in text-response don't navigate the SPA; cross-route query bleed; redundant mount fetch on `/wiki` cancelled; `navError` hoisted above the immediate URL watcher; originating page retained in history when starting a chat.
- **Session**: role switch from a non-chat page no longer creates a phantom chat session; sidebar preview links don't spawn new sessions; re-selecting the active session from a non-chat page navigates correctly; fall back to a new session when top-session resume fails; URL session id read directly to avoid watcher timing race.
- **Right sidebar**: hidden along with its toggle on non-chat views (#652).
- **Mastodon**: image-only DMs no longer dropped; chunked replies chain into one readable thread; fail loudly on a create-status response missing `id` (previously left stale `prevId` chaining onto the wrong parent).
- **Rocket.Chat**: `im.history` / `im.list` pagination (previously silently trimmed past 50 / 100 entries); cursor rewind on first DM discovery.
- **Signal**: E.164 source check (UUID-only senders would 400 on reply); `backoffMs` hoisted to module scope so reconnect actually backs off; `dataMessage.groupV2.id` / `groupInfo.groupId` routing so group chats don't collapse into the sender's DM.
- **Nostr**: auto-resubscribe every 5 min to survive relay WebSocket drops; last-seen cursor persisted so a >60 s restart doesn't lose DMs.
- **Bluesky**: cursor-at-startup so DMs delivered while the bridge was down still flow in on first poll.
- **Teams (relay)**: webhook auth hardened against SSRF and impersonation — `serviceurl` claim cross-check, `channelId === "msteams"` check, JWK endorsement check for MultiTenant, fail-closed allowlist when `aadObjectId` missing.
- **Scheduler / prompt**: plugin-prompt paragraph detection normalizes CRLF.
- **i18n**: pluginWiki schema drift across pt-BR / fr / de / es / ko / zh fixed in multiple rounds; literal `@` in stdio argsPlaceholder escaped (the Intl linked-message compiler was turning `@modelcontextprotocol/...` into a runtime error); silence vue-i18n HTML warning; missing chatPlaceholder / chatSend / pdf keys aligned across all locales.
- **E2E**: IME Enter test deflaked by collapsing the `compositionstart → compositionend → keydown` dispatches into a single `page.evaluate()` (per-hop latency was blowing past the 30 ms race window on CI webkit).
- **Slack**: session-granularity env invalidation now rejects invalid values up front; id-length lint clean-up across the package.
- **Settings / MCP**: stdio form rendering regression (vue-i18n link-compile error).
- **Roles**: role switch on non-chat pages no longer creates a session.
- **Build**: i18n cache location and `dumpi18n` wired into lint so the rule can see every locale.

### Security

- **`@mulmobridge/relay`**: Teams webhook auth — reject bodies whose `serviceUrl` doesn't match the JWT's `serviceurl` claim (SSRF prevention), enforce `channelId === "msteams"`, require `msteams` in JWK `endorsements` for MultiTenant keys, fail-closed allowlist.
- **`@mulmobridge/nostr`**: Tight IANA regex + `Intl.DateTimeFormat` round-trip validation on any timezone string before it lands in the system prompt, so a hostile client can't inject newlines or instructions via a crafted payload.
- **`@mulmobridge/signal`**: E.164 source validation — the `/v2/send` API requires a phone number, and a UUID-only sender would quietly 400; now we drop instead.
- **Agent prompt**: IANA timezone string sanitisation before it reaches the system prompt.

### Packages published during this cycle

- `mulmoclaude@0.4.0` (this release)
- `@mulmobridge/slack@0.3.0`
- `@mulmobridge/slack@0.2.0`
- `@mulmobridge/client@0.1.2`
- `@mulmobridge/mock-server@0.1.1`
- `@mulmobridge/relay@0.2.0`
- `@mulmobridge/mastodon@0.1.0`
- `@mulmobridge/bluesky@0.1.0`
- `@mulmobridge/chatwork@0.1.0`
- `@mulmobridge/xmpp@0.1.0`
- `@mulmobridge/rocketchat@0.1.0`
- `@mulmobridge/signal@0.1.0`
- `@mulmobridge/teams@0.1.0`
- `@mulmobridge/webhook@0.1.0`
- `@mulmobridge/twilio-sms@0.1.0`
- `@mulmobridge/email@0.1.0`
- `@mulmobridge/line-works@0.1.0`
- `@mulmobridge/nostr@0.1.0`
- `@mulmobridge/viber@0.1.0`

---

## [0.3.0] - 2026-04-22

### Highlights

- **`npx mulmoclaude` one-command launch (#533, #535)** — self-contained npm package that ships server TypeScript + Vite client; runs via `tsx`, opens the browser, auto-falls back to the next free port if 3001 is busy. Prints a ready banner once the HTTP endpoint actually responds.
- **MulmoBridge Relay (#456)** — Cloudflare Workers + Durable Object webhook proxy; server-side WebSocket client with hibernation recovery. `/setup-relay` skill for interactive deploy.
- **Bridge session switching (#489)** — `/sessions`, `/switch`, and `/history` commands from inside a bridge. Session list scales to 200 with pagination.
- **Session origin tracking (#486)** — sessions tagged `human` / `scheduler` / `skill` / `bridge`; origin icons + filter UI in the history sidebar.
- **Scheduler Phase 3+** — task dependencies (`dependsOn` for ordered execution, #465 Phase 3), system task schedule overrides via config file (#493), live-update API for overrides.
- **Source auto-discovery (#469)** — arXiv pipeline keyed off user interests; news notification + concierge prompt (#466).

### Added

- `npx mulmoclaude` launcher: port fallback, ready-banner probe, graceful shutdown, `--port` validation
- `/publish-mulmoclaude` skill: dep audit + workspace drift check + tarball test + cascade publish flow
- `/setup-relay` skill: interactive Cloudflare Workers deploy + MulmoClaude connection
- `/setup-wizard` skill (#474): conversational automation setup via manageScheduler / manageSkills / manageSource
- `@mulmobridge/relay` package: Workers webhook proxy with platform plugin architecture (LINE / Telegram)
- Bridge commands: `/sessions`, `/switch`, `/history`, bridge session pagination
- Session origin field + isSessionOrigin guard; origin icons + history filter UI
- Dynamic favicon reflecting agent state (#470)
- MulmoClaude logo in top-left header
- Canvas entry timestamps (time-only for today, date+time otherwise)
- File tree Name/Recent sort toggle
- Browse reference directories in file explorer (#472)
- User-configurable read-only reference directories (#455)
- manageSource tool in General + Office roles
- Background generation for MulmoScript image / audio / movie
- Create + rename custom roles directly from the manageRoles view
- `presentDocument` requires sanitized filenamePrefix
- `/history` command; session list limit raised to 200

### Changed

- App.vue split into 10+ composables (`useChatScroll`, `useSessionSync`, `useSessionDerived`, `useMergedSessions`, `useFaviconState`, `useViewLayout`, `useDebugBeat`, `useFileTree`, `useFileSelection`, `useMarkdownMode`, `useContentDisplay`, `useMarkdownLinkHandler`)
- 50+ inline type checks migrated to shared guards in `src/utils/types.ts` (#504)
- FilesView extracted into `FileTreePane` + `FileContentHeader` + `FileContentRenderer` (#507)
- id-length lint enabled as warn repo-wide; short identifiers renamed across src / server / packages
- Defer new session tab creation until first message (#533 et al.)
- `mulmoclaude` npm package layout: ships `server/` TS + `client/` dist + `src/` shared; `prepublishOnly` hook runs `prepare-dist.js`
- CI: Windows runner pinned to `windows-2022`, node_modules caching enabled, job-level timeouts

### Fixed

- Express 5 wildcard route (`app.get("*")` → `/{*splat}`) — previously crashed only in NODE_ENV=production
- Session-store: gate storeless publish to generation events only; type-guard generation payloads; await persistHasUnread in storeless drain
- StackView auto-scroll during assistant text streaming
- Role selector reverting to prior session's role on tab switch
- manageRoles rename now deletes the built-in-id override file
- manageRoles hardened against two hostile payload shapes
- Relay client: survive Durable Object hibernation via `getWebSockets()`; response queue + URL builder hardening; try/catch around dispatch
- Generation map key collision fix (delimiter hardening)
- Merge sessions: OR `live.isRunning` into merged summary so active bridge sessions surface correctly

### Packages published during this cycle

- `mulmoclaude@0.3.0` (aligned to app version — initial npm publish with port fallback, ready banner, tsx runtime)
- `@mulmobridge/protocol@0.1.3` (adds `GENERATION_KINDS` export chain)
- `@mulmobridge/chat-service@0.1.1` (catches up with protocol 0.1.3)
- `@mulmobridge/relay@0.1.0` (new)

---

## [0.2.0] - 2026-04-20

### Highlights

- **Unified Scheduler (#357)** — persistence, catch-up after downtime, skill scheduling via SKILL.md frontmatter, user-created tasks with CRUD API + MCP tool + Tasks UI
- **Notification Center (#144)** — bell icon with unread badge, dropdown panel, agent completion triggers, click-to-navigate
- **12 Messaging Bridges** — Slack, Discord, LINE, WhatsApp, Matrix, IRC, Mattermost, Zulip, Messenger, Google Chat (LINE verified)
- **User-Defined Workspace Directories (#239)** — custom data/ and artifacts/ subdirectories via Settings UI
- **Magic Number Elimination** — all time literals and scheduler string literals replaced with named constants

### Added

- Scheduler Phase 1: `@receptron/task-scheduler` pure library with catch-up algorithm + execution logs
- Scheduler Phase 2: `schedule:` frontmatter in SKILL.md for automatic skill execution
- Scheduler Phase 3: user task CRUD API (`POST/PUT/DELETE /api/scheduler/tasks`), MCP tool (`createTask/listTasks/deleteTask/runTask`), Tasks tab UI
- Notification center: `NotificationBell.vue` + `NotificationPayload` type + `publishNotification()` server API
- Agent completion → notification trigger (P0)
- User-defined workspace directories: `config/workspace-dirs.json` + Settings "Directories" tab
- `CANVAS_VIEW` constants for view mode literals
- `NOTIFICATION_KINDS` / `NOTIFICATION_ACTION_TYPES` / `NOTIFICATION_VIEWS` / `NOTIFICATION_PRIORITIES` constants
- `SCHEDULER_ACTIONS` constants for MCP tool actions
- Time constants: `SUBPROCESS_PROBE_TIMEOUT_MS`, `SUBPROCESS_WORK_TIMEOUT_MS`, `CLI_SUBPROCESS_TIMEOUT_MS`
- `CanvasViewMode` extended with `todos` / `scheduler` for URL-driven plugin access (#418)
- `@mulmobridge/mock-server` for bridge integration testing

### Changed

- Minimum Node.js version: 18 → 20 (24 recommended)
- All time literals (`1000`, `60000`, `3600000`) replaced with `server/utils/time.ts` constants across 13 files
- All scheduler string literals (`"interval"`, `"daily"`, `"success"`, etc.) replaced with `@receptron/task-scheduler` constants
- `WORKSPACE_FILES` reunified to shared `src/config/workspacePaths.ts`
- Date/time formatting helpers consolidated into `src/utils/format/date.ts`

### Fixed

- Tool Call History not updating after page reload (#432)
- `?path=` URL param cleanup when file is closed or view changes (#434)
- MCP server crash in Docker — missing require export + packages mount (#429)
- Attachment parsing: count + size limits added (#425)
- Security: `.session-token` blocked from file API, `timingSafeEqual` for token comparison (#447)
- Broken plan links in docs (plans moved to plans/done/)
- LINE bridge status updated to "Verified"

### Security

- Token handling hardened: `timingSafeEqual`, file API blocklist
- Webhook bridges: 1MB body limit, per-IP rate limiting, PII redaction
- Google Chat: JWT/OIDC verification
- Workspace custom dirs: path traversal prevention, reserved dir protection, prompt injection defense

---

## [0.1.2] - 2026-04-19 (package release)

> **Note**: This was a package-only release for `@mulmobridge/*` npm packages. The MulmoClaude app version was v0.1.1 at this time.

### Added

- `@mulmobridge/slack` (v0.1.0) — Slack bot bridge (Socket Mode, no public URL needed)
- `@mulmobridge/discord` (v0.1.0) — Discord bot bridge (Partials.Channel for DMs)
- `@mulmobridge/line` (v0.1.0) — LINE bot bridge (webhook + HMAC signature)
- `@mulmobridge/whatsapp` (v0.1.0) — WhatsApp Cloud API bridge (webhook + HMAC)
- `@mulmobridge/matrix` (v0.1.0) — Matrix bridge (matrix-js-sdk, end-to-end encryption ready)
- `@mulmobridge/irc` (v0.1.0) — IRC bridge (irc-framework, TLS, channel + DM)
- `@mulmobridge/mattermost` (v0.1.0) — Mattermost bridge (WebSocket + REST, auto-reconnect)
- `@mulmobridge/zulip` (v0.1.0) — Zulip bridge (long-polling events API)
- `@mulmobridge/messenger` (v0.1.0) — Facebook Messenger bridge (webhook + x-hub-signature-256 HMAC)
- `@mulmobridge/google-chat` (v0.1.0) — Google Chat bridge (webhook + JWT/OIDC verification)
- `@mulmobridge/mock-server` (v0.1.0) — Lightweight mock server for bridge integration testing

### Fixed

- Google Chat webhook now verifies JWT tokens against Google's JWKS endpoint (iss/aud/exp claims)
- Webhook bridges (Messenger, Google Chat) enforce 1MB body size limit and per-IP rate limiting
- PII redaction in bridge logs — sender IDs are partially masked

---

## [0.1.1] - 2026-04-18

### Highlights

- **Monorepo & npm packages (#360)** — Extracted shared code into publishable `@mulmobridge/*` packages under yarn workspaces:
  - `@mulmobridge/protocol` (v0.1.1) — shared types and constants
  - `@mulmobridge/client` (v0.1.0) — socket.io client library, bearer token reader, MIME utilities
  - `@mulmobridge/chat-service` (v0.1.0) — server-side chat service
  - `@mulmobridge/cli` (v0.1.1) — interactive terminal bridge (`npx @mulmobridge/cli@latest`)
  - `@mulmobridge/telegram` (v0.1.1) — Telegram bot bridge (`npx @mulmobridge/telegram@latest`)
- **Real-time text streaming (#392, #393)** — Claude responses stream token-by-token in the Web UI
- **Workspace restructure (#284, #314)** — layout reorganized into 4 semantic buckets: `config/`, `conversations/`, `data/`, `artifacts/`
- **File I/O consolidation (#366)** — all workspace file operations centralized into domain-specific I/O modules under `server/utils/files/`
- **Telegram bridge (#321, #322, #355)** — full Telegram bot with photo support, allowlist, message chunking, server push

### Added

- Sandbox enhancements: opt-in host credential forwarding (#327), macOS SSH agent support (#347), gh CLI with auth (#353)
- Image & PDF in chat: paste/drag-and-drop image (#379), PDF attachment support (#385)
- Auto-expand chat input (#387), unread session highlights (#343), launcher active highlight + badge tooltips (#362)
- Skills system: render SKILL.md as formatted markdown (#339), direct editing in UI (#342), update via chat (#344)
- Incremental session fetch with server cursor (#338)
- Notification scaffold: time-delayed push fan-out (#331)
- GitHub workspace: standardize github/ directory + .gitignore filter (#358, #365)

### Changed

- Server reorganized into 6 topical dirs (#328)
- Extracted `useImeAwareEnter` composable (#378)
- Attachment protocol: `imageDataUrl` replaced with `Attachment[]` (#383)
- Pre-commit hook + `/precommit` review skill (#388, #389, #391, #398)
- ESLint flat config scoped correctly for all packages

### Fixed

- Bearer token wired to MCP subprocess (#325) and frontend plugin launcher (#326)
- Agent resume failover on stored session ID rejection (#324)
- Wiki path references updated for post-#284 layout (#354, #359)
- PresentDocument images broken by bearer auth + path migration (#372)
- Re-fetch transcript on session_finished to recover missed events (#351)
- Post-#284 workspace paths in markdown + spreadsheet plugins (#348)
- Lock popup overflows left edge of viewport (#356)

### Breaking Changes

- Workspace layout changed (#284) — run migration script before upgrading
- `bridges/` directory removed — use `@mulmobridge/*` packages or `yarn cli` / `yarn telegram`
- `imageDataUrl` field removed from bridge protocol — use `attachments: Attachment[]`

### Test Coverage

- 2400+ unit tests, session-store, image-store, plugin paths, workspace shape, chat-index, markdown-store (#367, #370, #373, #375)

---

## [0.1.0] - 2026-04-14

### Highlights

First tagged release. GUI-chat with Claude Code — chat with Claude and get back not just text but interactive visual tools, persistent knowledge, and a growing library of skills.

### Added

- 9 specialised roles — General / Office / Guide & Planner / Artist / Game / Tutor / Storyteller / Musician / Role Manager
- Personal wiki long-term memory with `[[wiki link]]` cross-references
- Skills (phase 0) — list and invoke `SKILL.md` from the canvas
- Charts — Apache ECharts plugin (bar / line / candlestick / sankey / network / heatmap, PNG export)
- Documents / Spreadsheets / Forms / Mind maps / 3D / Music / HTML plugins
- Image generation — Gemini 3.1 Flash Image
- MulmoScript storyboards — multi-beat presentations with audio + image + movie
- Docker sandbox by default (`--cap-drop ALL`, non-root)
- Web settings UI — manage allowed tools and MCP servers from the browser
- X (Twitter) tools — `readXPost` + `searchX`

### Architecture

- vue-router with history mode for deep-linkable session URLs
- Server-side session state with pub/sub channel (multi-tab sync)
- Per-session pluggable MCP server (role-scoped tool list)
- Tool trace persistence in `chat/<id>.jsonl`
- Wiki backlinks — pages auto-link to originating chat
- Auto-journal — daily summaries under `summaries/`
- Structured server logger with console + rotating file sinks

### Quality

- 1300+ unit tests (node:test) + 140+ E2E tests (Playwright)
- ESLint with cognitive-complexity gate (>15 = error)
- Cross-platform CI (Ubuntu / macOS / Windows x Node 22 / 24)
- TypeScript strict mode end-to-end

### Security

- Localhost-only bind (`127.0.0.1`)
- CSRF guard on state-changing routes
- Path-traversal-safe slug validation
- Sandbox isolation for Claude CLI (Docker mode)

---

[0.1.2]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.2
[0.1.1]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.1
[0.1.0]: https://github.com/receptron/mulmoclaude/releases/tag/v0.1.0
