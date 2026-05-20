# Plan: Encore as a built-in plugin (from-scratch reimplementation)

> **Status: landed on `feat/encore-builtin`, awaiting merge.** Implementation walked Steps 1 → 7 of the build plan below, plus stabilization batches addressing review feedback (YAML round-trip lossiness, FYI auto-clear on click, `resolveNotification` exposed to the LLM, stale `activeNotificationId` after server restarts, generic 500s on Zod failures, bundle-aware ticket clearing, next-cycle provisioning, and a follow-up refactor to a fully data-only on-disk model). `vue-tsc` + `tsc` + ESLint clean; component tests cover setup → query → amend → markStepDone with bundled targets, snooze, next-cycle provisioning, and stale-id recovery. The host's `docs/developer.md` now points at Encore as the canonical worked example of a server-state-heavy built-in plugin (chat-on-mount page + per-plugin mutex + custom YAML schema).
>
> This was a **from-scratch reimplementation** of Encore as a built-in plugin under `src/plugins/encore/` + `server/encore/`, on a new branch cut from `main`. The runtime-plugin codebase under `packages/plugins/encore-plugin/` (on `plan/feat-encore-dsl-v1`) was *not* touched and *not* migrated — we used its design doc as the spec and its lessons-learned section as warnings about traps, then wrote the built-in from zero.
>
> Companion: [`feat-encore-plugin.md`](./feat-encore-plugin.md). Read it first — it owns the DSL spec, the 28 resolved design decisions, and the 7 implementation lessons. This doc is shorter because the design work is already done; what's left is the build-out plan against a different host integration point.

## Framing

`feat-encore-plugin.md` answered "what should Encore *be*". This doc answers "how does it slot into the host as a built-in plugin". The two are deliberately separate:

