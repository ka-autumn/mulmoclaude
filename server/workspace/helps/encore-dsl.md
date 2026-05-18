# Encore — recurring obligations DSL

Encore tracks recurring obligations (monthly payments, biannual taxes, annual physicals, daily check-ins) defined in a small YAML DSL. You — the LLM — compose the DSL document when the user describes an obligation, and call `defineEncore({ dsl })` to store it.

Encore then:
- Fires bell notifications at the right times based on `firingPlan` phases.
- Bundles multi-target notifications into one bell entry (e.g. Isamu + Singularity Society both monthly, same deadline → one ding).
- Escalates severity over time as deadlines approach.
- Defers chat creation until the user clicks the bell — when they do, they land in a fresh chat with you, seeded with a prompt that names the obligation, the open targets, and the `pendingId` to pass back to `markStepDone` (or `markTargetSkipped` / `snooze`) for clearing.

You never call `chat.start` directly for an obligation. The bell click handles that. You just close the loop on the resulting chat by calling `markStepDone` with the `pendingId` from the seed prompt.

## Your end-to-end loop

1. User describes a recurring obligation → you compose a DSL document → call `defineEncore({ dsl })` (no `obligationId` → setup).
2. Encore fires bell notifications at the right times. You do NOT call `chat.start` — the host opens a fresh chat with you when the user clicks the bell, and seeds it with a prompt that names the obligation, the open targets, and a `pendingId`.
3. In that seeded chat: converse with the user about the obligation, collect what they recorded, and call the matching action (`markStepDone` / `markTargetSkipped` / `recordValues` / `snooze`) passing the `pendingId`. That's the ONLY way the bell entry clears — there is no separate clear/dismiss action.
4. Encore handles cycle recurrence: closing a cycle (all targets done or skipped) provisions the next cycle on the next tick. You don't need to do anything for that.

## When to use this

Whenever the user describes something that recurs and they want to be reminded about:
- "I pay rent every month, due on the 1st" → monthly payment obligation
- "Property tax is due twice a year on April 30 and November 30" → biannual payment
- "I get an annual physical in May; I need to make the appointment in April" → annual service, two steps
- "Take vitamins every day" → daily service
- "Pay Isamu and Singularity Society both monthly on the 10th" → ONE obligation, TWO targets

Compose the full DSL, then call `defineEncore({ dsl })` (no `obligationId` → setup path). Encore generates `id` (slugified from `displayName`) and `createdAt` server-side. To change an existing obligation later, call `defineEncore({ obligationId, dsl: { /* fields to change */ } })` — that's the amend path.

## Top-level DSL shape

```yaml
version: 1
displayName: "Daily payment — Hisayo"
status: active                     # active | paused | retired (default: active)

type: payment                      # payment | service
currency: JPY                      # ISO 4217, REQUIRED iff type=payment, FORBIDDEN otherwise

cadence:
  type: daily                      # see Cadence below

targets:                           # length >= 1
  - id: hisayo                     # kebab-case slug, unique within obligation
    displayName: "Hisayo"
    defaults:                      # optional; pre-fills field values per cycle
      method: Cash

steps:                             # length >= 1
  - id: pay                        # kebab-case slug, unique within obligation
    displayName: "Pay"
    deadline: cycle-deadline       # at-expression (see below)
    firingPlan:
      - at: cycle-start            # at-expression
        severity: info             # info | warning | urgent
    fields: [amount, method, paidOn]  # subset of formSchema field names

formSchema:                        # input grammar for per-cycle values
  fields:
    - name: amount                 # camelCase or kebab-case
      type: number                 # string | text | url | email | date | number | boolean | enum
      label: "Amount paid (JPY)"
      required: true
    - name: method
      type: string
      label: "Payment method"
    - name: paidOn
      type: date
      label: "Payment date"

carryForward:                      # optional
  body: empty                      # empty | copy (default: empty)
```

