# Plan: Extract accounting into `@mulmoclaude/accounting-plugin`

## Motivation

The accounting (double-entry bookkeeping) feature is currently spread
across the host (`src/plugins/accounting/`, `server/accounting/`,
`server/api/routes/accounting.ts`, `server/utils/files/accounting-io.ts`,
`src/composables/useAccountingChannel.ts`, `test/accounting/*`). We want
to **reuse it in MulmoTerminal** (same driver as `@mulmoclaude/x-plugin`
and `@mulmoclaude/collection-plugin`).

**Hard constraint (from the request):** the accounting **backend must
NOT land in `@mulmoclaude/core`.** Core stays generic; accounting is a
domain. So unlike collection-plugin — which pushed its engine *into*
core — accounting keeps its backend **inside its own package** and
depends on core/leaf libs only for generic infra.

This is allowed by the dependency rules in CLAUDE.md: a plugin MAY
import `@mulmoclaude/core`/leaf libs; core MUST NOT import a plugin.

## Precedent: follow `collection-plugin`, not the core consolidation

`@mulmoclaude/collection-plugin` lives in `packages/plugins/` with a
`-plugin` name but is a **build-time import** (`/vue`), *not* a
runtime-loaded plugin. The collection feature stays "built-in" in the
host; a thin host shim imports the package. Accounting follows this
model exactly — it stays a built-in plugin; we do **not** convert it
into a role-gated runtime plugin.

`@mulmoclaude/x-plugin` proves a plugin package can ship **server-only**
code (a tool the host slots in). Accounting is the first package that is
**both** a Vue View **and** a workspace-file-backed Express backend, so
it needs both surfaces as separate subpaths.

## Current state — the 3 layers (from the import graph)

| Layer | Files | Host coupling |
|---|---|---|
| **Shared (isomorphic)** | `actions, meta, fiscalYear, countries, currencies, dates, timeSeriesEnums` (+ shared `types`) | none — plain TS, browser-safe |
| **Frontend (Vue)** | `View.vue`, `Preview.vue`, `components/*`, `api.ts`, `index.ts` | `utils/api` (apiCall), `utils/errors`, `utils/id`, `tools/types`, `scope` (wrapWithScope), `meta-types`, `composables/useAccountingChannel` |
| **Backend (Node)** | `server/accounting/*`, `routes/accounting.ts`, `utils/files/accounting-io.ts` | `system/logger`, `events/pub-sub` + `config/pubsubChannels`, `workspace/paths`, `writeFileAtomic`, `express` |

The shared layer is the enabler: both halves already import only those
isomorphic enums, so they extract without new seams.

### Host wiring points the move must preserve

