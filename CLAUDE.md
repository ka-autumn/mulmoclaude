# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer. Shared code is published as `@mulmobridge/*` npm packages under `packages/`.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`
- **Unit tests**: `yarn test` (node:test, server handlers + utils)
- **E2E tests**: `yarn test:e2e` (Playwright, browser UI tests — no backend needed)

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, `yarn typecheck`, and `yarn build` before considering the task done.

**IMPORTANT**: Always write error handling for all `fetch` calls. Handle both network errors (try/catch) and HTTP errors (`!response.ok`).

## Key Rules (always apply)

### Shared utilities — check before reinventing

Before writing a new helper, scan [`docs/shared-utils.md`](docs/shared-utils.md). If a similar helper exists, use it. When you add a new shared helper (cross-cutting formatter, error normaliser, path joiner, etc.) append a 1-line entry to that catalog **in the same PR**.

Skipping this step is how `truncate()` ended up with 6 implementations and `err instanceof Error ? err.message : String(err)` got inlined 30+ times despite `errorMessage()` existing in `server/utils/errors.ts`. The catalog is the prevention mechanism (#1304).

### Constants — no magic literals

- **Time**: NEVER use raw numbers (`1000`, `60000`, `3600000`). Import from `server/utils/time.ts`
- **Strings**: scheduler types, event types, API routes, tool names — use existing `as const` objects
- **Paths**: use `WORKSPACE_PATHS` / `WORKSPACE_DIRS` / `WORKSPACE_FILES` — never hardcode

### File I/O — domain modules only

NEVER use raw `fs.readFile` / `fs.writeFile` in route handlers. Use `server/utils/files/<domain>-io.ts`. All writes go through `writeFileAtomic`.

### Network I/O — centralized helpers

- **Frontend → Server**: use `src/utils/api.ts` (`apiGet`, `apiPost`, etc.) — auto-attaches bearer token
- **MCP → Server**: use `postJson()` with `AUTH_HEADER`
- **Server → External**: use `AbortController` for timeouts, check `response.ok`

### Cross-platform

- Build paths with `node:path` (`path.join`, `path.resolve`) — NEVER concatenate `/`
- Atomic writes: tmp file alongside destination, not in `os.tmpdir()`
- Package exports: include `"require"` and `"default"` conditions (Docker CJS mode)

### Code style

- Functions under 20 lines; split into smaller functions if needed
- `const` over `let`; never `var`
- Extract pure logic into exported helpers for testability
- Honour `sonarjs/cognitive-complexity` threshold (error at >15)
- No re-export barrel files without specific reason

### Lint warnings — drive them toward zero

`yarn lint` runs at error-strict for most rules. A handful are kept at `warn` because graduating them to error would force a noisy cleanup and risk regressions. Treat warnings as a backlog, not a baseline.

- **Reduce them.** When you touch a file, fix any warnings in it that are mechanically safe (`prefer-destructuring` auto-fix, missing `return undefined`, etc.). Don't leave a warning behind in code you just edited.
- **Per-line `eslint-disable-next-line` is intentional.** When you see one with a `--` rationale (e.g. `vue/no-v-html`, `no-unmodified-loop-condition`, `no-script-url` test fixtures, `no-new` URL/Intl probes, `no-loop-func` Mocha closures), it has been audited. **Never remove these comments during refactors** — they encode a trust decision. If the surrounding code changes shape, port the disable to the new line; don't drop it.
- **`vue/no-v-html` specifically.** Every `v-html` in this repo (NewsView, markdown/View, spreadsheet/View, textResponse/View, wiki/View) feeds from `marked.parse` or `XLSX.utils.sheet_to_html` over app-owned data — all intentional, all suppressed at the call site. If you add a new `v-html`, audit the data source and add the same comment with a one-sentence rationale; do NOT silence the rule globally.
- **For multi-line elements**, `eslint-disable-next-line` only reaches one line. Use a `<!-- eslint-disable <rule> -->` … `<!-- eslint-enable <rule> -->` pair around the element instead.

### GitHub posts

NEVER escape backticks with `\`` in `gh` commands. Use single-quoted heredoc (`<<'EOF'`).

### UI controls — standard height and spacing

Top-bar and panel-header controls share one sizing language. Use these exact classes when adding or editing a control that sits in a chrome row (anything outside the canvas itself):

- **Icon-only button** (bell, settings, lock, toggle, `+`): `h-8 w-8 flex items-center justify-center rounded` — 32px square.
- **Icon + label pill** (launcher buttons, role selector, tabs): `h-8 px-2.5 flex items-center gap-1` — 32px tall with 10px horizontal padding and 4px icon-to-label gap.
- **Row container** (outer wrapper holding multiple control groups): `flex items-center gap-2 px-3 py-2` — 8px between groups, 12/8 outer padding.
- **Icon-cluster group** (a run of adjacent icon-only buttons like lock/bell/settings): `flex gap-0.5` — 2px gap, tight but still visibly separated.

Do NOT introduce new heights (`h-7`, `h-9`, `py-1.5`, etc.) or new gap values for chrome controls. The logo in `SidebarHeader` is the one sanctioned exception — it escapes row padding via negative margins (`-my-3.5`) because it's a brand mark, not a control.

### UI references — anchor to testids and components

Big-picture ASCII layouts of the major surfaces (top chrome, NotificationBell, /chat, /calendar, /automations, /wiki, /sources, /todos, /files) live at [`docs/ui-cheatsheet.md`](docs/ui-cheatsheet.md). Use it for:

- **Naming a UI region in chat / PR / issue text**: prefer `[notification-badge]` / `<CalendarView>` / `(:wiki)` over "the bell" / "the calendar widget" / "the wiki page" — names are greppable, prose is not.
- **Onboarding context**: when proposing UI changes, point at the matching block to disambiguate which component / route is in scope.

When you rename a `data-testid`, restructure a layout, or add a new top-level surface, **update the matching ASCII block in `docs/ui-cheatsheet.md` in the same PR** — same discipline as updating tests when changing API. Out-of-date layout art is worse than no art; if you can't update it cleanly, delete the stale block instead of leaving it.

### i18n — all 8 locales in lockstep

Supported UI locales live under `src/lang/`: `en.ts`, `ja.ts`, `zh.ts`, `ko.ts`, `es.ts`, `pt-BR.ts`, `fr.ts`, `de.ts`. `src/lang/en.ts` is the schema source of truth; `typeof enMessages` is threaded through `createI18n` in `src/lib/vue-i18n.ts`, so `vue-tsc` treats every missing or extra key as a type error.

When adding, renaming, or removing any i18n key:

- MUST update **all 8** locale files in the same PR — NEVER land a change that only touches `en.ts` and defers the other locales "for later" (this breaks CI and every downstream branch)
- MUST keep the key order consistent across locales so diffs stay readable
- MUST translate the new string properly in each locale (do not just copy the English value) — placeholders like `{count}` / `{error}` / `{sizeMB}` stay verbatim
- Product / brand / role names stay in English (Claude, MulmoClaude, Docker, General, Office, etc.)
- When registering a new locale, update `SUPPORTED_LOCALES`, the `Locale` union, and the `messages` map in `src/lib/vue-i18n.ts` together
- When introducing a new UI string, extract it to `src/lang/en.ts` first (do NOT hardcode in templates) — `$t()` / `useI18n().t` is the only acceptable source

## Releases

See `/release-app` skill for app releases. See `/publish` skill for npm packages.

- App tags: `vX.Y.Z` (with `v` prefix)
- Package tags: `@scope/name@X.Y.Z` (no `v` prefix)
- MUST update `docs/CHANGELOG.md` before tagging
- Package releases: `--latest=false` on `gh release create`

## Build orchestration (`yarn build:packages`)

The script runs **four tiers in order**:

1. `@mulmobridge/protocol` + `@receptron/task-scheduler` — no internal deps, run in parallel
2. `@mulmobridge/{client, chat-service, mock-server}` — depend on tier 1
3. **All bridges** under `packages/bridges/*` whose name starts with `@mulmobridge/` and has a `build` script
4. **All runtime plugins** under `packages/plugins/*` whose name starts with `@mulmoclaude/` AND ends with `-plugin` and has a `build` script

Tiers 3 and 4 are auto-discovered by `scripts/build-workspaces.mjs`. Tiers 1 and 2 stay explicit in `package.json` because their dep-graph order can't be globbed.

**Adding a new bridge or runtime plugin: just create the workspace directory — no `package.json` edit needed.** Selection rules are strict:

- **Bridge**: lives at `packages/bridges/<name>/`, name `@mulmobridge/<name>`, has `scripts.build`
- **Runtime plugin**: lives at `packages/plugins/<name>-plugin/`, name `@mulmoclaude/<name>-plugin`, has `scripts.build`

If a workspace doesn't fit either pattern — e.g. a `@receptron/*` package, or a non-bridge `@mulmobridge/*` like `mock-server` — **MUST add it to the explicit tier-1 / tier-2 enumeration in `package.json`**; auto-discovery won't pick it up. Same goes for any new top-level core package that other workspaces depend on.

NEVER name a non-runtime-plugin package `@mulmoclaude/foo-plugin` (e.g. a helper library); the build driver will try to run its `build` script in tier 4, after every consumer has already been built. Pick a different name (`@mulmoclaude/foo`, `@mulmoclaude/foo-helpers`, …) or move it to tier 2.

The yarn 4 smoke workflow (`yarn4_smoke`) verifies the chain still works under yarn 4. Both tiers' driver only spawns `yarn workspace <name> run build` — identical syntax in yarn 1 and 4 — so portability is preserved.

## Package dependency direction (always apply)

The monorepo has three package families. **Dependencies flow in ONE direction only** — violating this creates uphill imports, parallel-build races, and the tier-ordering dance that #1789 / #1795 had to dismantle.

```
                       ▲ depends on
                       │
        host           │   (server/, src/, packages/mulmoclaude)
        ──────         │
        plugins        │   (packages/plugins/*-plugin)
        ──────         │
   shared core         │   (@mulmoclaude/core — formerly the 7 packages/services/*)
                       │
        no deps        │   (leaf libs: @mulmobridge/protocol, @receptron/task-scheduler, etc.)
                       │
```

**Rules:**

- A **plugin** (`packages/plugins/<name>-plugin`) MAY import `@mulmoclaude/core/<subpath>` (or any leaf lib). It MUST NOT import another `*-plugin`. The runtime-plugin model is "1 plugin = 1 npm package, dispatched via `/api/plugins/runtime/:pkg`, gated by roles" — merging would break that model. Cross-plugin sharing goes through core.
- **Shared core** (`@mulmoclaude/core` — provides `./collection`, `./collection/server`, `./collection-watchers`, `./skill-bridge`, `./notifier`, `./scheduler`, `./whisper`, `./whisper/client`, `./workspace-setup`, `./workspace-setup/slug`, `./file-change-publisher`) MUST NOT import any `*-plugin`. If a plugin owns code that core / another plugin needs, **pull it OUT of the plugin into core** (the `isSafeActionTemplatePath` / `discoverCollections` / `whenMatches` extraction that #1795 did is the canonical pattern), don't import uphill.
- **Browser-safe surfaces of core** stay on dedicated subpaths (`@mulmoclaude/core/whisper/client`, `@mulmoclaude/core/workspace-setup/slug`). Everything else under `@mulmoclaude/core/*` is server-only — importing a server-only subpath from a Vue component fails the Vite browser-bundle check.
- **Host** (`server/`, `src/`, the `packages/mulmoclaude` launcher) MAY import anything below it. Host code stays generic — provider-specific routes / handlers / config belong in the relevant plugin, not in `server/`.

When the build complains "Cannot find module `@mulmoclaude/foo`" cold (after `yarn install` + `yarn build:packages`), the cause is almost always an uphill or peer import that the build-order tier system can't resolve. Don't patch with a new tier or a `--first=foo` flag — surface the import and move the code instead. Plan record: [`plans/done/refactor-shared-core.md`](plans/done/refactor-shared-core.md).

## Architecture (summary)

Full reference: [`docs/developer.md`](docs/developer.md)

### Key structure

```text
server/          ← agent/, api/, workspace/, events/, system/, utils/
packages/        ← @mulmobridge/* npm packages (yarn workspaces)
src/             ← Vue 3 frontend (components/, composables/, plugins/, config/)
test/            ← mirrors source layout 1:1
e2e/             ← Playwright E2E tests + fixtures
plans/           ← feature plans (move to plans/done/ when PR lands)
```

### Workspace layout (`~/mulmoclaude/`)

```text
config/          ← settings.json, mcp.json, roles/, helps/
conversations/   ← chat/, memory.md, summaries/
data/            ← wiki/, todos/, calendar/, scheduler/, sources/
artifacts/       ← charts/, documents/, html/, images/, spreadsheets/
```

### Key files

| File | Purpose |
|---|---|
| `server/agent/index.ts` | Agent loop, MCP server creation |
| `server/agent/mcp-server.ts` | stdio JSON-RPC MCP bridge |
| `server/api/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/workspace/paths.ts` | Workspace path constants |
| `server/utils/time.ts` | Time constants + timeout presets |
| `src/config/apiRoutes.ts` | API endpoint path constants |
| `src/config/roles.ts` | Role definitions |
| `src/App.vue` | Main UI |

## Plugin Development

Full reference: [`docs/developer.md`](docs/developer.md#plugin-development) (built-in) / [`docs/plugin-runtime.md`](docs/plugin-runtime.md) (runtime / npm-package plugins)

**Plugin-vs-host boundary (always apply).** Per-feature integrations (Spotify / GitHub / Apple Music / weather / bookmarks / …) live in `packages/plugins/<name>-plugin/` as **runtime plugins**. Host code (`server/`, `src/plugins/`, `src/config/`) only gets **generic infrastructure that benefits multiple plugins** — never provider-specific code. Examples of generic host infra: the `/api/plugins/runtime/:pkg/dispatch` route, the asset-mount route, the `/api/plugins/runtime/:pkg/oauth/callback` route (#1162). A new "Spotify route" or "GitHub route" in `server/api/routes/` is a smell — re-think whether the work belongs in the plugin package and whether the host's infra needs a generic extension instead.

**Plugin owns its identity** (built-in path). Each built-in plugin declares its `toolName`, `apiRoutes`, `workspaceDirs`, and `staticChannels` in its own `src/plugins/<name>/meta.ts`. Host aggregators (`API_ROUTES`, `TOOL_NAMES`, `WORKSPACE_DIRS`, `PUBSUB_CHANNELS`) auto-merge those contributions via `defineHostAggregate` — host code holds zero plugin-specific literals.

Adding a built-in plugin touches **6 plugin-local files** and **3 host barrels**:

- `src/plugins/<name>/meta.ts` — `definePluginMeta({ toolName, apiRoutesKey?, apiRoutes?, workspaceDirs?, staticChannels? })`
- `src/plugins/<name>/definition.ts` — MCP `ToolDefinition`; derive `TOOL_NAME = META.toolName`, endpoint types from `typeof META.apiRoutes`
- `src/plugins/<name>/index.ts` — `PluginRegistration` (View / Preview wrapped via `wrapWithScope(scope, …)`, executor calls `pluginEndpoints<E>(scope)`)
- `src/plugins/<name>/View.vue` / `Preview.vue` — Vue surfaces; call `useRuntime()` from `gui-chat-protocol/vue` for the typed `endpoints` map
- `src/plugins/metas.ts` — append the META to `BUILT_IN_PLUGIN_METAS`
- `src/plugins/index.ts` — append the registration to `BUILT_IN_PLUGINS`
- `src/plugins/server.ts` — append `{ def, endpoint }` to `BUILT_IN_SERVER_BINDINGS` (skip for GUI-only plugins like wiki)
- `server/api/routes/<name>.ts` — Express route handlers (only when the plugin owns endpoints)
- `src/main.ts` — entry in the host endpoint registry passed to `installHostContext({ endpoints })`

Adding to a Role's `availablePlugins` (`src/config/roles.ts`) is separate — roles gate which plugins each chat sees, independent of plugin registration.

Standalone routes (`/todos`, `/calendar`, …) and inline file previews (`FileContentRenderer` rendering `data/todos/todos.json`) must wrap the plugin component with `<PluginScopedRoot pkg-name :endpoints>` so descendant `useRuntime()` calls resolve. The plugin registry's `wrapWithScope` already covers chat-mounted variants.

### Plugin scaffold sync (`packages/create-mulmoclaude-plugin`)

The scaffold CLI (`npx create-mulmoclaude-plugin`) embeds `package.json` + `vite.config.ts` + `tsconfig.json` + ESLint config as **string literals** in `packages/create-mulmoclaude-plugin/src/template.ts`. Newly-generated plugins inherit those literals verbatim, so they DO NOT pick up version bumps you make to the in-tree plugins.

When you bump a build-toolchain dep (`vite` / `typescript` / `vite-plugin-dts` / `@vitejs/plugin-vue` / `vue`) or change the build-config shape (e.g. dropping `rollupTypes: true` for a TS-major bump), apply the same change to `packages/create-mulmoclaude-plugin/src/template.ts` in the **same PR**:

1. Update the `PACKAGE_JSON` template's `devDependencies` caret ranges to match `packages/plugins/bookmarks-plugin/package.json` (the canonical reference).
2. If the build-config shape changed, mirror it into `VITE_CONFIG` (the multi-line string just below).
3. Run `yarn workspace create-mulmoclaude-plugin run build` to regenerate the CLI's own dist.
4. Optionally bump the CLI's own `version` and re-publish if external users will fetch via `npx`.

If you forget step 1 / 2, generated plugins ship with stale toolchains and may hit the same issue you just fixed in the in-tree plugin (e.g. empty `.d.ts` from api-extractor + TS 6).

## Centralized Constants

Full table: [`docs/developer.md`](docs/developer.md#centralized-constants)

Key ones to remember:

| What | Source of truth |
|---|---|
| API routes | `src/config/apiRoutes.ts` → `API_ROUTES` (host-fixed entries + plugin contributions auto-merged from `META.apiRoutes`) |
| Tool names | `src/config/toolNames.ts` → `TOOL_NAMES` (host-fixed entries + plugin contributions auto-merged from `META.toolName`) |
| Event types | `src/types/events.ts` → `EVENT_TYPES` |
| Workspace paths | `server/workspace/paths.ts` → `WORKSPACE_PATHS` (auto-derived from `WORKSPACE_DIRS` + `WORKSPACE_FILES`; plugin contributions merged from `META.workspaceDirs`) |
| Pub-sub channels | `src/config/pubsubChannels.ts` → `PUBSUB_CHANNELS` (host-fixed + `META.staticChannels`) |
| Time | `server/utils/time.ts` → `ONE_SECOND_MS` / `ONE_MINUTE_MS` / `ONE_HOUR_MS` |
| Scheduler | `@receptron/task-scheduler` → `SCHEDULE_TYPES` / `TASK_RESULTS` |

For the four plugin-aware aggregators above, edit the plugin's `meta.ts` rather than the host record — `defineHostAggregate` (`src/plugins/metas.ts`) merges them at module load with first-write-wins semantics; collisions surface as boot-time diagnostics on the bell.

## Testing

### E2E (Playwright)

Full reference: [`docs/developer.md`](docs/developer.md#e2e-testing-playwright)

- Use `data-testid` for element selection (name by function, not position)
- Call `mockAllApis(page)` before `page.goto()`
- Reusable interactions in `e2e/fixtures/chat.ts`

### Live E2E (`e2e-live/`)

Real-server, no-mock suite. **Read [`docs/e2e-live-testing.md`](docs/e2e-live-testing.md) before adding a new `e2e-live/tests/*.spec.ts`.** It covers:

- `e2e/` vs `e2e-live/` — which one your scenario belongs in
- Boot modes (`yarn dev` vs `npx mulmoclaude@<tarball>`)
- The `fakeEchoBackend` test seam (`MULMOCLAUDE_FAKE_AGENT=1`) — what it fakes (LLM dispatch only) vs what it doesn't (external APIs)
- When to add a pattern detector vs when to gate the test on `E2E_LIVE_NO_LLM=1`
- The CI matrix in `.github/workflows/e2e_live_no_llm.yaml`

### Manual testing

Scenarios that can't be automated: [`docs/manual-testing.md`](docs/manual-testing.md)

## Server Logging

Full reference: [`docs/logging.md`](docs/logging.md)

Use `log.{error,warn,info,debug}(prefix, msg, data?)`. Never call `console.*` directly.

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
- **E2E Testing**: Playwright (Chromium)
- **Language**: TypeScript throughout
