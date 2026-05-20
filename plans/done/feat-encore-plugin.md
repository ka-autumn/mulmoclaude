# Plan: Encore plugin (Phase 2)

> **Status: design draft — discussion ongoing.** Phase 1 (`plans/done/feat-plugin-runtime-tasks-chat.md`, merged in PR #1237) shipped the host primitives Encore depends on. This doc captures the architecture (DSL + compiler + runtime) and the design decisions made so far. **A few items remain open** (see [Design decisions → Still open](#still-open)) and need direction before implementation starts.

Companion to:

- [`feat-encore-vision.md`](./feat-encore-vision.md) — the UX-and-why doc. The shape of the experience we're building.
- [`done/feat-plugin-runtime-tasks-chat.md`](./done/feat-plugin-runtime-tasks-chat.md) — the runtime APIs Encore consumes.

## Architecture: DSL + compiler + runtime

**Encore is a small DSL plus an interpreter.** That's the whole architecture, and everything else in this doc derives from it.

- **The DSL.** A schema describing the shape of a recurring obligation: cadence, form fields, firing plan (when notifications fire and how their severity escalates), conditional triggers, carry-forward rules between cycles. Encore ships this schema as its stable contract.
- **Claude is the compiler.** It reads the user's natural-language description ("I need to pay property tax for my second home twice a year") and emits a valid DSL document for the obligation.
- **Encore is the runtime.** It validates the DSL on receipt, persists it as the obligation's `index.md` frontmatter, and *interprets* it: the tick fires notifications, escalates severity, seeds chats, and provisions next cycles based on what the DSL says.
- **The MCP tool surface (`setup` / `amendDefinition` / `markInstanceState` / `query` / `snooze` / etc.) is thin transport** — verbs that move DSL documents and state signals between compiler and runtime. The substance lives in the DSL.

Read the rest of this doc through that lens. The "Encore DSL" subsection below specifies the schema; the data model, MCP surface, tick logic, setup/closing flows, and View.vue all derive from it.

## Goal

Ship `packages/encore-plugin/` (`@mulmoclaude/encore-plugin`) — a runtime plugin that turns Encore's vision into a working surface inside MulmoClaude. By the end of Phase 2 a user can:

- Describe an obligation in chat ("I need to pay property tax for my second home twice a year"), have Claude open a small form via `presentForm`, fill three or four fields, and walk away.
- Get a notification at the right cadence (state-aware, not just date-aware) — the plugin's tick fires `runtime.notifier.publish` action notifications.
- Click the notification → land in a Claude-seeded chat that asks the right question, with last year's instance already on the page.
- Tell Claude "yes, paid it" → Claude calls the plugin's MCP tool → the obligation's instance is marked done, the notification clears, next year's instance is silently provisioned.
- Open the Encore page directly to browse obligations and review past years.

## What Phase 1 gives us

All of these are available on `MulmoclaudeRuntime` today and can be cast-imported into the plugin (`runtime as MulmoclaudeRuntime`):

| Primitive | Use in Encore |
|---|---|
| `runtime.tasks.register({ schedule, run })` | One master heartbeat. Scans every obligation, decides what reminders to fire, what new instances to provision |
| `runtime.chat.start({ initialMessage, role? })` | Open Claude-seeded chats for the conditional-trigger and reminder flows ("did you receive your W-2?", "did you pay property tax?"). Returns `{ chatId }` |
| `runtime.notifier.publish({ severity, lifecycle, title, body, navigateTarget })` | Bell notifications. `lifecycle: "action"` + `navigateTarget: "/chat/<chatId>"` lands the user in the seeded chat |
| `runtime.notifier.clear(id)` | Plugin-scoped clear. Called from the MCP tool handler when the obligation advances |
| `runtime.files.data.read/write/...` | Plugin-scoped FS at `~/mulmoclaude/data/plugins/@mulmoclaude/encore-plugin/`. Where every obligation file lives |
| **LLM-driven clear pattern** (pending-clear ticket on disk) | When the plugin posts a notification + seeds a chat, it stores `pending-clear/<pendingId>.json = { notificationId }` and embeds the pendingId in the seed prompt. Claude calls Encore's MCP tool with the pendingId; the tool reads the ticket, clears the notification, advances state. Survives reboot |
| Plugin-seeded chat marker (chip + muted bg) | The first user turn of a `chat.start`-seeded session renders with `from @mulmoclaude/encore-plugin` chip — no extra plumbing in Encore |
| `presentForm` plugin (existing) | The setup-by-saying surface — Claude calls `presentForm` to render the obligation form inline in chat |

Encore does NOT need any new host extensions. Phase 3 (gui-chat-protocol upstream) is independent and can land in parallel without blocking Encore.

## Encore-specific design

### The Encore DSL

The DSL is the central artifact. Get this right and the rest follows; get it wrong and every other piece of the architecture fights it.

#### Top-level shape

Stored in each obligation's `index.md` frontmatter:

```yaml
version: 1                      # DSL version, for future migrations
id: property-tax-second-home    # Encore-generated: slugified from displayName at setup
displayName: "Property tax — second home"
status: active                  # active | paused | retired
createdAt: 2026-05-08T15:32:00Z # Encore-generated: receipt timestamp at setup

cadence:                        # cycle granularity (resolved #1)
  type: biannual
  months: [3, 9]

formSchema:                     # Claude-composed input grammar (resolved #2)
  fields:
    - name: address
      type: string
      label: "Property address"
    - name: paymentPortalUrl
      type: url
      label: "Payment portal"

setupValues:                    # obligation-level constants (filled at setup)
  address: "123 Lakeshore Dr"
  paymentPortalUrl: "https://example-county.gov/pay"

firingPlan:                     # notification timing + severity escalation
  - at: deadline-21d
    severity: info
  - at: deadline-3d
    severity: warning
  - at: deadline+1d
    severity: urgent

conditionalTrigger:             # optional, for W-2-style obligations
  when: schedule:2026-02-01
  expectedFields: [received, receivedOn]

carryForward:                   # which fields propagate at next-cycle provisioning
  - field: address
    when: always
  - field: paymentPortalUrl
    when: always
```

The body of `index.md` holds free-form notes the user wants to read again next year ("the portal logs you out after 10 minutes — have your account number ready").

#### The `at` expression grammar

A small string-DSL within the DSL, used in `firingPlan[].at` and `conditionalTrigger.when`:

- `deadline-21d` / `deadline+1d` — relative to the cycle's deadline (days)
- `cycle-start+30d` — relative to the cycle's start
- `schedule:2026-02-01` — absolute date
- `trigger+7d` — relative to the conditional trigger being satisfied (only valid in post-trigger firing plans)

#### Validation

Encore validates DSL with Zod on every `setup` / `amendDefinition` call. Invalid DSL → `manageEncore` returns an error with the offending field path; Claude corrects and retries. Encore never persists invalid DSL.

#### Versioning

Every obligation has `version: <n>`. v1 ships as the initial schema. Future schema changes ship migration code; old obligations stay readable.

#### What's NOT in the DSL

- **Per-cycle execution state** — `<year>.md` / `<year>-h1.md` holds: `cycleId`, `status` (open/closed/skipped), `deadline`, `activeNotificationId`, `nextFireDate`, the per-cycle form values (paid-on date, recipient marks, etc.).
- **Pending-clear tickets** — transient handoff state, lives in `pending-clear/<pendingId>.json`.

The DSL is the *definition*; cycle files and pending-clear hold the *state*.

#### Ownership: Encore reads, Claude writes

After creation, `index.md` is owned by Claude. Encore reads it on every tick to drive its interpretation; **Encore never authors updates on its own**. All updates to `index.md` flow through MCP actions Claude can invoke:

| Action | What it changes |
|---|---|
| `setup` | Initial creation — writes the full DSL + body |
| `amendDefinition` | Any DSL field — `cadence`, `firingPlan`, `formSchema`, `carryForward`, `status` (active → paused → retired), etc. Validated with Zod, partial-update semantics |
| `appendNote` (obligation-scope) | Appends free-form text to the body — the place to record "the portal logs you out at 10 minutes" wisdom |

Everything else Encore does — firing notifications, escalating severity, provisioning new cycles — touches **cycle files** and **pending-clear tickets**, not `index.md`. State changes never touch the definition.

**The one exception** is **DSL schema migrations**. When a future Encore release bumps `version: 1` → `version: 2`, Encore deterministically rewrites old obligations into the new shape. This runs once at startup when a version mismatch is detected, not on tick. It's an upgrade path, not a runtime update.

### Data model

**One folder per obligation, multiple files inside it.** This matches the vision doc's "files in folders" / "memory across instances" framing: the obligation has a long-lived identity, each year is the next page of the story.

Proposed layout under `~/mulmoclaude/data/plugins/@mulmoclaude/encore-plugin/`:

```text
obligations/
  property-tax-second-home/
    index.md                 ← obligation definition (frontmatter + free-form description)
    2025.md                  ← last year's instance (closed)
    2026-h1.md               ← current open instance
    2026-h2.md               ← (provisioned automatically when 2026-h1 closes)
  christmas-cards/
    index.md
    2024.md                  ← per-recipient list lives in the body as a checkable markdown list
    2025.md
    2026.md                  ← current
  annual-physical/
    index.md
    2024.md
    2025.md
pending-clear/               ← ticket files for the LLM-clear pattern (Phase 1)
  <pendingId>.json
```

**`index.md` is the DSL document for the obligation** — its frontmatter is the validated DSL specified above, its body is free-form notes. Per-cycle files (`<year>.md` / `<year>-h1.md`) hold execution state for one run of that program: `cycleId`, `status` (open/closed/skipped), `deadline`, `activeNotificationId`, `nextFireDate`, and the per-cycle values for the form fields the DSL declared (paid-on date, recipient marks, etc.) — plus any free-form notes added later. Per-cycle filenames derive deterministically from the DSL's `cadence` rule (annual → `<year>.md`, biannual → `<year>-h1.md` / `<year>-h2.md`).

**Why markdown-with-frontmatter, not JSON:**
- Matches `data/wiki/`, `data/todos/`, the journal — already the in-tree convention for "files are the database"
- Free-form notes go in the body where the user can read / edit them outside the app (the local-first promise)
- Diff between years is markdown-line diff, easily summarisable by Claude

### MCP tool surface

The MCP tool surface is **thin transport for the DSL** — verbs that move DSL documents and state signals between Claude (compiler) and Encore (runtime). One MCP tool, `manageEncore`, with a discriminated `kind` (matches debug-plugin / bookmarks-plugin convention). LLM-callable actions only — internal browser dispatch actions (used by the Encore page UI) are NOT exposed in `TOOL_DEFINITION`.

Proposed actions (LLM-visible):

| `kind` | Purpose |
|---|---|
| `setup` | Create a new obligation. Claude passes a complete DSL document (without `id` / `createdAt` — Encore generates those: `id` is slugified from `displayName`, `createdAt` is the receipt timestamp) plus the values the user filled at setup. Args: `{ definition: <DSL>, setupValues }`. Encore validates the DSL with Zod, rejects on failure |
| `amendDefinition` | Replace any portion of an obligation's DSL mid-life — Claude can adjust the form schema (track new fields), the firing plan (start nudging earlier this year), the carry-forward rules (skip the Watsons until address), etc. Args: `{ obligationId, definition: <partial DSL> }`. **Merge semantics: shallow at the top level, full-replacement for arrays** — to change one phase of `firingPlan`, Claude sends the entire new `firingPlan` array (no per-element merging by index). Existing per-cycle values for removed fields stay as orphan frontmatter — never destroyed by Encore |
| `markInstanceState` | Advance an instance ("paid", "skipped", "received", "done"). Optional notes. Calls `notifier.clear()` for the source notification via the LLM-clear pending ticket |
| `recordResponse` | Generic structured-response handler for conditional-trigger flows (e.g. W-2). Accepts a JSON payload Claude built from the conversation; the plugin merges it into the cycle's frontmatter |
| `query` | Read-side. Returns the relevant cycle files (last cycle, this cycle, optionally earlier). Claude composes the diff / summary / multi-year trend on every call — no precomputation, no cache |
| `appendNote` | Append free-form notes to a body — a Claude-written summary, a closing note, obligation-level wisdom. Args: `{ obligationId, instanceId?, body }` — omit `instanceId` to append to the obligation's `index.md` body; include it to append to that cycle's body. Persistence is a deliberate user act, not automatic |
| `snooze` | Clear the currently-active notification on an instance and set a new `nextFireDate` on its frontmatter. The next tick after that date fires a fresh notification — severity determined by current phase of the firing plan, not by what level it was at when snoozed. Args: `{ obligationId, instanceId, until }` |

Each action takes `pendingId` when it's the resolution of a notification-seeded chat — the handler reads `pending-clear/<pendingId>.json` and calls `notifier.clear()` as a side effect.

### Tick logic (the DSL interpreter)

The tick is a small interpreter for each obligation's DSL. Single hourly heartbeat (`runtime.tasks.register({ schedule: { type: "interval", intervalMs: 60 * 60 * 1000 }, run })`) — no time-of-day filtering for v1 (in-app bell semantics make 03:00 firing harmless; the user sees notifications when they next open MulmoClaude).

Each tick, for every obligation:

1. List `obligations/*/index.md`, parse + revalidate the DSL.
2. Identify the currently-open cycle (provisioning happens synchronously on close, not on tick).
3. Compute the current phase from the cycle's `deadline` + the DSL's `firingPlan` + current time.
4. **If `activeNotificationId` is null:**
   - If we're past the first phase's `at` → fire at **the current phase's severity** (not the first phase's — if the user was offline past `deadline+1d`, the first tick after startup must fire at `urgent` directly, not catch up through `info` → `warning`). Seed a chat with the relevant subset of the DSL's `formSchema` in the seed prompt + a fresh `pendingId`, write the pending-clear ticket, set `activeNotificationId` and `navigateTarget: /chat/<chatId>`
   - Else → wait