- **`feat-encore-plugin.md`** is the DSL specification — schema, cadence math, at-expression grammar, tick semantics, MCP tool surface, three named scenarios. That document is reference material; this build implements it.
- **This doc** is the integration plan — directory layout under `src/plugins/encore/`, host-API call sites (typed, not cast), the codegen-driven barrel discovery, the **chat-on-mount page route** (the bell's `navigateTarget` lands here; the page calls `chat.start()` on mount and immediately redirects to `/chat/<chatId>` — the user never actually sees the page), the help-file sync, the test layout. None of which requires re-deciding the DSL.

The runtime-plugin codebase is the *reference implementation*: when in doubt about how a particular mechanism worked (`withLock` mutex, pending-clear ticket shape, escalation severity diff via `lastPublishedSeverity`), we re-read that code as documentation. We do not copy files.

## Why built-in rather than runtime preset

The runtime preset model exists for third-party plugin authors who ship as npm packages. Encore is not third-party — it is core to MulmoClaude's "files-as-database" pitch alongside todo / wiki / calendar. Every line is reviewed under the host's PR process; every release ships in lockstep with the host. Going built-in deletes friction that the runtime model imposed without paying for:

1. **Hot reload through host's Vite dev server.** No per-change `yarn workspace … build` + cache wipe + restart cycle.
2. **Typed host API calls, not casts.** The runtime version opens with `const ext = runtime as unknown as { tasks, notifier, chat }` because `gui-chat-protocol`'s exported `MulmoclaudeRuntime` type doesn't include those surfaces. Built-in code imports the typed host functions directly — `startChat`, `taskManager.register`, `notifier.publish` — and the type-checker catches invariant violations at build (the "info severity needs fyi lifecycle" rule, etc.) instead of at first publish.
3. **No MCP stdio "Done" envelope.** The runtime version's `ensureMessage` wrapper exists solely because `server/agent/mcp-server.ts` forwards only `result.message` / `result.instructions`. Built-in dispatch returns its raw response object end-to-end.
4. **Codegen-driven wiring.** Built-in plugins are auto-discovered by `scripts/codegen-plugin-barrels.ts` scanning `src/plugins/<name>/`. Drop the directory in, run `yarn plugins:codegen` (auto-runs in `predev`/`prebuild`), done. No manual edits to `src/plugins/metas.ts` / `index.ts` / `server.ts`.
5. **One bundle.** No `vite.config.ts` producing two outputs to satisfy the runtime loader's dynamic-import shape.

## Directory layout (as built)

```text
src/plugins/encore/
├── meta.ts              ← definePluginMeta({ toolName: "manageEncore", apiNamespace: "encore", apiRoutes, workspaceDirs })
├── index.ts             ← PluginRegistration with the executor that posts to /api/encore
├── definition.ts        ← MCP ToolDefinition for manageEncore (discriminated `kind` arg)
└── View.vue             ← Chat-on-mount page at /encore. The tick never calls chat.start(); it points its notification at this route. When the user clicks the bell, the View mounts, calls resolveNotification (which calls chat.start server-side), and immediately redirects to /chat/<chatId>. Transient (~300ms). Notification clearing happens later in the resulting chat when the LLM calls markStepDone, NOT here.

server/encore/
├── dispatch.ts          ← Kind-discriminated handler entry point (setup / amend / query / markStepDone / markTargetSkipped / recordValues / appendNote / snooze / resolveNotification)
├── tick.ts              ← DSL interpreter: phase eval, (stepId, severity, fireDate) bundling, severity escalation via ticket-stored severity, ensureOpenCycle (provisions next cycle when latest is derived-closed)
├── cycle.ts             ← CycleState shape (data-only: values / skipped / completedSteps / snoozedSteps), pure mutators, parse/serialize
├── closure.ts           ← isStepClosed / isTargetClosed / isCycleClosed pure derivation
├── obligation.ts        ← Obligation index.md parse/serialize
├── lock.ts              ← Per-plugin mutex: withLock + tickUnlocked / kickTickLocked split
├── notifier.ts          ← Thin wrapper around host notifier; fixes pluginPkg, maps DSL severity → host severity, always lifecycle: "action"
├── paths.ts             ← Workspace-relative path helpers (obligationDir, obligationIndexPath, cycleFilePath, pendingClearPath)
├── boot.ts              ← Registers the hourly tick with task-manager at startup; fires once on boot to catch phases that came due during downtime
├── yaml-fm.ts           ← Plugin-local YAML frontmatter parser using js-yaml's default schema (FAILSAFE_SCHEMA lost number/boolean types on round-trip)
└── dsl/
    ├── schema.ts        ← Zod schema, discriminated union on type=payment|service, IDENTIFIER vs KEBAB regex split
    ├── cadence.ts       ← Annual / biannual / monthly / weekly / daily cycle math (cycle id, deadline, start)
    ├── at-expression.ts ← Parser for at-expressions (cycle-start, cycle-deadline, step-deadline, schedule:DATE; ±Nd offsets)
    └── at-resolver.ts   ← Resolve parsed at-expr against cycle anchors → ISO date

server/api/routes/encore.ts          ← Express handler: POST /api/encore (dispatches by kind to server/encore/dispatch.ts)
server/utils/files/encore-io.ts      ← fs gateway: read/write/exists/readDir/unlink under WORKSPACE_PATHS.encore, with traversal-escape guard
server/workspace/helps/encore-dsl.md ← Help file Claude reads for the DSL grammar + per-action call shapes + worked examples
```

Host barrel touches (manual, not codegen):

- `src/main.ts` — register `encore` endpoint in the `installHostContext({ endpoints })` map.
- `src/config/roles.ts` — add `TOOL_NAMES.manageEncore` to General role's `availablePlugins` and the role-prompt section about Encore.
- `src/router/pageRoutes.ts` + `src/router/index.ts` + `src/App.vue` — add the `/encore` route, render branch dispatching to `<encore-view-component>`.

Auto-discovered (no manual edit):

- `src/plugins/metas.ts` / `index.ts` / `server.ts` — codegen picks up the new dir via `_generated/*`.
- `src/config/apiRoutes.ts` / `toolNames.ts` / `WORKSPACE_DIRS` / `PUBSUB_CHANNELS` — auto-merged from `meta.ts` via `defineHostAggregate`.

## Host-API call sites (reference for the build)

| Host primitive | Import | Used for |
|---|---|---|
| `startChat({ initialMessage, role })` | `server/api/routes/agent.ts` | `resolveNotification` handler — same pattern `server/api/routes/scheduler.ts:145` uses |
| `taskManager.register({ id, schedule, run })` | `server/events/task-manager/index.ts` | Hourly Encore tick from `encore-boot.ts` |
| `notifier.publish({ pluginName, severity, lifecycle, title, body, navigateTarget })` | `server/notifier/engine.ts` | Wrapped by `src/plugins/encore/notifier.ts` to fix `pluginName: "encore"` and derive lifecycle from severity |
| `notifier.clear({ pluginName, id })` | `server/notifier/engine.ts` | Same wrapper |
| Workspace file I/O | `server/utils/files/encore-io.ts` (new — follows the `<domain>-io.ts` convention in CLAUDE.md) | All reads/writes go through `writeFileAtomic`; no raw `fs.writeFile` in handlers |
| `WORKSPACE_PATHS.encore` | Derived from `meta.ts`'s `workspaceDirs` declaration | Resolves to `data/plugins/encore/` (plain name, see Decision #1 below) |

The `Deps` bag pattern from the runtime version stays — `tick.ts` and the handler module both receive `{ files, notifier, log, now }` so they remain unit-testable with mock deps. Only the wire-up at the top of `server.ts` (where the bag is constructed) changes.

## What survives verbatim from the runtime version

These are *design artifacts*, not code — they apply regardless of how Encore is hosted:

- **DSL schema** (Zod, discriminated union on `type`, all five cadence shapes, `IDENTIFIER` vs `KEBAB` regex split for field names vs slug IDs, cross-field validation rules) → `feat-encore-plugin.md` §§type / currency / Cadence / targets / steps / formSchema / firingPlan / carryForward / status / validation.
- **Tick semantics**: hourly heartbeat, group by `(stepId, severity, fireDate)`, current-phase severity (not first-phase) on first publish, escalation by diff against `lastPublishedSeverity`, no `chat.start` from tick, navigate to `/encore?pendingId=…`, orphan-clear by `notificationId` from URL.
- **Mutex pattern**: single `Promise`-chain lock per plugin, split into `tickUnlocked` (callable from inside the lock) and `kickTickLocked` (acquires lock, runs tick).
- **Lifecycle ← severity coherence**: `lifecycle = severity === "info" ? "fyi" : "action"` at publish time.
- **Kick-on-mutation**: every state-mutating handler calls `kickTickLocked("<reason>")` after persisting.
- **Pending-clear ticket shape**: flat `pending-clear/<pendingId>.json` with `{ notificationId, seedPrompt, targets, stepId, … }`; resolved by `View.vue`-dispatched `resolveNotification` which calls `chat.start` and redirects.
- **Click-handler page contract**: no UI, on-mount dispatch, `window.location.href = /chat/<chatId>` (full nav so the `from @mulmoclaude/encore-plugin` chip renders on first paint), orphan-bell-clear fallback, "Couldn't open the resolution chat" error path.
- **Help-file teaching ladder** (Resolved #21): JSON schema → short tool description → `config/helps/encore-dsl.md` → Zod errors with `helps/encore-dsl.md §<section>` pointers.

## What's intentionally different (built-in only)

1. **Typed host imports replace runtime casts.** The `definePlugin((runtime) => …)` factory + `runtime as unknown as { tasks, notifier, chat }` cast are gone. Each host primitive is imported by name from its host module.
2. **`ensureMessage` envelope is gone.** Handlers return raw response objects; the host's built-in MCP dispatch (`BUILT_IN_SERVER_BINDINGS`) wraps the result into the `ToolResult` shape it sends to Claude. Where a handler wants to set a custom Claude-facing message, it sets `message` explicitly — no global synthesis.
3. **`notifier` is a thin wrapper, not a closure injection.** `src/plugins/encore/notifier.ts` exports `publish` / `clear` that close over `pluginName: "encore"` and the severity→lifecycle derivation. Handlers and the tick import from there, never from `server/notifier/engine.ts` directly. One module owns both the scoping and the coherence rule.
4. **Plain-name workspace path: `data/plugins/encore/`** (not `data/plugins/%40mulmoclaude%2Fencore-plugin/`). The URL-encoded form was a runtime-loader artifact; built-in plugins use plain names. No migration concern because we're building from a fresh branch and there's no on-disk obligation file to preserve at the convert moment — the user will exercise the new plugin from scratch.
5. **One Vite bundle.** The plugin's source is part of the host bundle. No `packages/plugins/encore-plugin/vite.config.ts`-equivalent.

## Build steps (single PR)

Sized as one reviewable landing — pieces don't compose meaningfully on their own.

| Step | Scope |
|---|---|
| 1. Branch + skeleton | New branch off `main`. Create `src/plugins/encore/` with empty `meta.ts` / `index.ts` / `definition.ts` / `server.ts` / `View.vue` (just enough to make codegen happy). Wire `manageEncore` into `src/config/toolNames.ts` (via `meta.ts`'s `toolName`) and `src/config/roles.ts` (General role). `yarn plugins:codegen` clean. `yarn typecheck` clean. `yarn dev` boots |
| 2. DSL + paths | Port the DSL design from `feat-encore-plugin.md` into `dsl/{schema,cadence,at-expression,at-resolver}.ts`. Implement `paths.ts` + `encore-io.ts`. Pure functions, full unit coverage. No host integration yet |
| 3. Handlers (setup / amend / query / appendNote) | Write the non-tick handlers in `server.ts`. Wire `server/api/routes/encore.ts` + `meta.ts` apiRoutes. Validate end-to-end via `POST /api/encore` + via MCP from a chat. Storage smoke test passing |
| 4. Tick + bundling + escalation | Implement `lock.ts`, `notifier.ts` (scoped wrapper), `tick.ts`. Register hourly tick from `server/events/encore-boot.ts`. Wire `kickTickLocked` into every state-mutating handler |
| 5. Click-handler page | `View.vue` at `/encore`. Add `/encore` route + page key. Implement `handleResolveNotification` with orphan-clear path. End-to-end: create obligation → tick fires → click bell → chat opens with seed |
| 6. Tests | Component test at `test/plugins/test_encore_dispatch.ts` covering the dispatch flow (setup / query / amend / bundled markStepDone / next-cycle provisioning / stale-id recovery) against a tmpdir workspace, with the host notifier redirected via `_setFilePathsForTesting`. |
| 7. Docs | `docs/developer.md` plugin-development section gets Encore as the canonical example of "built-in plugin with MCP tool + chat-on-mount page + mutex". `docs/plugin-runtime.md` unchanged (it documents runtime plugins, not built-ins). Update this plan doc's status banner to "landed on `<branch-name>`" once the PR opens |

Each step should leave `yarn typecheck` / `yarn lint` / `yarn build` clean (per CLAUDE.md's "after modifying any source code" rule).

## Decisions to confirm before step 1

1. **Workspace path: `data/plugins/encore/` (plain) — confirmed.** Built-in convention. No data preservation concern (fresh branch, no users on the built-in version yet).
2. **`ensureMessage` envelope: dropped.** Built-in MCP dispatch flow doesn't have the stdio bridge's flattening behavior. Confirmed by inspecting `src/plugins/{todo,wiki,scheduler}/server.ts` patterns — they return raw response objects.
3. **`/encore` route reuse?** The runtime branch already added `pageRoutes.ts` + router + `App.vue` render branch. From `main` those don't exist yet — they need to be added in step 5. (Not a problem, just noting that this step has slightly more scope than on the runtime branch where they pre-existed.)
4. **MCP tool name `manageEncore` stays** (matches Resolved #2 / #21 / etc.).

## Out of scope

- **Migrating runtime-plugin data.** The runtime branch never shipped; nobody has on-disk obligations to preserve.
- **Touching the runtime-plugin codebase.** It stays on its branch as reference. If `plan/feat-encore-dsl-v1` is eventually deleted, this plan does not depend on it surviving in git.
- **Phase 2.3 (multi-step closing cascade for annual-physical).** That work lands *after* this conversion, on a follow-up branch, against the built-in baseline. Listed in `feat-encore-plugin.md` §Sub-phases.
- **`gui-chat-protocol@0.4.0` upstream** of `tasks` / `chat` / `notifier`. With Encore built-in, this upstream is only useful for *other* (third-party) runtime plugins. No longer blocks Encore.

## Rollback

Revert the single PR. No data on disk to clean up (built-in version has its own plain-name path; if the user did exercise it, they can delete `data/plugins/encore/` manually). The runtime branch is unaffected.