Cross-field rules (validator will reject otherwise):
- `currency` required iff `type` is `payment`.
- `targets[].id`, `steps[].id`, `formSchema.fields[].name` are each unique within their list.
- Every `formSchema` field name must be claimed by **exactly one** step's `fields[]` — no orphans, no double-claims.
- `targets[].defaults` keys must reference real `formSchema` field names.
- `firingPlan` phases must resolve in chronological order (Encore evaluates them in declared order).
- `defineEncore` amend cannot change `type`, `currency`, or `cadence.type` — those changes invalidate cycle-file naming or prior records. Path: retire + create new.

## Cadence

```yaml
cadence: { type: annual,   cycles: [{ month: 5, day: 28 }] }
cadence: { type: biannual, cycles: [{ month: 4, day: 28 }, { month: 11, day: 28 }] }
cadence: { type: monthly,  day: 10 }
cadence: { type: weekly,   dayOfWeek: friday }  # mon|tue|wed|thu|fri|sat|sun
cadence: { type: daily }
```

- `month` is 1–12, `day` is 1–28 (capped to dodge February).
- `biannual` cycles must be in calendar order (first slot before second).
- Cycle file naming: `<year>.md` (annual), `<year>-h{1,2}.md` (biannual), `<year>-MM.md` (monthly), `<year>-Www.md` (weekly), `YYYY-MM-DD.md` (daily).

## `at` expressions (firingPlan & step.deadline)

Grammar: `anchor [±N d]` where anchor is one of:
- `cycle-start` — first day of the cycle
- `cycle-deadline` — the cycle's natural deadline
- `step-deadline` — this step's resolved deadline (ONLY valid inside the same step's `firingPlan`)
- `schedule:YYYY-MM-DD` — absolute date

Examples:
- `cycle-start` — fire on day 1
- `cycle-deadline-21d` — three weeks before deadline
- `step-deadline+1d` — one day after the step's deadline (e.g. for an "overdue" escalation)
- `schedule:2026-02-01` — absolute

Days only — no `w` / `m`. Compute the math yourself.

## Severity

Three severities: `info`, `warning`, `urgent`. They drive the bell's visual prominence and the escalation log; the LLM also reads severity from the seed prompt and adjusts tone in conversation. Phases must be chronologically ordered but severities can be non-monotonic (rare).

## Two MCP tools — defineEncore vs manageEncore

Encore exposes two MCP tools that share the same `/api/encore` endpoint:

- **`defineEncore`** — compose a new DSL document, or amend an existing one. Use this for ANY structural change (creating an obligation, renaming it, changing the firingPlan, adding a target, etc.).
- **`manageEncore`** — operational kinds only: `markStepDone` / `markTargetSkipped` / `recordValues` / `query` / `appendNote` / `snooze` / `unsnooze`. Use these after the obligation exists, typically in the chat seeded by a bell click.

