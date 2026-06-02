# Plan: time-driven collections — `triggerField` + `spawn` (recurrence)

Follow-up to the collection-completion notification system shipped in
the collections line (`feat-skill-driven-apps`, `feat-collections-actions`,
`feat-present-collection`). Adds **two composable Tier-1 primitives** to the
existing completion-notification mechanism:

1. **`triggerField`** — a per-item *time gate*: an item fires its bell when
   the clock passes a per-item date, not only when it's created.
2. **`spawn`** — *recurrence via host-driven succession*: when an item's
   field reaches a configured value (e.g. `status → paid`), the host
   creates the next item with a forward-advanced trigger date.

Together with the existing carry-forward they compose into a full recurring
obligation — **with no cadence engine and no recurrence-specific state
machine.** Recurrence is an *emergent* property of (predicate-driven
succession + time gate), both implemented as pure, convergent derivations
on the proven completion reconciler.

Both are **Tier-1** on the
["Collections toward Encore"](#relationship-to-the-encore-roadmap) roadmap:
each is self-justifying for a current app (Reminders / Renewals / recurring
payments) *and* together they cover the *periodic* class of recurring
obligations.

## Hard constraint: zero domain-specific host code

Same discipline as every collections primitive. The host learns two generic
concepts — "a field may name a per-record trigger time" and "reaching a
field value spawns the next record" — and holds no reminder / rent /
renewal / domain literals. All meaning lives in `schema.json` and the
records.

---

# Part 1 — `triggerField` (time gate)

## The core idea: time is just another input to an existing pure predicate

Today the firing rule (`server/workspace/collections/notifications.ts:8-12`)
is a pure function of the record on disk:

```text
bell exists  ⟺  completionField set ∧ file exists ∧ value ∉ completionDoneValues
```

Add **one clause and one input** (`now`):

```text
bell exists  ⟺  completionField set ∧ file exists ∧ value ∉ completionDoneValues
                 ∧ (triggerField unset  ∨  now ≥ record[triggerField])      ← new
```

The bell's existence stays a *pure function of (record, now)*. **No "have I
fired yet?" flag is ever stored.** This preserves the convergent-reconciler
property (`notifications.ts:13-17`): every reconcile re-derives desired
state from file + clock, so it stays idempotent and fs.watch's quirks remain
irrelevant.

## Schema addition

One optional top-level field naming a record field, the way
`completionField` / `displayField` already do:

```jsonc
{
  "fields": {
    "id":     { "type": "string", "label": "ID", "primary": true, "required": true },
    "dueOn":  { "type": "date",   "label": "Due on", "required": true },
    "status": { "type": "enum",   "values": ["pending", "paid"], "label": "Status", "required": true }
  },
  "completionField": "status",
  "completionDoneValues": ["paid"],
  "triggerField": "dueOn"            // NEW: record field whose date gates firing
}
```

Rules:

- `triggerField` (optional `string`) names a `date` field in `fields`.
- REQUIRES `completionField` + `completionDoneValues` (without a done value
  the bell has no clear path). Enforced by a Zod refine.
- Absent ⇒ unchanged behaviour (fire on create).

### Lead time (`triggerLeadDays`)

An optional non-negative integer that fires the bell *N days before* the
trigger date — "remind me 10 days before it's due":

```jsonc
{ "triggerField": "dueOn", "triggerLeadDays": 10 }
```

The fire condition becomes `now ≥ (record[triggerField] − triggerLeadDays
days)`. Key properties:

- **Computed, not stored** — the lead is subtracted at evaluation time
  (`isTriggerDue(raw, now, leadDays)` does civil day subtraction via the
  same DST-immune `addDays`), so the predicate stays a pure function of
  `(record, now)` and convergence is preserved.
- **Composes with `spawn` for free** — because the lead is applied at fire
  time rather than baked into a stored date, every recurred cycle fires
  the same number of days before *its own* trigger; `spawn` needs no
  change.
- **Not escalation** — still one bell, one fire, just earlier. The
  scoped-out axis is *graduated* severity over a window (info → warning →
  urgent); a fixed offset doesn't touch that.
- Requires `triggerField` (Zod refine). Default `0` ⇒ fire on the trigger
  date. Days only (a unit variant — "1 month before" — is a deferred
  follow-up, added only if an app needs it).

## Reconciler change (`notifications.ts`)

The decision lives in `reconcileItem` (`:229`). Thread a `now` param
(default `Date.now()`, overridable for tests like the existing `ioOpts`
seam) and add one branch before the final `ensure`:

```ts
// after: if (itemIsDone(schema, item)) { clear; return }
if (schema.triggerField) {
  const at = parseTriggerTime(item[schema.triggerField]);   // null ⇒ unparseable
  if (at === null || now < at) {
    await clearItemNotification(slug, itemId);   // not yet due (or bad value) → no bell
    return;
  }
}
await ensureItemNotification(...);
```

- **Clear-when-not-yet-due is deliberate** — a future trigger removes any
  premature bell; keeps the predicate convergent.
- **Unparseable value ⇒ no bell + `log.warn`** (fail safe, stay debuggable).
- `now` flows `reconcileItem` → `reconcileAllItems` so one consistent clock
  is injected per pass.

## New infrastructure: a wall-clock tick

fs.watch only re-runs the reconciler on **file changes**; crossing a trigger
threshold changes no file. The one new moving part is a **wall-clock tick**
that periodically re-reconciles collections declaring `triggerField`. Model
it on the existing rediscovery interval (`watcher.ts:104` — `setInterval`,
`.unref()`, test-seam'd):

- New interval, default **1 minute**, configurable + `null`-disable'able.
- Each tick: for every watched collection whose schema has `triggerField`
  (skip the rest — no time-dependent state), call
  `reconcileAllItems(slug, schema, dataDir, { now })`.

No new persistence, no scheduler entry. It's the completion reconciler,
re-run on a clock.

## What this gets for free (convergence payoff)

Because firing is derived from `now`, not a stored flag:

- **Missed fires while the server was down** solve themselves — boot runs
  `reconcileAllItems` (`watcher.ts:245`); if `now` is past the trigger and
  the item isn't done, the bell appears. No catch-up bookkeeping.
- **Restart/replay safety** and **trigger-time edits** re-converge for free.

---

# Part 2 — `spawn` (host-driven recurrence)

## The core idea: recurrence is a convergent derivation, not an event

The naive read — "on the `status → paid` *transition*, create the next
item" — is event-shaped and risks double-spawn (fs.watch coalescing, boot
re-reads). Instead, **reconcile on a predicate and derive the successor
purely**:

> Whenever an item satisfies `spawn.when` **and** its deterministically-named
> successor does **not** exist, create the successor as a pure function of
> (source record, rule).

The successor's *id and contents are a deterministic function of the
source*, and creation is **create-if-absent**. So observing `paid` N times
recomputes the identical successor and writes it once — the successor
record's own existence is the "already spawned?" flag. **No extra state; the
system stays convergent**, exactly like the bell logic.

This is self-limiting: an *old* paid item recomputes a successor id that
already exists → no-op. The chain only extends at the tip (the newest paid
item whose successor is absent). The spawned successor is born `pending`, so
it won't spawn again until *it* is paid.

## Schema addition

```jsonc
{
  "completionField": "status",
  "completionDoneValues": ["paid"],
  "triggerField": "dueOn",
  "spawn": {
    "when": { "field": "status", "in": ["paid"] },        // predicate (CollectionWhen, reused)
    "every": { "unit": "month", "interval": 1, "dayOfMonth": 10 },  // advance triggerField
    "carry": ["amount", "payee", "currency"],             // fields copied verbatim
    "set": { "status": "pending" }                        // fields forced on the successor
  }
}
```

- `when` — a `CollectionWhen` (the existing `{ field, in }` shape). Defaults
  to "`completionField` ∈ `completionDoneValues`" if omitted.
- `every` — how to advance the **`triggerField`** date (see
  [Month-boundary arithmetic](#month-boundary-arithmetic)). REQUIRES the
  schema to declare `triggerField`.
- `carry` — record fields copied verbatim onto the successor. Fields not in
  `carry`, not in `set`, and not the trigger/primary keys are dropped (start
  blank).
- `set` — fields forced to fixed values (typically resetting `status` to the
  pending value).
- The successor's `triggerField` is computed (never carried), and its
  `primaryKey` is the deterministic successor id below.

### Deterministic successor id

`successorId = <stem>-<YYYYMMDD of next trigger>` where `<stem>` is the
source primaryKey with a trailing `-\d{8}` stripped if present:

```text
rent           → rent-20260610            (first spawn)
rent-20260610  → rent-20260710            (stem "rent" preserved thereafter)
```

Slug-safe (alphanumeric + hyphen, passes `safeSlugName`), human-readable,
and a pure function of the source + computed date ⇒ dedup-safe. *(Alternative
considered: a schema `idTemplate` — deferred; the suffix rule needs no
config.)*

## Month-boundary arithmetic

The correctness centre of this part — "10th of every month regardless of
month length", and the harder day ≥ 29 case.

`advanceTriggerDate(sourceDate, every)` operates on the **civil (year,
month, day) triple** — *never* by adding milliseconds (30 days ≠ one month;
instant/DST math corrupts civil dates). Day/week adds use UTC epoch
arithmetic (DST-immune), reading back only the civil Y/M/D:

```text
unit "day":   civil-add interval days
unit "week":  civil-add interval*7 days
unit "month"/"year":
  monthsToAdd = interval * (unit === "year" ? 12 : 1)
  total  = (year*12 + (month-1)) + monthsToAdd
  ny     = floor(total / 12)
  nm     = (total % 12) + 1
  anchor = every.dayOfMonth ?? sourceDay            // anchor from the RULE
  nd     = min(anchor, daysInMonth(ny, nm))         // clamp at compute time
  → (ny, nm, nd)
```

Three correctness invariants, each with a test:

1. **Civil math, not millisecond math.** Compute on (Y,M,D); convert to the
   stored date string only at the end.
2. **Anchor lives in the rule, never in the prior concrete date.** "31st of
   every month" → 31, 28/29, 31, 30, 31 … with **no drift**. Chaining from
   the clamped Feb value would stick at 28 forever — the bug this design
   prevents. (For `dayOfMonth ≤ 28`, e.g. the **10th**, no clamp ever
   happens; preserve-source-day is equally safe, so `dayOfMonth` is only
   *required* for correctness when the intended day is ≥ 29.)
3. **Clamp to `daysInMonth(ny, nm)`** — standard, leap-year-aware for Feb.

Optional sentinel: `dayOfMonth: "last"` → always the last day of the target
month (`daysInMonth(ny, nm)`), for "end of every month" obligations — the
dual of the day-31 case. *(Include if cheap; else defer.)*

`interval` yields quarterly (`month`/3), biannual (`month`/6), annual
(`year`/1 or `month`/12) for free.

## Where the spawn runs

A new pure module `server/workspace/collections/spawn.ts`
(`advanceTriggerDate`, `daysInMonth`, `computeSuccessor`) plus
`maybeSpawnSuccessor(slug, schema, dataDir, item, now)` invoked from
`reconcileItem` after the trigger logic:

- Guard: schema has `spawn`; item matches `spawn.when`.
- Compute successor id + contents (pure).
- **Create only if the successor file is absent** (use io's create path, not
  overwrite — protects any user edits to an existing successor).

Loop safety: writing the successor fires an fs event → reconcile of the new
item; it's `pending` with a future trigger ⇒ no bell, no spawn ⇒ terminates.
Re-reconcile of the source ⇒ successor now exists ⇒ no-op.

## Two deliberate asymmetries (document them)

- **Forward-only.** Reverting the source out of `spawn.when` (un-paying)
  does **not** retract an already-created successor. Auto-deleting user
  records is destructive and out of bounds; creating a future reminder is
  benign. The user/Claude deletes an unwanted successor manually.
- **Resurrection.** Because the spawn is convergent (create-if-absent on a
  predicate), deleting the successor *while the source still matches
  `spawn.when`* re-creates it on the next reconcile. **Escape hatch:** move
  the source to a terminal status that is *not* in `spawn.when` (e.g. an
  `archived` value), which stops succession cleanly. Document this as the
  supported "end the recurrence" gesture. *(Optional follow-up: a `spawn.until`
  date that halts succession past a bound.)*

---

## Granularity & timezone (applies to both parts)

`date` fields are date-only. v1 ships **date-granularity**: a stored
`YYYY-MM-DD` is compared as a civil date against today in the **server's
local timezone** (the process clock — `now.getFullYear()/getMonth()/
getDate()`), for both the trigger gate and the spawn arithmetic.

> **Resolved during implementation:** there is *no* separate "workspace
> timezone" source to reuse — Encore and the rest of the app just use the
> process clock (`new Date()` / `toISOString()`). So the gate uses
> server-local civil-date comparison, which sidesteps instant/TZ math
> entirely. The assumption is documented in `spawn.ts` (`isTriggerDue`).
> The help doc and this plan both say "server's local timezone".

**Deferred:** time-of-day precision (a `datetime` field type) — a
parser-only follow-up; the predicate, tick, and spawn logic don't change
when it lands.

## Files touched

| File | Change |
|---|---|
| `server/workspace/collections/types.ts` | `triggerField?: string`; `spawn?: CollectionSpawn` (+ `CollectionSpawn`, `CollectionEvery` types) + doc comments |
| `server/workspace/collections/discovery.ts` | `triggerField` + `triggerLeadDays` + `spawn` in `CollectionSchemaZ`; refines (trigger requires completion + names a date field; lead requires trigger + non-negative int; spawn requires triggerField; `every.dayOfMonth` 1–31 or `"last"`; `interval ≥ 1`) |
| `server/workspace/collections/notifications.ts` | `now` param through `reconcileItem`/`reconcileAllItems`; trigger branch; `parseTriggerTime` |
| `server/workspace/collections/spawn.ts` | **new** — `daysInMonth`, `advanceTriggerDate`, `computeSuccessor`, `maybeSpawnSuccessor` (pure + create-if-absent) |
| `server/workspace/collections/watcher.ts` | wall-clock tick (mirrors rediscovery timer); skip non-time/non-spawn collections; `maybeSpawnSuccessor` reached via `reconcileItem` |
| `server/workspace/collections/io.ts` | confirm/add a create-if-absent write path (no overwrite) for the successor |
| `test/workspace/collections/test_notifications.ts` | trigger fires/not-before/clears-on-done/unparseable/missed-while-down (injected `now`) |
| `test/workspace/collections/test_spawn.ts` | **new** — month/year/week/day advance; day-31 no-drift over Jan→Dec; leap Feb 29; `"last"`; deterministic id; create-if-absent idempotency (spawn twice → one file); chain tip-only; resurrection + escape-hatch |
| `test/workspace/collections/test_discovery.ts` | reject trigger-without-completion, non-date trigger field, spawn-without-trigger, bad `dayOfMonth`/`interval` |
| `docs/developer.md` (collections), `docs/shared-utils.md` | document `triggerField` + `spawn`; catalog `advanceTriggerDate`/`daysInMonth` if shared |

A demo preset (`mc-reminders` or a recurring-rent `mc-*`) is optional and
can be a separate PR.

## Test plan (clock injected everywhere)

**Trigger:** pending + `now < trigger` → no bell; `now ≥ trigger` → bell
(title via `displayField`, navigate target correct); marked done → clears;
trigger pushed to future → clears; unparseable → no bell + warn; boot with
`now` past an undone trigger → bell appears.

**Spawn:** `paid` + absent successor → one successor created (`pending`,
`carry`/`set` applied, computed trigger); reconcile the same item again →
**no second file** (idempotent); old paid item in a chain → no duplicate
(successor exists); delete successor while source still `paid` → re-created
(resurrection); move source to non-`when` status → not re-created (escape
hatch).

**Month arithmetic (pure `advanceTriggerDate`):** `{month,1,dayOfMonth:10}`
Jan10→Feb10→…→next-year (never clamped); `{month,1,dayOfMonth:31}`
Jan31→Feb28→Mar31→Apr30→… (no drift); leap-year Feb29; `{month,3}` quarterly;
`{year,1}` annual incl. Feb29→Feb28 non-leap; `{week,2}` / `{day,10}` civil
adds across month/year boundaries; `"last"` sentinel.

## Scope-out

**Decided, not deferred:** Tier-1 (time gate + spawn + carry-forward) is the
complete target. It covers the *periodic* class of recurring obligation —
rent, renewals, subscriptions, recurring payments — which is the goal. The
items below are **not** a backlog to work through; the first is an explicit
non-goal, the rest are trivial conveniences only if a concrete app ever asks.

- **Severity escalation / multi-phase firing** (info → warning → urgent as a
  deadline nears) — **intentionally not pursued.** It makes severity a
  function of `now`, turning a re-fire into clear+republish and breaking
  "`ensure` no-ops if exists" — i.e. it drags escalation-state complexity
  into the platform and breaks pure convergence. It's the one axis with no
  cheap emergent shortcut, and it serves the *windowed* obligation class
  (tax-filing-style extended prep), which is deliberately left to
  Encore-as-bespoke rather than absorbed here. Do **not** treat this as a
  future Collections feature.
- **Snooze** — per-item suppression state; first thing to break pure
  convergence. Same reasoning — out by choice.
- **Time-of-day / `datetime`** — parser-only follow-up (see Granularity);
  add only if an app needs sub-day precision.
- **`spawn.until` / bounded recurrence**, **`idTemplate`** — trivial
  conveniences, only if a concrete app asks; not part of v1.

## Relationship to the Encore roadmap

Encore's reconciler and these share the same convergent-idempotent
discipline (`server/encore/INVARIANTS.md`). The gap between Collections' and
Encore's notifiers is four axes: (1) time-driven firing, (2) severity
escalation / multi-phase windows, (3) recurrence / carry-forward, (4) cycle
identity. **This plan ships axes 1 and 3, and that is the deliberate
stopping point** — multi-step workflows also fall out of chaining (each
step's completion spawns the next), so the *periodic* class of obligation
(rent, renewals, subscriptions) is fully covered.

**Axis 2 (escalation over an extended prep window) is a deliberate
non-goal**, not a planned next step. It serves the *windowed* class of
obligation (tax-filing-style), which stays with Encore-as-bespoke — keeping
that escalation-state complexity out of Collections is the point, since it's
the part that would break the pure-convergence property the rest of this
design relies on. Collections is, by decision, the home of *periodic*
recurrence; Encore remains the home of *windowed, escalating* obligations.
The two are not slated to converge further.