- `src/config/pubsubChannels.ts` imports `bookChannel`/`BOOK_EVENT_KINDS`/`META.staticChannels` from `../plugins/accounting/meta`.
- Host aggregators iterate plugin `META` for `API_ROUTES`, `TOOL_NAMES`, `WORKSPACE_DIRS` (via `definePluginMeta`).
- `server/index.ts`: `import accountingRoutes` + `app.use(accountingRoutes)` (line ~641) and `initAccountingEventPublisher()` (line ~71).
- Built-in plugin registration (the `REGISTRATION` export in `index.ts`).
- i18n: `pluginAccounting.*` + `pluginLauncher.accounting.label` across 8 locales.
- `/accounting` route + launcher button (just shipped in #1811) — stays in host (host owns routing/chrome).

## Target package shape

One package, three subpaths. Backend stays in the package (NOT core):

```
@mulmoclaude/accounting-plugin
  ./shared   → actions, meta, fiscalYear, countries, currencies, dates,
               timeSeriesEnums, types          (isomorphic, browser-safe)
  ./vue      → View + components + Preview + api.ts + index registration
               (peers: vue, vue-i18n, gui-chat-protocol)
  ./server   → createAccountingRouter(deps) + service/journal/report/
               openingBalances/timeSeries/snapshotCache/eventPublisher/
               defaultAccounts/accountNormalize/io   (peer: express)
```

Multi-entry vite build (whisper/workspace-setup already prove the
pattern). `node:*` marked external; `./shared` entry must never
transitively import `node:fs` (browser-safety guard, same as
`whisper/client`). Package.json exports include `require` + `default`
conditions for Docker CJS mode.

## The backend DI seam (how we avoid touching core)

The backend imports host-only infra core does **not** export: `logger`,
`pub-sub`, `workspace/paths`, `writeFileAtomic`. Rather than promote
those into core, the package exports a **factory** and the host injects
its own infra at mount time (same spirit as x-plugin taking env, and the
frontend's existing `installHostContext` DI):

```ts
// @mulmoclaude/accounting-plugin/server
export interface AccountingServerDeps {
  logger: Logger;
  publish: (channel: string, payload: unknown) => void;
  booksDir: () => string;          // resolves WORKSPACE_DIRS.accountingBooks
  writeFileAtomic: (p: string, data: string) => Promise<void>;
}
export function createAccountingRouter(deps: AccountingServerDeps): Router;
export function initAccountingEventPublisher(deps: AccountingServerDeps): void;
```

Host (`server/index.ts`) builds `deps` from its own infra and mounts the
router — `accounting-io.ts` moves into the package and takes its
write/path fns from `deps` instead of importing host modules directly.

Result: the package depends only on `express` + `@mulmoclaude/accounting-plugin/shared`. No accounting code in core; no host-only imports in the package.

## Frontend adjustment

`api.ts` currently calls the host's `apiCall` directly. As a package it
must be host-agnostic: read endpoints from `useRuntime().endpoints`
(collection-plugin precedent). The View already mounts under
`PluginScopedRoot`, and `wrapWithScope`/`installHostContext` already wire
the `accounting` scope's endpoints — so the runtime/endpoint plumbing
exists; this is a call-site swap, not new infra. `errorMessage`/`makeUuid`
either move into the package or come from a leaf util.

## Staged execution (each stage independently green)

1. **Scaffold + shared.** Create `packages/plugins/accounting-plugin`
   (package.json, tsconfig, vite multi-entry). Move the 8 isomorphic
   modules to `./shared`. Repoint host imports (`pubsubChannels.ts`,
   `definition.ts`, backend) to `@mulmoclaude/accounting-plugin/shared`.
   Move `test/plugins/accounting/*` (pure-logic tests) into the package.
   ✅ gate: `yarn build` + unit tests.
2. **Frontend → `./vue`.** Move View/components/Preview/api.ts/index.ts;
   swap `apiCall` → `useRuntime().endpoints`; move `pluginAccounting.*`
   i18n + `useAccountingChannel` into the package (or a shared composable
   seam). Host `src/plugins/accounting/` shrinks to a thin shim importing
   the package; App.vue/PluginLauncher imports updated.
   ✅ gate: build + typecheck + the #1811 e2e spec + a manual View smoke.
3. **Backend → `./server`.** Move `server/accounting/*` + route +
   `accounting-io` into the package behind `createAccountingRouter(deps)`;
   host wires `deps` and mounts. Move `test/accounting/*` into the package
   (adapt to DI). ✅ gate: build + `yarn test` (accounting suite) + e2e.

## Build / tooling

- New `packages/plugins/accounting-plugin` is **auto-discovered** by
  `scripts/build-workspaces.mjs` (`--name-suffix=-plugin`) and
  `dev-build-if-needed.mjs`. No tier enumeration needed; it depends on
  `@mulmoclaude/core` only if we end up using a leaf util — otherwise it
  has no intra-package deps and builds early.
- `peerDependencies`: `express` (server), `vue`/`vue-i18n`/`gui-chat-protocol` (vue). Mirror collection-plugin's package.json.
- Bump + publish per `/publish` skill; MulmoTerminal then consumes it
  (version-skew caveat from `project_shared_pkg_version_bump`).

## Risks / verification

- **Don't accidentally runtime-load it.** It's a build-time import like
  collection-plugin — confirm the runtime loader's preset list doesn't
  pick it up (it shouldn't; runtime plugins are explicitly registered).
- **`./shared` browser-safety** — assert no `node:*` reaches the browser
  bundle (separate entry file; vite `external`).
- **`useAccountingChannel`** depends on host `usePubSub` + `pubsubChannels`
  — decide whether it moves into the package (taking a pubsub seam) or
  stays a host composable the View receives via props/runtime. Leaning:
  keep the pubsub *transport* host-side, move only the channel-name logic
  (already in `./shared/meta`).
- **CJS/Docker**: `require` + `default` export conditions on every subpath.

## Locked decisions

1. **One package, 3 subpaths** — `@mulmoclaude/accounting-plugin` with
   `./shared`, `./vue`, `./server`. Matches collection-plugin.
2. **DI factory** — `createAccountingRouter(deps)`; zero core changes.
   The backend stays in the package; host injects its infra.
3. **This repo only** — produce the package + rewire the MulmoClaude
   host + publish. Consuming it in MulmoTerminal is a separate change in
   that repo, out of scope here.
```
