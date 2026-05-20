# Plan: Encore — recurring obligations with year-over-year memory

Status: design / discussion. **Document-only PR**, no code changes yet.

## Why Encore

People juggle a long tail of recurring obligations that don't fit into either todos or calendars cleanly:

- **Filing taxes** (yearly) — multi-week prep window, documents to gather, a CPA to email, last year's return as reference.
- **Real-estate tax** (every 6 months) — payment + receipt to archive.
- **Annual physical** — which tests, which results trended which way, what to ask next time.
- **Car registration / inspection** — which shop, what they flagged "watch next year".
- **Christmas cards** — who you sent to, who sent back, address changes, "skip this year because…".
- **Birthday gifts** — what you gave, reactions, ideas for next time.

Existing tools each get part of the shape but none get the whole thing:

- **Bill / subscription trackers** (Rocket Money, Bobby) — money-only, "remind me X days before" is the entire model.
- **Recurring todo apps** (Todoist, TickTick, Things) — handle repetition but treat each instance as a one-off; no carry-forward.
- **Compliance / deadline trackers** — B2B-priced, enterprise-shaped.
- **Life-admin organizers** (Cozi) — broad and shallow, no deep model of obligations.

The gap is **institutional memory across instances**. Each recurrence is not independent — it is a *diff against last time*. "Same as last year except Aunt Jane moved" is the most natural way humans think about these. Most apps force re-entry; the magnetic feature is *last year's instance pre-populates this year's, and you only edit the deltas*.

## Why MulmoClaude

This is the clearest product-fit case we have seen for the workspace-as-database thesis:

- **The data is heterogeneous and personal.** A Christmas card list, a CPA's email, a scan of last year's W-2, a note saying "the DMV line is shorter on Tuesday." Rigid schemas can't model this; a folder of plain files can.
- **"Same as last year except…" is an LLM task, not a form task.** Claude reading `data/encore/xmas-cards/2025/recipients.md` and drafting `2026/recipients.md` with a "who to review" list is trivially natural — and impossible in Todoist.
- **Recurrence already exists.** The scheduler, calendar, and todos plugins are in place. This is not a new engine — it is a new *case* abstraction sitting on top.
- **Privacy story is built in.** Tax docs, medical history, gift lists — people will not put these in a cloud SaaS. Local-first is a feature, not a constraint.

> **UX decisions for the notifier migration are tracked separately in [`plans/done/feat-notifier-ux.md`](feat-notifier-ux.md).** That document is the source of truth for panel layout, badge semantics, row behaviours, history visibility, and the no-toast decision. The phasing and engine internals below cite it where the decisions overlap.

## Two-layer architecture

Encore drives requirements harder than any other plugin we have shipped, especially around reminders. The clean layering is:

1. **Host-level Notifier upgrade** — a generic notification *engine* that any plugin can consume. Calendar, Todos, Sources, Automations, and Encore all benefit.
2. **Encore plugin** — domain logic (obligation types, lead-time policies, instance lifecycle, carry-forward) that *uses* the Notifier engine. No Encore-specific reminder primitives leak into the host.

This matches the plugin-vs-host boundary in `CLAUDE.md`: host owns generic infrastructure that benefits multiple plugins; plugin owns domain.

---

## Part 1 — Notifier upgrade (host)

> **Scope note.** The full spec below is the design north star, not the v1 ship list. PRs 2 + 3 shipped a minimal subset (UUID identity, `pluginPkg` / `pluginData`, `publish` / `clear` / `cancel`, two-section bell UX, history ring). PR 4 migrates legacy callers onto that subset and stops. The remaining features — timers / `firesAt`, full state machine, snooze, `signal()`, re-surface, severity → channel routing config — are deliberately deferred. Encore (PRs 5 + 6) pulls in whichever it actually needs once the domain demands them, so we can see real requirements before building infrastructure for them.

### Today

`server/events/notifications.ts` exposes `publishNotification()` — a single fire-and-forget call that:

- Pushes a payload to the in-memory store (last 50, used by the bell panel).
- Publishes to the `notifications` pubsub channel for every open Web tab.
- Optionally pushes to a chat-service bridge (Telegram / CLI).
- Optionally pushes to macOS Reminders (gated by env flag).

`scheduleTestNotification()` schedules a single `setTimeout` for delayed delivery. There is no:

- **Scheduling beyond a single fire** — once `setTimeout` runs, the notification is gone whether or not the user saw it.
- **Lead-time / escalation curves** — every reminder is "fire once at time T."
- **Acknowledgment state** — clicking the bell marks read; that is it. Nothing re-surfaces if ignored.
- **Snooze with intent** — "remind me when my W-2 arrives" is impossible to express.
- **Channel routing by severity** — every notification goes to every channel.
- **Persistence across restarts** — `setTimeout` dies with the process; the in-memory store is non-durable.

The current model is sufficient for "your scheduled task just finished" but cannot carry the weight of "you usually need 3 weeks to gather tax documents."

### Two notification types — two lifecycle shapes

Plugins fire notifications that fall into one of two shapes. The Notifier carries `lifecycle` on every payload as a UI hint — the engine itself never reads it. The field is named `lifecycle` (not `kind`) because the existing `NotificationKind` already means "source category" — `todo | scheduler | agent | …` — and the two are orthogonal: source category (collapsed into `pluginPkg`, see below) and lifecycle shape are independent.

```ts
type NotifierLifecycle = "fyi" | "action";
```

| Lifecycle | Example | Has body content? | Who calls `clear`? |
|---|---|---|---|
| `fyi` | "Backup completed" | No | The bell panel — user dismisses via the row's `×` |
| `action` | "Pay H2 property tax" / "Daily news digest is ready" | Yes — plugin-owned target | The plugin — either on view mount ("show this once" semantics) or after the domain action completes |

