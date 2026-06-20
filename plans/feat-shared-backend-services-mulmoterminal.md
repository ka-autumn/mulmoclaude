# Share MulmoClaude's backend services with MulmoTerminal (instead of copying)

Why: MulmoTerminal has been absorbing MulmoClaude features by consuming shared *plugin* packages
(markdown, form, chart, collection, html). That works for **UI that renders the agent's output inline**
(the `present*` cards). But MulmoClaude also has **headless backend behavior** — a scheduler, a
notification mechanism, and the skills staging→active mirror — and copying those into MulmoTerminal makes
no sense: they're not UI, they're complex, and a second hand-maintained copy *will* drift (we already hit
this with the shortcuts format and with PR #54 merging to the wrong branch).

The two apps **share one workspace** (`CLAUDE_CWD`, default `~/mulmoclaude`), so the *data* is already
shared with zero sync. The open question is how to share the *behavior* that acts on that data.

Context: surfaced while deciding whether to build a `/feeds` index + feed refresh into MulmoTerminal.
Feed refresh turned out to be a **scheduler system task**, not a button — i.e. it belongs to this
backend-services question, not the collections UI. See
`../mulmoterminal/docs/collection-plugin-integration.md`.

## Three buckets, three answers

| Bucket | Examples | Answer |
|---|---|---|
| Shared **data** | collections/skills, records, feeds, `config/shortcuts.json` | already shared (workspace files) — no work |
| **UI** | `present*` cards; collections/feeds **browse** surfaces | inline rendering → MulmoTerminal; standalone management → stays in MulmoClaude (open it when needed), or a shared *plugin* if it's conversation-contextual |
| **Headless backend behavior** | scheduler, notifier, skills-bridge | **this plan** — share, don't copy |

## The headless bucket splits into TWO mechanisms (important)

Investigating the three examples shows they are **not** all the same shape:

### Mechanism A — long-running daemons (scheduler, notifier)
- **Scheduler**: `server/events/scheduler-adapter.ts` `initScheduler(taskManager, systemTasks)` — already
  parameterized (takes a task manager + task defs). Runs the system tasks: journal, chat-index, **feeds
  refresh**, etc.
- **Notifier**: `server/notifier/*` (`types.ts`, `runtime-api.ts`, `eventPublisher.ts`).

These are background processes that act on the shared workspace continuously. They need **exactly one
owner per workspace**, and they must run **wherever the user is actually working** — if the services only
live in MulmoClaude, then running MulmoTerminal alone silently loses scheduling / notifications.

→ **Extract headless packages under `packages/services/`** (server-only, no Vue, one per service — see
"Package location & structure"), consumed by both apps at boot (MulmoTerminal already has the seam:
`initCollectionsBackend`/`initMarkdownBackend` → `startXService({ workspace, pubsub, bindings })`).

**Single-instance coordination — DECIDED: no lock (single app at a time).** The lock only existed to
coordinate two concurrent daemon owners. The product assumption is that MulmoClaude and MulmoTerminal are
**never run simultaneously**, so there is only ever one daemon owner — no lock needed. Two further facts
make this safe even under accidental overlap:
- The **idempotent** services (helps/preset-skills setup, skill-bridge mirror, file-change-publisher) are
  harmless to run twice (duplicate copy / duplicate "file changed" event → a no-op re-fetch), so they
  never need a lock regardless.
- The **only** double-fire hazard is the **scheduler** (a cron job / user skill run executing twice has
  side effects). If "never simultaneous" is only a convention (not enforced), guard *just the scheduler*
  with a cheap **PID-liveness pidfile** (write pid at boot; if an existing pid is still alive, skip
  starting the scheduler) — ~15 lines, not a heartbeat election. Otherwise skip even that.

**The seam is the proven `configureXHost` pattern.** The package owns the host-agnostic logic (cron eval,
due-job detection, event derivation); the host injects the side-effects:
- *run a job* → MulmoClaude uses its SDK chat-service; MulmoTerminal spawns a `claude` PTY (it already
  does this via `spawnBackgroundChat`).
- *deliver a notification* → MulmoClaude's UI vs MulmoTerminal's sidebar/toast.

### Mechanism B — per-session Claude HOOK (skills-bridge)
The skills staging→active sync is **not a daemon or a filesystem watcher** — it's a **Claude Code hook**,
`server/workspace/hooks/handlers/skillBridge.ts` (PostToolUse). The agent writes skill drafts under
`data/skills/<slug>/` (a plain data dir, no `.claude/` permission gate); the hook mirrors a **fixed
allowlist** — `SKILL.md`, `schema.json`, `templates/<safe path>` — into `.claude/skills/<slug>/` so Claude
CLI's skill discovery (and the collection engine) pick them up. It also mirrors `rm -rf
data/skills/<slug>` → `rm -rf .claude/skills/<slug>`.

Because it runs **per tool call, scoped to the writing agent's own session**, it needs **no single-instance
lock** — it's not a shared daemon. It's missing in MulmoTerminal today, which means **a collection skill
authored *inside* MulmoTerminal never reaches `.claude/skills/` and is never discovered.**

→ Share the **mirror RULE** (the allowlist + slug validation + path math + the `rm` mirror), and wire it
into each host's existing hook path. MulmoTerminal already receives every PostToolUse payload at
`/api/hook`, so it can do the mirror **server-side** (the host server isn't subject to Claude's `.claude/`
gate) without a separate hook subprocess. See the deep-dive below.

## Why this beats both "copy" and pure "run side by side"

- **Copy** → a second implementation of each daemon to keep in sync; guaranteed drift.
- **Pure coexistence** ("leave them in MulmoClaude") → the daemons only run while MulmoClaude's backend is
  up; MulmoTerminal-alone silently loses scheduling/notifications/skill-publishing. A hidden hard
  dependency.
- **Shared package (+ hook wiring for the bridge)** → the behavior travels with
  whichever app boots; one source of truth; works for MC-only, MT-only, or both.

## Package location & structure (DECIDED)

These live under a new **`packages/services/`** (sibling to `packages/plugins/`), **one package per
service** — mirroring how each UI plugin is its own package — so they can be extracted, versioned, and
adopted incrementally along the risk-ordered sequence. They do NOT belong under `packages/plugins/`: those
are GUI-protocol `ToolPlugin`s (a `View` + `execute`), whereas these are headless server-only modules with
no Vue and no tool shape.

`services` (over `daemons`) was chosen deliberately: the set is a mix — long-running daemons (scheduler,
notifier, watchers) **plus** run-once setup (helps/preset-skills) **plus** a per-session hook
(skill-bridge) — and "services" covers all three honestly where "daemons" would mislabel two of them. npm
names stay `@mulmoclaude/<name>` regardless of folder. Open sub-decision: the skill-bridge mirror rule
could alternatively live in `@mulmoclaude/collection-plugin/server` (it already exports
`isSafeActionTemplatePath`, the templates allowlist's validator) rather than its own `services/` package —
decide when implementing the pilot.

(The authoritative, risk-ordered build sequence is in "Full inventory" → "Re-sequenced by risk" below.)

## Open questions

- **Run-job binding shape**: the scheduler's tasks vary (journal vs feeds vs a user-scheduled skill run);
  the binding must cover "run this skill/prompt headless and capture output" — MulmoTerminal's
  `spawnBackgroundChat` is close.
- **Scope creep**: which system tasks are even meaningful in MulmoTerminal (journal? chat-index?) vs.
  MulmoClaude-only. The package should let the host pick its task set.

## Full inventory of MulmoClaude boot mechanisms (server/index.ts)

A daemon/startup audit — what runs at boot, its mechanism type, whether it acts on the SHARED workspace,
and the sharing strategy. Types: **setup** (idempotent run-once), **daemon** (continuous — no lock under
the single-app-at-a-time assumption; only the scheduler optionally gets a PID pidfile), **hook**
(per-session, agent-driven), **migration** (one-time), **infra/MC-only** (not shared).

| Mechanism (call site) | What it does | Type | Shared WS? | MulmoTerminal | Strategy |
|---|---|---|---|---|---|
| `initWorkspace` → **helps copy** (`server/workspace/helps/*.md` → `<ws>/helps/`) | seed/refresh the help docs | setup | yes | **missing** | share the setup (package or reimplement) — idempotent |
| `initWorkspace` → **preset-skills sync** (`syncPresetSkills` catalog + `syncActivePresetSkills` active `mc-*`) | seed/refresh preset skills | setup | yes | **missing** | same as helps |
| `initWorkspace` → dir structure + memory dir + custom dirs | ensure workspace layout | setup | yes | partial | reuse the path layout (already mirrored for collections) |
| **`skillBridge`** (PostToolUse hook) | mirror `data/skills/<slug>/{SKILL.md,schema.json,templates/*}` → `.claude/skills/` (+ `rm` mirror) | **hook** | yes | **missing** | share the mirror RULE; wire into `/api/hook` PostToolUse (no lock) — **PILOT** |
| **`startCollectionWatchers`** (`collections/watcher.ts`) | `fs.watch` each collection dataDir + 30s re-discovery → completion-bell notifications | **daemon** | yes | **missing** | shared pkg (no lock); pairs with the notifier |
| **`initFileChangePublisher`** (`events/file-change.ts`) | publish workspace file changes to pubsub → **live-refresh** of open views | **daemon** | yes | **missing** (the live-refresh gap) | shared pkg (no lock); forward onto `plugin:<scope>:file:<path>` |
| **`initScheduler` + `registerScheduledSkills` + `registerUserTasks`** | cron: journal, chat-index, **feeds refresh**, user-scheduled skill runs | **daemon** | yes | **missing** | shared pkg (no lock) + run-job binding (spawn `claude` PTY) |
| **`initNotifier`** (`server/notifier/*`) | derive + deliver notifications | **daemon** | yes | **missing** | shared pkg (no lock) + delivery sink (MT → sidebar/toast) |
| `startMacosReminderAdapter` | push notifications to macOS Reminders | daemon | no | n/a | MC-only integration; optional |
| `migrateCookingRecipesFromPlugin`, `migrateLegacyBillingPresets` | one-time data migrations | migration | yes | n/a | MC-specific; skip |
| `registerSaveAttachmentHook(capturePhotoLocation)` | hook: capture photo location on save | hook | yes | n/a (MC feature) | skip unless the feature is wanted |
| `initAccountingEventPublisher` | billing/accounting events | daemon | — | n/a | MC billing; skip |
| `ensureCredentialsAvailable`, `ensureSandboxImage` | Docker sandbox image/creds | infra | — | **MT has its own** | skip (MT sandbox is separate) |
| `initSessionStore` | MC chat-session persistence | infra | — | **MT has its own** | skip |
| `loadPreset/Runtime/DevPlugins`, `startRuntimeServices` | MC plugin runtime + dev hot-reload | infra/dev | — | **MT has plugins.json** | skip |

**The genuinely-shared set** (what this effort actually covers): the **setup** pair (helps + preset
skills), the **skill-bridge** hook, and four **daemons** — file-change-publisher (live-refresh),
scheduler, collection-watchers, notifier. Everything else is MC-specific, infra MT already has its own of,
or dev-only.

**Re-sequenced by risk, with the inventory folded in:**
1. **Setup: helps + preset-skills sync** — trivial, idempotent, no lock. Quick win; unblocks a
   fresh-workspace MT. (May not even need a package — a small shared setup module.)
2. **Skill-bridge hook** — per-session, no lock; unblocks skill authoring in MT. (The pilot.)
3. **file-change-publisher** — closes the live-refresh
   gap for collections + html in one move.
4. **Notifier + collection-watchers** — delivery sink is MT-specific.
5. **Scheduler** — add a run-job binding; brings feeds refresh / journal / user-cron.

## Pointers

- MulmoClaude: `server/events/scheduler-adapter.ts` (`initScheduler`), `server/notifier/*`,
  `server/workspace/hooks/handlers/skillBridge.ts` (the mirror rule + allowlist),
  `@mulmoclaude/collection-plugin/server` (`isSafeActionTemplatePath`).
- MulmoTerminal: `server/index.ts` boot seam (`init*Backend`), `hookSettingsJson()` + the `/api/hook`
  PostToolUse handler (where the skills mirror lands), `spawnBackgroundChat` (the run-job analog).