The split exists so the `defineEncore` tool can carry a fully typed JSON Schema for the `dsl` argument (you'll see field names, types, and oneOf branches in the tool definition), while `manageEncore` stays a thin discriminator on short flat arguments.

## defineEncore — setup or amend

Discriminator: **`obligationId` presence**.

- Absent → setup (server generates the id from `displayName`).
- Present → amend the named obligation.

This way the parameter shape carries the intent — no separate `kind: "setup" | "amend"` flag inside the tool.

### setup — create a new obligation

```json
{
  "kind": "defineEncore",
  "dsl": {
    "version": 1,
    "displayName": "Daily check-in",
    "type": "service",
    "cadence": { "type": "daily" },
    "targets": [{ "id": "me", "displayName": "Me" }],
    "steps": [
      {
        "id": "checkin",
        "displayName": "Check in",
        "deadline": "cycle-deadline",
        "firingPlan": [{ "at": "cycle-start", "severity": "info" }],
        "fields": []
      }
    ],
    "formSchema": { "fields": [] }
  }
}
```

Returns `{ ok: true, obligationId, cycleId, cyclePath, indexPath }`. Encore writes `obligations/<id>/index.md` plus the first cycle file and reconciles (so a `cycle-start` phase fires immediately).

`dsl` is normally an **OBJECT** in the tool-call arguments. The handler also accepts a JSON-encoded string (it calls `JSON.parse` on the string before validating) so a `JSON.stringify`'d dsl won't error — but the object form is preferred.

### setup — 409 collision behavior

If `slugify(dsl.displayName)` matches an existing obligation, the server rejects with `409 Conflict` and a recovery directive:

> Obligation "daily-payment-hisayo" already exists (displayName: "Daily payment — Hisayo"). To modify it, call defineEncore with obligationId: "daily-payment-hisayo" (this becomes an amend). To create a parallel obligation, change the displayName.

Read the message — it tells you the id to pass for amend. Don't auto-disambiguate by appending suffixes; the user almost always wants one of: (a) you forgot `obligationId` and meant amend, or (b) you genuinely want a new obligation under a different name.

### amend — change one or more fields

```json
{
  "kind": "defineEncore",
  "obligationId": "daily-payment-hisayo",
  "dsl": { "displayName": "Daily payment — Hisayo San" }
}
```

For amend, only fill the fields you want to change — the server shallow-merges onto the existing DSL. Array fields (`targets`, `steps`, `formSchema.fields`, `firingPlan`) replace whole; if you want to add a new step, send the full new `steps` array (existing + new).

Cannot change `type` / `currency` / `cadence.type` — those are immutable. Path: retire the old obligation, create a new one.

Encore clears active bell entries on amend and re-fires with the new title/text.

## manageEncore call shapes

Every operational action takes a `kind` discriminator. The handler validates the rest with Zod and 400s on shape mistakes — read the error message; it names the field.

For composing a NEW obligation or amending an existing one's DSL, use the sibling `defineEncore` tool documented above — that's structural, not operational, and lives outside `manageEncore`.

### markStepDone — CLOSE ONE STEP ON ONE TARGET

```json
{
  "kind": "markStepDone",
  "pendingId": "<from the seed prompt>",
  "obligationId": "daily-payment-hisayo",
  "cycleId": "2026-05-16",
  "targetId": "hisayo",
  "stepId": "pay",
  "values": { "amount": 5000, "paidOn": "2026-05-16" }
}
```

**Common mistakes the parser will 400 on:**
- `targetIds: ["hisayo"]` — WRONG. Use singular `targetId: "hisayo"` (string). If the bell covered multiple targets, call `markStepDone` once per target.
- `values: { "hisayo": { "amount": 5000 } }` — WRONG. `values` is a flat field-map keyed by field name: `{ "amount": 5000, "paidOn": "..." }`. Never nest under target id.
- Missing `pendingId` when called in response to a bell click — the bell entry won't clear without it.

### markTargetSkipped

```json
{ "kind": "markTargetSkipped", "pendingId": "...", "obligationId": "...", "cycleId": "...", "targetId": "hisayo" }
```

Marks one target skipped for this cycle. Remaining targets still need their own close.

### recordValues

```json
{ "kind": "recordValues", "obligationId": "...", "cycleId": "...", "targetId": "...", "values": { "amount": 5000 } }
```

Writes partial values without closing the step. Use when the user has reported partial info (invoice received but not yet paid).

### snooze

```json
{ "kind": "snooze", "pendingId": "...", "obligationId": "...", "cycleId": "...", "targetId": "...", "stepId": "..." }
```

Clears the current bell entry and persists a `snoozedSteps[stepId]` marker (24h by default) on the cycle file. The reconciler skips this step until the snooze timestamp passes; after that, the next reconcile re-fires from the current phase.

### unsnooze

```json
{ "kind": "unsnooze", "obligationId": "...", "cycleId": "...", "targetId": "...", "stepId": "..." }
```

Inverse of `snooze`. Deletes `snoozedSteps[stepId]` from the target's record. If the step is otherwise eligible to fire (not closed, current phase past), the bell republishes in the same turn — no need to wait for the 24h timer or run a tick manually. A no-op if the step wasn't snoozed.

### query

```json
{ "kind": "query", "obligationId": "daily-payment-hisayo", "range": "all" }
```

`range` is `"current"` (default, last cycle only), `"all"` (every cycle ever), or a number (last N cycles). Omit `obligationId` to query every obligation. Response includes each cycle's `path` so you can deep-read the raw markdown for further analysis.

### appendNote

```json
{ "kind": "appendNote", "obligationId": "...", "cycleId": "2026-05-16", "body": "Note appended here" }
```

Omit `cycleId` to append to the obligation's index.md body (long-lived notes); include it to append to a specific cycle's body (per-cycle scratch).

## Three worked examples

### 1. Monthly payments, two targets, bundled notification

```yaml
version: 1
displayName: "Monthly payments (due 10th)"
type: payment
currency: JPY
cadence:
  type: monthly
  day: 10
targets:
  - id: isamu
    displayName: "Isamu"
    defaults:
      amount: 15000
  - id: singularity-society
    displayName: "Singularity Society"
steps:
  - id: pay
    displayName: "Pay"
    deadline: cycle-deadline
    firingPlan:
      - { at: cycle-start, severity: info }
      - { at: cycle-deadline-3d, severity: warning }
      - { at: cycle-deadline+1d, severity: urgent }
    fields: [invoiceReceivedOn, amount, paidOn]
formSchema:
  fields:
    - { name: invoiceReceivedOn, type: date, label: "Invoice received on" }
    - { name: amount, type: number, label: "Amount paid (JPY)", required: true }
    - { name: paidOn, type: date, label: "Payment date" }
```

When the cycle fires, one bell entry covers both targets. The seeded chat lists both; close them with two `markStepDone` calls (one per `targetId`).

### 2. Biannual real estate tax with escalation

```yaml
version: 1
displayName: "Real estate tax — Hayama"
type: payment
currency: JPY
cadence:
  type: biannual
  cycles:
    - { month: 4, day: 28 }
    - { month: 11, day: 28 }
targets:
  - id: hayama-house
    displayName: "Hayama house"
steps:
  - id: pay
    displayName: "Pay"
    deadline: cycle-deadline
    firingPlan:
      - { at: cycle-deadline-21d, severity: info }
      - { at: cycle-deadline-3d, severity: warning }
      - { at: cycle-deadline+1d, severity: urgent }
    fields: [invoiceReceivedOn, amount, paidOn]
formSchema:
  fields:
    - { name: invoiceReceivedOn, type: date, label: "Invoice received on" }
    - { name: amount, type: number, label: "Amount paid (JPY)", required: true }
    - { name: paidOn, type: date, label: "Payment date" }
```

### 3. Annual physical, multi-step

```yaml
version: 1
displayName: "Annual physical"
type: service
cadence:
  type: annual
  cycles:
    - { month: 5, day: 28 }
targets:
  - id: satoshi
    displayName: "Satoshi"
steps:
  - id: make-appointment
    displayName: "Make appointment"
    deadline: cycle-deadline-30d
    firingPlan:
      - { at: step-deadline-14d, severity: info }
      - { at: step-deadline, severity: warning }
    fields: []
  - id: doctor-visit
    displayName: "Doctor visit"
    deadline: cycle-deadline
    firingPlan:
      - { at: step-deadline-3d, severity: info }
    fields: [visitDate, doctorName, notes]
formSchema:
  fields:
    - { name: visitDate, type: date, label: "Visit date" }
    - { name: doctorName, type: string, label: "Doctor name" }
    - { name: notes, type: text, label: "Notes" }
```

Two independent steps with separate deadlines. `step-deadline` inside a step's `firingPlan` refers to that step's own deadline. Closing `make-appointment` leaves `doctor-visit` still open until its own phase fires.

## Operational notes

- Encore data lives under `~/mulmoclaude/data/plugins/encore/`. Each obligation is a folder with `index.md` (the DSL + free-form body) and one markdown file per cycle.
- The bell entry for an obligation is action-lifecycle — clicking it lands the user in a seeded chat, but does NOT clear the bell. You clear it by closing the underlying step via `markStepDone` (or `markTargetSkipped` / `snooze`).
- The tick is hourly. State-mutating handlers (`defineEncore`, `markStepDone`, `snooze`, …) reconcile after persisting, so newly-due notifications surface within the same SSE turn.