`action` collapses what an earlier draft split into `read` and `action`: from the engine's perspective both are "the plugin owns the close call", so the distinction was bookkeeping with no runtime effect. The plugin chooses *when* to call `clear` based on its own UX — on mount for read-once notifications, after an explicit action for things like "Pay property tax." If the user never visits the plugin's view (e.g. submits the journal entry via chat instead), the plugin can still detect the underlying state change and call `clear` from there; the panel click is convenience routing, not the close trigger.

### Target shape — `Notifier`

A generic engine in `server/notifier/` that any plugin can consume.

#### Identity model

The engine owns the notification `id` (UUID, assigned at `schedule()` time and returned to the caller). The plugin owns:

- `pluginPkg` — structural namespace. Routes the notification, picks the icon (from the plugin's META), derives the deep-link target for `action` lifecycle. Replaces the old `NotificationKind` source-category enum.
- `pluginData<T>` — typed, plugin-specific structured payload. Opaque to the engine; read by the plugin's View / standalone page when rendering. The natural place for domain identifiers (obligation slug, year, item id, step name) — *not* `id`.

The plugin stores returned UUIDs alongside the state they belong to (typically in its own data files — e.g., `data/encore/taxes/2026/instance.md` frontmatter: `reminders: [uuid1, uuid2]`). "Re-derive on state change" becomes *cancel-then-schedule*: cancel the prior UUIDs, schedule fresh ones, write the new list back. Honest ownership: the plugin's data file is the source of truth for "which reminders does this state own"; the engine is a pure delivery + lifecycle service.

#### Core API (server-side, called by plugins)

```ts
// Schedule a notification. The engine assigns a UUID at generation
// time and returns it. The plugin stores it alongside the state it
// belongs to and uses it for later operations.
const { id } = notifier.schedule({
  pluginPkg: "encore",
  lifecycle: "fyi" | "read" | "action",
  severity: "info" | "nudge" | "urgent",
  firesAt: ISO8601,
  title: string,
  body?: string,
  i18n?: { titleKey, bodyKey?, bodyParams? },
  pluginData?: T,                            // typed per plugin; engine never inspects
  // Re-surface policy: if not acted by `firesAt + N`, bump severity
  // and fire again. `null` disables. Only meaningful for `read` and
  // `action`; `fyi` ignores.
  resurface: { afterMs, escalateTo: "nudge" } | null,
  // Snooze-condition handle: when the plugin emits a matching signal,
  // the reminder un-snoozes. Scoped under pluginPkg structurally —
  // collisions across plugins are impossible by construction.
  snoozeUntilSignal: string | null,
});

// Two distinct verbs — the audit trail captures the difference:
notifier.clear(id);     // "the user did the thing" → records `acted`, drops from pending
notifier.cancel(id);    // "this reminder became irrelevant" → records `cancelled`, no action implied

notifier.snooze(id, { untilTime } | { untilSignal });

// Signals are structurally scoped, not string-prefixed:
notifier.signal({ pluginPkg, key });   // un-snoozes reminders in pluginPkg waiting on `key`

// Recovery + discovery — plugin re-derives its UUID list if it lost
// its bookkeeping (data corruption, version mismatch, manual edit).
// Engine returns id + pluginData; the plugin filters on its
// pluginData shape.
notifier.listFor(pluginPkg): Array<{ id, pluginData?, ... }>;

// Lookup by id — for deep-link landing pages that receive
// `?notificationId=<uuid>` and need to recover the original
// pluginData to highlight the right thing and call clear(id).
notifier.get(id);
```

`clear` vs `cancel` is semantically meaningful for the audit trail and for any future "completion-rate" telemetry. UX-wise both reduce the badge count.

#### Lifecycle / state machine

```
                ┌→ acted   ──→ closed   (notifier.clear OR navigate-and-close for `read`)
pending → delivered → seen ─→ snoozed ─→ (re-evaluates at untilTime / untilSignal)
                ↓             ↘ dismissed → closed  (only for `fyi` via acknowledge)
                └→ resurface (delivered without acted, after re-surface delay)
```

- `seen` is "rendered to the user" (panel opened). Re-surface fires off `delivered` without `acted`, **not** off `seen` without `acted` — otherwise an open bell panel would suppress every escalation. (No toast in v1 — the bell badge's worst-severity color is the at-a-distance signal; see `feat-notifier-ux.md`.)
- For `fyi`: acknowledge transitions directly to `closed` without going through `acted` (no domain action exists to be acted on; acknowledge IS the close).
- For `action`: only the plugin can transition to `acted` / `closed`. The panel routes the user to the plugin's view but does not by itself close the notification.

#### Pending count + bell badge semantics

The toolbar bell shows the count of notifications in `delivered` or `seen` state, **excluding** `snoozed`, `cancelled`, and `closed`. This is meaningfully different from today's "unread" count — the badge reflects *outstanding obligations*, not "rows you haven't clicked."

- **Color encodes worst-severity in the queue.** Gray for `info`-only, amber if any `nudge`, red if any `urgent`. One glance answers "is anything on fire?" without opening the panel.
- **Cap visual at `99+`.** Above 99 the actual number stops mattering — it's a backlog problem, not a counting problem.
- **Snoozed items don't count.** They were explicitly deferred. They re-enter the count when their snooze expires or their signal fires.
- **Aggregate, not per-plugin.** One badge on one bell. Per-plugin badges splinter the chrome without saving the user a click.

#### Panel UX per lifecycle

The bell panel is one scrollable popup with two stacked sections — Active on top, History below; no tabs, single scroll region (see `feat-notifier-ux.md` for the layout and rationale). Row affordance differs by `lifecycle`:

- **`fyi`** — body click is a no-op (no `navigateTarget` by construction). Trailing `×` calls `clear` (fyi has no `cancel` notion — "user acknowledges" IS the close). The entry moves to History as `cleared`.
- **`action`** — body click closes the panel and routes the user to `navigateTarget` with `?notificationId=<uuid>` appended; the landing page calls `notifier.get(uuid)` to recover `pluginData`, highlights the relevant item, and decides when to clear. The notification stays in Active until the plugin calls `notifier.clear(id)`. Trailing `×` calls `cancel` ("user has decided this is no longer relevant"); the entry moves to History as `cancelled`. Two publish-time rules, enforced by the engine and the HTTP layer in lockstep: `action` requires a **non-empty `navigateTarget`**, and `action` is **incompatible with `info` severity** (low-priority obligation is incoherent — fyi instead).

History rows are read-only with one capability: rows whose original entry had a `navigateTarget` stay clickable and re-route to that target — the migration's answer to "what happened earlier?" since the panel no longer shows acked items inline. Visual marker `✓` / `✗` for `cleared` / `cancelled`; severity color persists.

`NotificationBell.vue` gains `lifecycle`-aware rendering for the row affordances and a History section underneath Active. `NotificationToast.vue` is **removed in v1** (toast as a delivery surface goes away — see "no toast" below). Testids: `[notification-row-fyi]`, `[notification-row-action]`, `[notification-row-dismiss]` (the trailing × on either row), `[notification-history-row]`.

#### Severity → channel mapping

Configured globally per user, with optional per-plugin override.

| Severity | Default channels |
|---|---|
| `info` | bell only |
| `nudge` | bell only (badge color escalates to amber) |
| `urgent` | bell + macOS push + bridge (Telegram/CLI) (badge color escalates to red) |

Mapping lives in `~/mulmoclaude/config/notifier.json`. Plugins may *request* a channel uplift (`requireChannel: "macos"`) but the user's config is authoritative.

**Toast is intentionally absent.** An earlier draft routed `nudge` and `urgent` through a top-right toast popup (today's `NotificationToast.vue`); v1 drops it because most fyi notifications don't warrant interruption and the bell badge's worst-severity color already provides at-a-distance signalling. Re-introducing toast for an `urgent`-only path is a follow-up if real-use feedback demands it.

#### Persistence

- `~/mulmoclaude/data/notifier/active.json` — currently-active entries (PR 2's snapshot file, kept).
- `~/mulmoclaude/data/notifier/scheduled.jsonl` — queued future fires (added in PR 3 once timers land).
- `~/mulmoclaude/data/notifier/state.jsonl` — audit log of state-machine transitions (added in PR 3).
- `~/mulmoclaude/data/notifier/history.jsonl` — append-only ring of acknowledged / cancelled entries, capped at 50 (FIFO eviction). The bell panel's History section reads from here; this is the migration's substitute for the legacy "last 50 fired" in-memory store.

All four go through `writeFileAtomic`.

#### Pub-sub events

New channels in `src/config/pubsubChannels.ts`:

- `notifier:fired` — a scheduled notification just fired. Subscribers update progress UI.
- `notifier:closed` — closed via any path (`acted` / `acknowledged` / `dismissed` / `cancelled`); payload includes which path. Plugins use this to mark "done for this instance" or update item status.

#### Notification center

The bell panel becomes a thin client over the new state — same toolbar position, but the surface inside changes shape: Active section on top, History section below, single scroll, no tabs. Active rows share one visual layout (severity dot + title/body/meta + trailing `×`); body click navigates for `action`, no-ops for `fyi`. The full engine adds affordances (snooze button, "remind me again in 1h" picker) on top of this. History rows are read-only but route on click when they had a `navigateTarget`. `NotificationBell.vue` carries all of this; `NotificationToast.vue` is removed. The existing `[notification-badge]` testid stays. See `feat-notifier-ux.md` for the full layout, empty states, and the rationale.

### What stays — and the legacy migration

The existing `publishNotification()` call site — nothing immediate, no schedule, no re-surface — remains as the simplest entry point for "fire one notification right now." It becomes a thin wrapper over `notifier.schedule({ firesAt: now, resurface: null, lifecycle: "fyi" })`.

The wrapper maps the legacy `NotificationKind` source category to a synthetic `pluginPkg` so the routing + icon contract doesn't break:

- `todo` / `scheduler` / `agent` / `journal` → `pluginPkg: "<same-name>"` (synthetic plugins for now; future PRs may promote them to real plugin METAs).
- `push` / `bridge` / `system` → `pluginPkg: "host"`.

Default `lifecycle: "fyi"` matches today's behaviour (fire-and-forget, user acks from the bell panel). All current callers keep working unchanged; new callers can opt into the `action` lifecycle by calling `notifier.schedule()` directly.

### Out of scope for Notifier v1

- Cross-device delivery (sync between Mac and phone).
- iOS / Android push.
- "Smart" timing ("when the user is at the desk on Sunday morning").
- Aggregation / digest ("3 reminders today, here is the summary").

These can layer on later without re-shaping the core.

---

## Part 2 — Encore plugin

### Identity (built-in plugin)

```ts
// src/plugins/encore/meta.ts
export const META = definePluginMeta({
  toolName: "manageEncore",
  apiNamespace: "encore",
  apiRoutes: { dispatch: { method: "POST", path: "" } },
  mcpDispatch: "dispatch",
  workspaceDirs: {
    encore: "data/encore",
    encoreObligations: "data/encore",   // each obligation = a sub-folder
  },
  staticChannels: {
    encore: "encore",
  },
});
```

Standard built-in plugin layout under `src/plugins/encore/` — `definition.ts` / `index.ts` / `View.vue` / `Preview.vue` — with server endpoints in `server/api/routes/encore.ts` and domain code in `server/encore/`.

### Data model — the workspace is the database

```text
~/mulmoclaude/data/encore/
  <obligation-slug>/
    obligation.md              ← config: title, recurrence, lead-time, channels
    notes.md                   ← free-form user annotation (Claude reads for context)
    <YYYY>/                    ← one folder per instance
      instance.md              ← status, milestones, resolution
      items.md                 ← optional: parallel/sequential sub-items (see below)
      attachments/             ← scans, PDFs, screenshots
      diff-from-last.md        ← Claude-generated on instance creation
```

Example: `data/encore/xmas-cards/obligation.md`

```markdown
---
slug: xmas-cards
title: Christmas cards
recurrence:
  kind: yearly
  anchor: "12-15"            # send by this date
leadTime:
  prepDays: 14               # 2 weeks of prep needed
  escalateAt: [21, 7, 1]     # days before anchor to fire reminders
severity:
  default: info
  finalDays: urgent          # last entry in escalateAt uses this
created: 2026-05-05
---

# Notes

International cards need 3 weeks. Prefer photo cards from Shutterfly.
Last year I forgot the Tanaka family — make sure they are on the list.
```

Example: `data/encore/xmas-cards/2026/instance.md`

```markdown
---
year: 2026
status: in-progress       # planned | in-progress | done | skipped
opened: 2026-11-10
progress:
  - { step: "draft list",  done: true,  at: 2026-11-12 }
  - { step: "order cards", done: false }
  - { step: "address",     done: false }
  - { step: "mail",        done: false }
---

# This year

Skipping the Watson family (moved, no forwarding address yet).
Adding the new neighbours (Lee).
```

Why per-file over a single `obligations.json`:

- Matches the wiki / sources convention. Claude can edit one obligation without touching a global registry.
- Grep-friendly, git-diff-friendly.
- Carry-forward is "read last year's folder, draft this year's" — a perfect Claude task.

### Multi-item instances

A single instance often involves *multiple sub-items* in two distinct shapes:

- **Fan-out / independent** — Christmas cards to 50 recipients. Each is its own thing; some can be done while others remain. The instance is "done" when (most/all) items are done.
- **Sequential / pipelined** — a property-tax bill flows through `received → paid → confirmed`. Each item walks the same small pipeline; the *next undone step* is what the user (and the reminder) cares about.

Both are supported by one lightweight construct: an `items` array, where each item has an optional `steps` array. No items, items-without-steps, items-with-steps — pick the shape that fits.

```ts
type Item = {
  id: string;          // stable, plugin-owned
  label: string;       // user-facing
  status: "pending" | "in-progress" | "done" | "skipped";
  note?: string;       // free-form
  steps?: Step[];      // optional sub-pipeline
};

type Step = {
  name: string;
  done: boolean;
  at?: string;         // ISO date when marked done
};
```

For long lists (Christmas-card recipients, large invoice batches) items live in a separate `items.md` to keep `instance.md` readable. For 1–10 items they can sit in the instance frontmatter directly. Either layout is read by the same parser.

#### Example — fan-out: `data/encore/xmas-cards/2026/items.md`

```markdown
---
items:
  - { id: tanaka,  label: "Tanaka family",  status: done,    at: 2026-12-05 }
  - { id: watson,  label: "Watson family",  status: skipped, note: "moved, no forwarding address" }
  - { id: lee,     label: "Lee family",     status: pending, note: "new neighbours — get address" }
  - { id: kimura,  label: "Kimura family",  status: pending }
---
```

#### Example — sequential: `data/encore/property-tax/2026/items.md`

```markdown
---
items:
  - id: prop-tax-h1
    label: "First-half property tax"
    status: done
    steps:
      - { name: received,  done: true, at: 2026-04-10 }
      - { name: paid,      done: true, at: 2026-04-15 }
      - { name: confirmed, done: true, at: 2026-04-20 }
  - id: prop-tax-h2
    label: "Second-half property tax"
    status: in-progress
    steps:
      - { name: received,  done: true,  at: 2026-10-08 }
      - { name: paid,      done: false }
      - { name: confirmed, done: false }
---
```

The two existing `instance.md` fields play together cleanly:

- `progress` = milestones for the instance *as a whole* ("draft list," "order cards"). Optional.
- `items` = the parallel/sequential entities the instance acts on. Optional.

A trivially simple instance (annual physical: just a date and some notes) uses neither. Christmas cards uses both. Property tax uses only `items`.

#### Reminder implications

Item-level granularity makes reminders sharper without complicating the Notifier core:

- **Fan-out**: aggregate signal — "5 of 25 recipients still pending, 7 days to anchor." Encore composes the reminder body; Notifier just delivers it.
- **Sequential**: per-item reminder targeting the *next undone step* — "property-tax H2 received but not paid; due in 3 days." Each item with a stuck step is its own re-surfacing reminder.
- Progress-aware suppression extends naturally: percentage-done across items, or "no item has advanced in N days."

### `manageEncore` actions

Single tool with action dispatch (matches `manageAccounting` / `manageAutomations` / `manageSkills`):

```ts
manageEncore({ action: "createObligation", slug, title, recurrence, leadTime, severity })
manageEncore({ action: "updateObligation", slug, patch })
manageEncore({ action: "listObligations" })
manageEncore({ action: "openInstance", slug, year })           // creates <slug>/<year>/, copies forward
manageEncore({ action: "updateInstance", slug, year, patch })  // status, progress, notes
manageEncore({ action: "closeInstance", slug, year, status: "done" | "skipped" })
manageEncore({ action: "addItem", slug, year, item })          // append to items[]
manageEncore({ action: "updateItem", slug, year, itemId, patch })  // status, note, step done/at
manageEncore({ action: "removeItem", slug, year, itemId })
manageEncore({ action: "listUpcoming", withinDays })           // queue across all obligations + per-item pending counts
manageEncore({ action: "diffFromLast", slug, year })           // Claude reads N-1 vs N, summarizes deltas
manageEncore({ action: "snoozeReminder", slug, year, itemId?, until })  // proxies to notifier.snooze; itemId scopes to a single item
```

`openInstance` is the carry-forward seam: copies last year's `instance.md`, `recipients.md`, etc. into the new year's folder *and* asks Claude to write `diff-from-last.md` highlighting "what to review." This is the magnetic feature.

### Reminder integration

Encore translates obligation + item state into `notifier.schedule()` calls. Because the engine assigns UUIDs, "re-derive on state change" is *cancel-then-schedule*: Encore stores its UUIDs in the instance frontmatter (`reminders: [uuid1, uuid2, …]`), cancels them, schedules fresh ones, writes the new list back.

- On `createObligation` — schedule reminders for the upcoming instance based on `leadTime.escalateAt` and `severity`. Persist the returned UUIDs in the obligation file.
- On `openInstance` — cancel the prior schedule's UUIDs, re-derive from the actual progress state (suppress the "start prep" reminder if the user already opened the instance early), persist the new UUID list on the instance.
- On `updateInstance` — same cancel-then-schedule with progress-aware suppression. If the user has marked 60% of milestones done, suppress the generic nudge; if no progress for `escalateAt[i]` days, escalate.
- On `closeInstance` — cancel all UUIDs in the instance's reminder list, schedule the *next* year, replace the list.
- Recovery — on plugin boot or after a manual edit, Encore can call `notifier.listFor("encore")` and reconcile the engine's pending set against its own per-instance lists.

Snooze-until-signal is how Encore expresses domain conditions:

```ts
// "Remind me after my W-2 arrives" — Encore schedules the reminder
// with snoozeUntilSignal: "taxes:w2-received" (scoped under pluginPkg
// "encore" structurally, no string-prefix encoding).
// When the user marks "W-2 received" in the instance UI, Encore
// calls notifier.signal({ pluginPkg: "encore", key: "taxes:w2-received" })
// and the reminder un-snoozes.
```

The host does not need to understand "W-2"; it just routes signals scoped by `pluginPkg`.

### View

Two surfaces:

- **Chat view** (`View.vue`) — when invoked by Claude, shows the current instance: progress checklist, attachments, "diff from last year" panel, snooze controls.
- **Standalone route** (`/encore`) — index of all obligations grouped by next-fire-time. Same UI building blocks as `/todos` and `/calendar`.

The standalone route follows the existing pattern: route registered in `src/router/index.ts`, page component wraps `<PluginScopedRoot pkg-name :endpoints>`.

---

## Phasing

**Order of operations**: A tiny client-only dev-mode gate ships first (PR 1, ✅ merged), then a stripped-down Notifier prototype (PR 2, ✅ merged) validates the data model + API shape via the dev-mode debug popup. PR 3 builds the full new bell UX on the debug surface (running parallel to the legacy bell) so the layout and behaviours can be exercised before any migration. PR 4 migrates `publishNotification()` onto the prototype engine and replaces the legacy bell — **no new engine features**. Encore (PRs 5 + 6) pulls in whichever engine features it actually needs (timers, snooze, signals, channel routing, …); the discovery happens there, driven by real domain requirements, not pre-spec'd at the system level.

### PR 1 — Dev mode + Debug role (client-only, ~25-line diff) ✅ merged

A minimal client-only dropdown gate. PR 2's `_notifierTest` plugin will sit on the same `VITE_DEV_MODE` flag, but the gating mechanism for *roles* lives entirely in the role schema + the dropdown component.

**Schema**:

- `src/config/roles.ts` — add optional `isDebugRole?: boolean` to `RoleSchema` and the inferred `Role` type. Existing custom roles in workspace files don't need to update — the field is optional.

**Debug role**:

- New entry at the end of `ROLES` in `src/config/roles.ts`, copied verbatim from General with `isDebugRole: true` set. No factoring of shared prompt/plugin constants — the data is literal so each role stays independently editable.

**Visibility filter**:

- `src/components/RoleSelector.vue` adds a `visibleRoles = computed(...)` that filters out `isDebugRole` entries unless `import.meta.env.VITE_DEV_MODE === "1"`. The `v-for` iterates `visibleRoles`. That's the entire visible behavior change.

**Env wiring**:

- Set `VITE_DEV_MODE=1` in `.env`. Vite exposes `VITE_*` to client code by default — no `vite.config.ts` change needed.
- `src/vite-env.d.ts` types `VITE_DEV_MODE?: "1" | "0"` for the typecheck.

**Out of scope intentionally** (rejected from earlier draft as overengineered for what is a single client-side gate):

- No server-side `DEV_MODE` flag. The server doesn't filter roles in `/api/roles` (it returns custom roles only — built-ins flow client-only via the bundled `ROLES` constant), so there's nothing for the server to gate.
- No `/api/system/config` endpoint. No runtime config to fetch — the flag is a compile-time constant.
- No `useSystemConfig` composable. `import.meta.env.VITE_DEV_MODE` is read once where it's needed.
- No filter inside `useRoles`. The dropdown is the only surface that needs filtering.
- No `vite.config.ts` mirror plumbing. `VITE_*` is the convention; using `DEV_MODE=1` instead would force one extra `define` line for no real gain.
- No factoring of `GENERAL_PROMPT` / `GENERAL_AVAILABLE_PLUGINS`. Debug holds a literal copy.

Existing chat sessions tied to a debug role still render normally (icon, history, tabs) — only the dropdown hides Debug. If devMode is off and a user somehow has an active Debug session, it stays usable. New sessions in non-dev-mode simply can't pick the role.

**Acceptance bar**: with `VITE_DEV_MODE=1`, Debug appears at the bottom of the role dropdown with General's plugin set; without it, Debug is absent. Total diff: ~25 lines across 3 files (`roles.ts`, `RoleSelector.vue`, `vite-env.d.ts`).

### PR 2 — Notifier prototype (no timers, JSON persistence, debug-plugin harness) ✅ merged

A minimal first cut to validate the data model + API shape before adding the time-based machinery. **`server/events/notifications.ts` is left completely untouched** — the prototype is a parallel service with its own pub/sub channel, exercised only via the existing `@mulmoclaude/debug-plugin` `/debug` page.

The engine in `server/notifier/` exposes:

- `publish({ pluginPkg, severity, title, body?, lifecycle?, pluginData? })` → `{ id }` — UUID generated synchronously at enqueue time and returned to the caller.
- `clear(id)` — covers all "user dealt with it" paths. The lifecycle-specific call sites (`fyi` bulk-ack from the bell panel, `action` from the plugin's own view — either on mount for "show this once" semantics or after a domain action completes) are convention only; the engine doesn't read `lifecycle`.
- `cancel(id)` — "this notification became irrelevant" (kept distinct from `clear` for future audit purposes; behaviorally identical for now).
- `get(id)` / `listFor(pluginPkg)` / `listAll()`.
- No `firesAt`, no scheduling, no `markSeen` / `acknowledge`, no snooze, no signal, no re-surface, no severity → channel routing — those all land in PR 3.

State model collapses to `active → cleared | cancelled`. Both terminal states drop the entry from the active store; the difference is recorded only in the emitted pub/sub event type.

Persistence:

- Single `~/mulmoclaude/data/notifier/active.json` file holding only active entries (`{ entries: { [id]: NotifierEntry } }`). No append-only log.
- Written via `writeFileAtomic` on every mutation.
- **In-memory write coordinator**: a `writing` flag plus a queue of pending waiters. The first caller to find the flag clear runs `drain()`, which loops until the waiter queue is empty — each round takes the current batch, snapshots the in-memory map, writes once, resolves the batch. Subsequent callers during a write push their resolver and return. This coalesces N rapid mutations into ≤2 disk writes, prevents the rename-race two concurrent `writeFileAtomic` calls would otherwise create, and lets the engine serve mutating APIs as plain `await persist()` calls.
- All mutating APIs roll back the in-memory change if `persist()` rejects, so memory and disk never diverge.
- Pub/sub events (`{ type: "published" | "cleared" | "cancelled", ... }`) emit **after** persistence succeeds, on a **single global `notifier` channel** carrying every event regardless of `pluginPkg`. Subscribers filter client-side. Per-`pluginPkg` channels (`notifier:<pluginPkg>`) were considered and rejected for v1: the only consumer is the debug page (which wants global view anyway), and a future bell badge will also want global view; per-plugin filtering is cheap on the client and avoids the dynamic-subscription bookkeeping that per-pluginPkg channels would require.

Wiring:

- `server/api/routes/notifier.ts` — single `POST /api/notifier` dispatch endpoint with `{ action: "publish" | "clear" | "cancel" | "list" }` body, matching the `manage*` tool pattern.
- `src/config/pubsubChannels.ts` — new `notifier` channel.
- `src/config/apiRoutes.ts` — `/api/notifier`.
- `server/workspace/paths.ts` — `data/notifier/` and `active.json`.

A new top-bar **debug popup** (host-side, not a plugin) is the manual test surface:

- Lives next to `NotificationBell` in `SidebarHeader`, gated by `VITE_DEV_MODE === "1"` so it never appears outside dev. Icon-only button (32×32, `material-icons` "bug_report"), opens a popup panel on click — same UX shape as the lock and bell popups, separate component (`NotifierDebugPopup.vue`).
- Subscribes to the `notifier` pub/sub channel via `usePubSub` and renders the live active list (severity color, lifecycle hint, title/body, `pluginPkg`). Initial state is fetched once on open via `POST /api/notifier {action: "list"}`.
- Single `[Run scripted test]` button drives a ~4.8s sequence across **multiple `pluginPkg` values** (e.g. `debug__system`, `debug__news`, `debug__encore`) so namespace separation and `listFor` filtering are visually obvious. Steps interleave `publish` / `clear` / `cancel` with ~500ms gaps so a human can watch entries appear and disappear; the script ends with the active list empty.
- Before each run, the script clears any leftover `debug__*` entries in case a previous run aborted mid-way.
- No manual publish/clear forms — those aren't needed now or later.

Why the host top-bar instead of `@mulmoclaude/debug-plugin`'s `/debug` page: runtime plugins receive a `BrowserPluginRuntime.pubsub` that's hard-scoped to `plugin:<pkg>:<channel>`, so a runtime plugin cannot subscribe to the host's global `notifier` channel without bundling a second socket.io connection. The debug popup, being host code, uses `usePubSub` directly with no scope rewrite. The `@mulmoclaude/debug-plugin` `/debug` page stays as it is — a placeholder for future plugin-scoped experiments.

Test coverage:

- **Unit** (`test/server/notifier/`): `publish` returns a usable id; `clear` / `cancel` remove entries idempotently; unknown id is a no-op (no throw); `listFor("a")` doesn't return entries with `pluginPkg: "b"`; `pluginData<T>` round-trips unchanged; persistence round-trip via tmp dir (publish, restart engine on the same path, entries restored); concurrent mutation under load (10 simultaneous publishes resolve to a final file matching the in-memory snapshot, with ≤2 actual disk writes); rollback on simulated persist failure.
- **Manual** (debug page): visual confirmation that pub/sub events drive the view, the scripted sequence runs cleanly to empty, and nothing leaks into the existing bell.

Acceptance bar: scripted test runs to completion in ~5s with the active list correctly populating and emptying; all unit tests pass; zero diff in `server/events/notifications.ts`.

### PR 3 — Debug-side UX prototype (new engine runs parallel to legacy)

Builds the new bell UX on the dev-mode debug surface (next to the bell, gated by `VITE_DEV_MODE`) **without touching the legacy `publishNotification()` path**. The existing bell, toast, and `notifications` pubsub channel keep firing as today; the new engine's UX runs in parallel. The goal is to validate the layout, badge semantics, row affordances, and history flow before committing to the migration in PR 4.

**Engine** (`server/notifier/`)

- Add `~/mulmoclaude/data/notifier/history.json` — single JSON file holding an array of terminated entries, capped at 50, FIFO eviction. Each entry = the original `NotifierEntry` + `terminalType: "cleared" | "cancelled"` + `terminalAt: ISO`. New API: `listHistory()`.
- `clear` and `cancel` push to history *before* removing from active. Two `writeFileAtomic` calls per terminal mutation, sequential within the existing waiter-queue drain. History persistence is best-effort — if its write fails, the active write still wins and the failure is logged.
- Add an optional `navigateTarget?: string` field on `NotifierEntry` (relative URL). The engine doesn't read it; the popup reads it to decide whether a row is clickable and where to route on click.

**Plugin runtime extension** (server-side)

- `runtime.notifier.publish(input)` — `pluginPkg` auto-bound to the plugin's pkg name (mirrors how `runtime.pubsub.publish` is hard-scoped to `plugin:<pkg>:*`). Plugins cannot impersonate each other.
- `runtime.notifier.clear(id)` — proxies through to the engine.
- Type lives MulmoClaude-internal; plugin authors cast `(runtime as MulmoclaudeRuntime).notifier`. Once the API stabilises it can move into `gui-chat-protocol`.

**Debug button popup** (`NotifierDebugPopup.vue` — full rewrite)

- Replaces the PR 2 scripted-test panel. Implements the layout + row behaviours from `feat-notifier-ux.md`: Active section on top, History section below, single scroll, no tabs.
- Active rows share one layout (severity dot + title/body/meta + trailing `×`). fyi: body click no-ops; `×` clears. action: body click navigates (`router.push` to `navigateTarget` with `&notificationId=<uuid>` appended); `×` cancels.
- Two `action`-publish rules are rejected at the engine and HTTP-route boundaries (defended in depth so plugin-runtime callers and HTTP callers hit the same wall): `action` requires a non-empty `navigateTarget`, and `action` cannot use `info` severity.
- History rows: read-only with `✓` / `✗` markers. Rows with `navigateTarget` re-route on click.
- Empty states: "No active notifications" / "No recent activity".
- Badge stays as in PR 2 (count + worst-severity color + `99+` cap).
- The "Run scripted test" button is removed (its job moves to the debug page).

**Debug page** (`@mulmoclaude/debug-plugin` `View.vue`)

- Replaces the placeholder. Three modes, branched on URL query:
  - Default (`/debug`): button panel — buttons that fire individual scenarios (`fyi` / `action` × `info` / `nudge` / `urgent`, plus a "Fire mixed batch" and "Clear all" helper). Each button calls `runtime.dispatch({kind: "publish", input})`; the plugin's server handler proxies to `runtime.notifier.publish`.
  - `/debug?mode=auto-clear&notificationId=<uuid>`: auto-clears the notification on mount via `runtime.dispatch({kind: "clear", id})`. Renders a "Cleared on open" confirmation. Tests the read-once pattern (notification clears just by visiting the target).
  - `/debug?mode=manual-clear&notificationId=<uuid>`: renders a "Done" button; clicking it calls `runtime.dispatch({kind: "clear", id})`. Tests the action-completion pattern (notification clears only after the user explicitly acts).
- Two of the default-mode buttons publish action notifications targeting these modes:
  - "Fire action (clears on open)" → `navigateTarget: "/debug?mode=auto-clear"`
  - "Fire action (clears on Done)" → `navigateTarget: "/debug?mode=manual-clear"`

**HTTP route** — add `listHistory` action to the existing `/api/notifier` dispatch.

**Test coverage** — engine unit tests extend with: history append on clear/cancel, capped at 50 (FIFO), `listHistory` returns newest-first, history persistence round-trip via tmp dir, `navigateTarget` field round-trips through publish/list. Manual: drive the debug page buttons; verify the popup's Active and History sections update live; verify both hyperlink scenarios clear correctly.

**Acceptance bar** — every button on the debug page produces the expected entry in the popup's Active section; clicking either hyperlink scenario opens `/debug` and clears the entry per its mode (immediately or on Done); cleared / cancelled entries appear in History capped at 50; zero diff in `server/events/notifications.ts`.

**Out of scope** — all of these stay for PR 4: legacy `publishNotification()` migration, timers / snooze / escalation, bridge / macOS adapters, bell replacement.

### PR 4 — Legacy migration onto the prototype engine

Migrate the existing `publishNotification()` callers and the bell UI to run on the engine shipped in PRs 2 + 3. **No new engine features** — `firesAt` / timers, full state machine (`delivered` / `seen` / `acted` separations), snooze, `signal()`, re-surface, and the severity → channel routing config are all deferred. Encore (PRs 5 + 6) will pull in whichever it needs; the discovery happens there, driven by real domain requirements.

**Wrapper.** `publishNotification()` becomes a thin wrapper over `notifier.publish({ lifecycle: "fyi", ... })`, mapping the old `NotificationKind` source category to a synthetic `pluginPkg` (`todo` / `scheduler` / `agent` / `journal` keep their names; `push` / `bridge` / `system` collapse under `"host"`). The optional caller-supplied `id` and `i18n` payload pass through unchanged. All current callers (`server/agent/mcp-tools/notify.ts`, `server/api/routes/notifications.ts`, `server/workspace/sources/pipeline/notify.ts`, `server/plugins/diagnostics.ts`, plus the route file's PoC endpoint) keep working with no source changes.

**`publishNotification` is host-only by convention.** All plugin code (anything under `packages/*-plugin/`) MUST use `runtime.notifier.publish` (per-plugin `pluginPkg` auto-binding, no impersonation). The wrapper exists strictly for host-side callers that don't have a `PluginRuntime`. Comment to that effect already lives on the function in `server/events/notifications.ts`.

**Bell.** `NotificationBell.vue` re-renders from the new engine, replacing — not running parallel to — the legacy bell. Layout copies the debug popup from PR 3: Active section on top, History below, single scroll, no tabs. Badge: pending count, worst-severity color (gray / amber / red), `99+` cap. fyi rows: trailing `×` calls `clear`. The `[notification-badge]` testid stays so existing E2E selectors keep resolving.

**Adapters.** Bridge push (`chat-service.pushToBridge`) and macOS Reminder push relocate from inline calls inside `publishNotification()` to small adapters that subscribe to the new `notifier` pub/sub channel. **No severity-based routing** — adapters keep the gating they had before (env-flag for macOS, etc.) and ignore the `severity` field for now. The field is on the entry waiting to be read once a real use case demands routing.

**Removed.** `NotificationToast.vue`, the legacy in-memory "last 50" store, and the legacy `notifications` pub/sub channel are all deleted.

**Test coverage.** Equivalence tests for each legacy caller (an entry through the wrapper appears in Active with the right `pluginPkg` / `lifecycle` / `i18n` and lands in History on ack). Playwright E2E driving the production bell panel through the Active + History flows.

**Acceptance bar.** Every existing `publishNotification()` call site fires; the user acks from the Active section; cleared entries appear in History capped at 50; the legacy toast no longer appears; bridge and macOS adapters continue to fire as they did before.

### PR 5 — Encore plugin (CRUD only, no reminders)

Plugin scaffold: `meta.ts`, `definition.ts`, `index.ts`, `View.vue`, `Preview.vue`. Server: `server/encore/` with file IO + `manageEncore` actions for obligation CRUD, `openInstance`, `addItem` / `updateItem` / `removeItem`, `diffFromLast`. Standalone `/encore` route. **No notifier integration yet** — proves the data model (including multi-item instances) works in isolation.

### PR 6 — Encore × Notifier integration

Encore translates obligation + item state into Notifier calls. Both lifecycles get exercised: `fyi` for "instance opened" confirmations and post-completion summaries, `action` for "pay H2 property tax" / "diff-from-last is ready" — anything where the user needs to land on Encore's view to act. Wire `notifier.clear()` on `closeInstance` / `updateItem(status: done)` / Encore's view mount (for read-once notifications). The "magnetic feature" demo: open an instance, see last year's data pre-populated, see the next-action reminder already scheduled.

**This PR is also where the engine grows the features Encore actually needs**, scoped concretely by what falls out of the implementation rather than pre-spec'd at the system level. Likely candidates from the Part 1 spec — `firesAt` / scheduling, snooze, `signal()` for "remind me when W-2 arrives," progress-aware re-surface, severity → channel routing — but each one only lands if Encore can't be coherent without it. Expect this PR to split if the surface ends up large; the split point is whichever feature can ship independently (e.g. `firesAt` first, `signal()` later when an obligation type actually needs it).

---

## Open questions

PR 1 resolved: client-only `VITE_DEV_MODE` flag, no server-side mirror, no runtime endpoint.

PR 2 (Notifier prototype) resolved during design discussion:

- API surface stripped to `publish` / `clear` / `cancel` / `get` / `listFor` / `listAll` (no `markSeen` / `acknowledge` — `clear` is the single "user dealt with it" verb).
- Persistence is a single `active.json` holding only active entries (not append-only) — bounded size, simple to read.
- Write serialization uses an in-memory `writing` flag + waiter queue that drains until empty, coalescing N rapid mutations into ≤2 disk writes.
- Multiple `pluginPkg` values (`debug__system`, `debug__news`, `debug__encore`, …) drive the scripted test so namespace separation is visible.
- HTTP shape is dispatch (`POST /api/notifier` with `action` field), matching `manage*` tools.
- Debug page subscribes to the new `notifier` pub/sub channel for live updates; no manual publish/clear forms.
- Pub/sub granularity: single global `notifier` channel (option A). Per-`pluginPkg` channels and dual-emit (global + per-pluginPkg) considered and rejected for v1 — debug page and the future bell badge both want global view; per-plugin client-side filtering is cheap.

UX decisions for the migration are recorded in [`feat-notifier-ux.md`](feat-notifier-ux.md). A summary of the resolved ones:

- Two lifecycles: `fyi` (host acks) and `action` (plugin clears, `×` cancels). `read` collapsed into `action`.
- Bell panel: Active section on top, History section below, single scroll, no tabs.
- Bell badge: pending count, worst-severity color (gray / amber / red), `99+` cap.
- History capped at 50 entries, FIFO eviction.
- No toast in v1 — the badge color is the at-a-distance signal.
- Pub/sub granularity: single global `notifier` channel; per-`pluginPkg` rejected.

Deferred to PR 6 (engine features, only if Encore demands them):

1. **Declarative vs imperative scheduling.** Earlier draft was *imperative* — plugin computes each fire time and re-registers. A declarative spec ("every Sunday until acked, escalate after 2 weeks") is more powerful but a bigger surface. Imperative matches how `task-scheduler` already works; declarative may be worth it once we see 3+ plugins repeating the same pattern. **Default if/when timers land: imperative.**
2. **Severity → channel mapping config UI.** Hidden file (`config/notifier.json`) first, settings page later? **Default if/when routing lands: hidden file, settings UI as a follow-up.**
3. **Re-surface cap.** A reminder ignored for a week should not fire 50 times. **Default if/when re-surface lands: re-surface only at the explicit `escalateAt` points; no auto-multiplication.**
4. ~~**Signal namespace.**~~ Resolved by the identity model: signals are structurally scoped as `{ pluginPkg, key }`, so collisions across plugins are impossible by construction. No string-prefix convention to enforce.
5. **Pending UX details** from `feat-notifier-ux.md`: empty-History text, undo for accidental ack, badge flash on new urgent. Each is small enough to land with a default and revise by feel — fold into PR 4 as they come up.
6. **Conflict with `task-scheduler`.** The existing scheduler also fires things on a schedule. Notifier is *user-facing reminders*; scheduler is *task execution*. They may share scheduling primitives internally; they should not share API surfaces. **Default if/when timers land: keep them separate; revisit if duplication becomes painful.**

To resolve before PR 5 (Encore CRUD):

7. **i18n surface for Encore.** All 8 locales need the obligation-type vocabulary ("taxes", "registration", "annual physical"). Are these built-in templates the user picks from, or free-form titles the user types? **Default: free-form for v1, suggested templates as a chat-side affordance.**

---

## Non-goals (Encore v1)

- Sharing obligations across multiple users (gift lists with spouse, etc.). Local-first; multi-user is a separate problem.
- Importing from Google Calendar / iCal. Manual creation only.
- Auto-detecting recurring obligations from email or documents.
- Financial integration (paying the tax bill from Encore). Encore *tracks*; payment lives elsewhere.

These are all defensible v2 features; explicitly out of scope so v1 stays shippable.