5. **If `activeNotificationId` is set:**
   - If the current phase's severity differs from the active notification's → escalate (`notifier.clear()` + `notifier.publish()` with the new severity, referencing the same `chatId` and same pending-clear ticket — Phase 1 doesn't expose `notifier.update()`)
   - Else → skip; the user owns the notification until they acknowledge or snooze

The tick is **idempotent and crash-safe**: every state transition is a write to disk; a tick that crashes mid-loop loses nothing because the next tick re-evaluates from current disk state.

**Strict separation of concerns.** The tick fires/escalates notifications based on *time* — that's all. Provisioning of new cycles happens synchronously when `markInstanceState` closes the previous cycle (not on tick). Acknowledge / snooze / skip are user actions that flow through the MCP surface. The tick never invokes Claude.

### Setup flow (chat-driven)

1. User says "I need to pay real estate tax for my second home, twice a year" in any chat
2. Claude (the agent itself, no Encore code) decides this is an Encore-shaped statement and **composes a complete DSL document for the obligation** — `cadence`, `formSchema`, `firingPlan`, `carryForward`, `conditionalTrigger` if relevant. Claude calls `presentForm` with the just-composed `formSchema` to gather the user's setup values (address, payment portal URL, etc.)
3. User fills the form
4. Claude calls `manageEncore({ kind: "setup", definition, setupValues })` — passing the complete DSL (without `id` / `createdAt` — Encore generates those server-side) plus the values
5. Encore validates the DSL with Zod (rejects on failure → Claude corrects and retries), generates `id` (slugified from `displayName`) and `createdAt` (receipt timestamp), then writes `obligations/<id>/index.md` with the full DSL in frontmatter + free-form notes in the body
6. Claude tells the user "set up — first reminder ~3 weeks before March 15"

**Schema replay.** When Encore seeds a chat for a later flow (reminder, conditional check-in), it embeds the stored DSL's `formSchema` — or a state-relevant subset — in the seed prompt. Claude reads the seed and renders the form via `presentForm`. Subset selection is plugin code: "nudge before deadline" → ask about progress; "deadline reached" → ask about completion. The form on March 15 looks like the form at setup because it *is* the same schema.

**DSL amendment.** When the obligation evolves over time (user wants to track receipt-photo, change firing schedule, skip a recipient), Claude calls `manageEncore({ kind: "amendDefinition", ... })` to update the relevant DSL fields. Same mechanism as setup — Claude composes, Encore validates, Encore persists.

### Closing / carry-forward flow

When an instance closes (Claude calls `markInstanceState` with terminal state, or user marks it via the page):

1. Update the closing cycle's frontmatter with closed status + closed-at timestamp
2. **(Optional)** the user can ask Claude to write a closing summary; Claude appends it via `appendNote`. No automatic prose persistence — same principle as the diff
3. **Provision the next cycle's instance file** — created from the DSL's `cadence`, with frontmatter pre-populated from the DSL's `carryForward` rules (each entry: which field, when to copy, optional filter). Body is empty or a stub — **no prose summary is precomputed**
4. The tick will pick up the new open cycle and start firing notifications per the DSL's `firingPlan`

**Carry-forward is DSL data, not hardcoded behavior.** The DSL's `carryForward` field declares what to copy and how to filter; the executor (plugin code) interprets those rules deterministically. Claude composes the rules at setup; the user can amend them via `amendDefinition` ("actually skip the Watsons until address" / "always copy last year's CPA email"). The "what's different from last year" prose is generated lazily by Claude every time it's asked — the plugin doesn't precompute or cache it.

### View.vue / Preview.vue

- **`View.vue`** — the Encore page. Two surfaces:
  - List view: every obligation, its current open instance, a glanceable status (next reminder, days until deadline)
  - Detail view: clicked obligation. Last cycle's instance side-by-side with this cycle's. Free-form notes inline, structured frontmatter as a small sidebar. **The "what's different" summary streams from Claude on each open** (View calls `manageEncore({ kind: "query" })`, then asks Claude inline) — not persisted, always fresh
- **`Preview.vue`** — when Claude returns a tool result Encore renders the plugin card. e.g. `setup` → "Obligation X created, next reminder Y", `markInstanceState` → "Instance closed, next cycle's open".

UI strings via i18n in all 8 locales. Plugin-seeded chat chip already handled by Phase 1 (no Encore code).

## Design decisions

### Resolved

1. **Per-cycle file granularity, cadence rule is source of truth.** Each natural cycle gets its own file. Cycle ID derives deterministically from the DSL's `cadence`, not from setup-time natural language. Annual → `<year>.md`, biannual → `<year>-h1.md` / `<year>-h2.md`. Reasoning: forcing two cycles into one file dilutes the vision doc's thesis that each instance has memory of itself.

2. **Form schema is Claude-composed per obligation, Encore-persisted.** No upfront templates owned by Encore. Claude composes the `formSchema` (and the rest of the DSL) at setup; Encore stores it in `index.md`; replays it (or a state-relevant subset) when seeding later chats. `manageEncore({ kind: "amendDefinition", ... })` lets Claude evolve the DSL mid-life. Reasoning: the shape emerges from what was said — matches the vision doc's "the system picks the shape; you provide the content."

3. **Fully lazy diff, no precomputation, no cache.** No `diff.md`, no first-view fill-and-persist. `manageEncore({ kind: "query", ... })` returns the relevant cycle files; Claude composes the diff / summary / multi-year trend on every call. Provisioning is structural-only — body is empty or a stub. Persistence of any Claude-generated summary is a deliberate user act via `appendNote`. Reasoning: lean harder on Claude — these obligations are rarely-visited, prompt-cache will likely hit, and stale-cache invalidation is its own problem.

4. **Conditional triggers ride the unified notification mechanism — no separate UI.** "Remind me when the W-2 arrives" is just a notification whose firing rule is "wait for date X" instead of "wait for deadline minus 21d." The user clears it the same way they clear any notification: by saying it in chat, by saying it in the seeded chat the notification points to, or by clicking the state-transition button on the page. All three paths converge on the same MCP-action handler.

5. **One active notification per cycle, fire once, persist until user-cleared.** No automatic repeat firing. A notification stays in the bell until the user (a) acknowledges it (`markInstanceState` / `recordResponse`), (b) snoozes it (`snooze` clears + sets new `nextFireDate`), or (c) skips the cycle. Dedup is structural: the tick checks `activeNotificationId` on the cycle's frontmatter and won't fire while it's set.

6. **Severity escalation via `firingPlan` in the DSL.** Notifications have three severity levels (`info` / `warning` / `urgent`). The DSL's `firingPlan` declares phases — `[{ at: deadline-21d, severity: info }, { at: deadline-3d, severity: warning }, { at: deadline+1d, severity: urgent }]`. Claude composes this at setup based on the obligation's character; the user can amend via `amendDefinition`. Encore implements escalation as `notifier.clear()` + `notifier.publish()` with the new severity (referencing the same chat / pending-clear ticket), since Phase 1 doesn't expose `notifier.update()`.

7. **Hourly tick, no time-of-day filter, no in-tick LLM calls.** In-app bell semantics: a notification fired at 02:00 sits in the bell until the user opens MulmoClaude, so firing time of day doesn't matter. Provisioning happens synchronously on close (not on tick) — clean separation between time-driven (firing/escalation) and event-driven (state transitions) work. Push / desktop notifications are out of scope for v1; if/when added, daily-at-preferred-hour becomes the natural answer.

### Still open

1. **Storage of pending-clear tickets.** Phase 1's debug-plugin uses `pending-clear/<pendingId>.json` directly under `data/plugins/<pkg>/`. For Encore, group under `obligations/<id>/pending/<pendingId>.json` so a deleted obligation cleans up its tickets? Or keep flat? My lean: flat under `pending-clear/` — keeps the tick scan simple; orphan tickets are pruned on a separate sweep.

2. **DSL spec details to settle before implementation.**
   - **`at` expression grammar.** Sketched above (`deadline-21d`, `schedule:2026-02-01`, etc.) — needs a formal parser and tests.
   - **Zod schema shape.** TypeScript-native validation; needs to match exactly what Claude is taught to emit.
   - **The teaching prompt** (the host's `prompt` field on `TOOL_DEFINITION`). The vision doc's "Claude — powered by Claude Code beneath MulmoClaude — recognizes the shape of what you said" depends on this. Worth iterating on with real test conversations once the rest is shipped — possibly with a dedicated eval harness.

## Sub-phases (suggested implementation order within Phase 2)

To keep the PRs reviewable, suggest splitting Phase 2 into three landings:

| Sub-phase | Scope | Reviewable size |
|---|---|---|
| 2.1 — DSL + Skeleton + setup | Plugin scaffolding (`packages/encore-plugin/`, `package.json`, build). **DSL Zod schema + validator** (the foundational artifact). `manageEncore({ kind: "setup", "amendDefinition" })` + obligation file write with DSL validation. `View.vue` list-only. Tick handler that exists but does nothing (no firing yet). i18n strings | Medium — lands the plugin and the DSL |
| 2.2 — Tick interpreter + reminders + LLM-clear | Tick interprets `firingPlan`: fires notification at first phase, escalates severity at later phases. `chat.start` seed prompts include relevant `formSchema` subset. LLM-clear via `manageEncore({ kind: "markInstanceState" / "recordResponse", pendingId })`. `snooze` action | Medium |
| 2.3 — Per-cycle pages + carry-forward + diff | `View.vue` detail surface (last cycle vs. this cycle, streaming Claude-generated diff via `query`). Closing flow → next-cycle provisioning driven by DSL's `carryForward` field. `Preview.vue` cards. `appendNote` action | Medium |

Each sub-phase is independently shippable: 2.1 alone gives the user "I can describe an obligation in chat and it gets stored"; 2.2 adds "I get reminded at the right time"; 2.3 adds "the page is genuinely useful for browsing."

## Out of scope (for all of Phase 2)

- **Multi-user / sync.** Local-only. The carry-forward across MulmoClaude instances is solved by the workspace already being on the user's filesystem.
- **External calendar integration.** No iCal export, no Google Calendar push. The reminders ride MulmoClaude's notification surface only.
- **Image OCR / document parsing.** When Claude asks the user for a W-2 photo and gets one, the photo's path is recorded in the instance — no auto-extraction. Future enhancement.
- **Encrypted obligations.** Tax docs / medical history sit in the workspace as plain markdown, same as everything else. Filesystem-level encryption is the user's concern.
- **`gui-chat-protocol@0.4.0` upstream.** Phase 3, can land in parallel with or after Phase 2.

## Test plan (anticipated)

- **Unit tests** for: obligation file read/write, instance creation rules, reminder evaluation logic, carry-forward defaults
- **Integration tests** that exercise the full tick → notify → seeded chat → tool call → clear flow against a tmpdir workspace (similar pattern to `test/plugins/test_bookmarks_integration.ts`)
- **Manual scenarios** matching the vision doc's three scenes: Christmas cards (fan-out), property tax (multi-step pipeline), W-2 (conditional trigger)
- **i18n coverage** for all new strings in 8 locales

## Follow-ups (out of Phase 2)

- **Phase 3 — `gui-chat-protocol@0.4.0` upstream.** Move `tasks`, `chat`, `notifier` into the protocol; drop the cast across all consumers including encore-plugin.
- **Encore docs.** Once Phase 2 ships, write `docs/encore.md` (user-facing) and a section in `docs/plugin-runtime.md` (the LLM-clear pattern as the canonical example for plugin authors).
- **Voice setup.** "I need to pay property tax twice a year" by voice → presentForm with values pre-populated by transcription.
