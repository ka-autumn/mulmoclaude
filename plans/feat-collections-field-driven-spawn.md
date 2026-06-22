# Plan: field-driven `spawn` interval — `every.fromField` + interval map

Follow-up to the time-driven collections work
(`feat-collections-time-trigger.md`). That line shipped `triggerField`
(per-record time gate) and `spawn` (host-driven succession). This plan adds
**one composable extension**: let a single collection carry records that
recur at *different* intervals (daily / weekly / monthly), driven
declaratively by an `enum` field on each record.

## Hard constraint: zero domain-specific host code

Same discipline as every collection primitive. The host learns one new
generic concept — "the recurrence interval may be selected per-record by an
`enum` field's value, via a declared map" — and holds no frequency / rent /
bill / domain literals. All meaning lives in `schema.json` and the records.

---

## 1. Problem

Today `spawn.every` is a **single literal** in `schema.json`, applied
uniformly to every record in the collection:

```json
"every": { "unit": "month", "interval": 1, "dayOfMonth": 1 }
```

A collection that mixes daily, weekly, and monthly obligations cannot be
served by any single `every`: whichever cadence you pick breaks the others.
Adding a `frequency` column to records does not help, because `spawn` has no
way to read it and vary the interval.

The two existing workarounds each give up one half of the goal:

- **A — scheduler + agent:** a daily job reads `frequency` and creates the
  next record in agent logic. Keeps one list, but is *not* host-native.
- **B — three collections, one cadence each:** each uses the existing
  literal `spawn`. Fully host-native, but the list is split in three.

"One list" and "fully host-native automation" cannot coexist today. This
plan removes that constraint.

---

## 2. Proposal: `every` becomes a discriminated union

Extend `every` from a fixed literal to **either** the existing literal form
**or** a field-driven form (`fromField` + `map`).

```json
"triggerField": "nextDue",
"spawn": {
  "when": { "field": "status", "in": ["paid"] },
  "every": {
    "fromField": "frequency",
    "map": {
      "daily":   { "unit": "day",   "interval": 1 },
      "weekly":  { "unit": "week",  "interval": 1 },
      "monthly": { "unit": "month", "interval": 1, "dayOfMonth": 1 }
    }
  },
  "carry": ["name", "amount", "payee", "method", "frequency"],
  "set": { "status": "unpaid" }
}
```

**Semantics:** when `spawn` fires, the host reads the source record's
`fromField` value, looks up the matching `{ unit, interval, ... }` in `map`,
and advances `triggerField` by that interval. Different records advance by
different intervals.

This rides the existing date math unchanged. `advanceTriggerDate(source,
every)` in
`packages/plugins/collection-plugin/src/server/spawn.ts:87-99` already takes
`every` as an argument — the only change is *which* `every` we resolve before
calling it. Month-end clamping (`Math.min(anchor, dim)`) and
`dayOfMonth: "last"` are untouched.

### Why `enum`-only

`fromField` must point at an `enum`-typed field. The value set is then
closed and finite, the `map` can be validated for exhaustive coverage at
discovery time, and the field maps cleanly to the form `<select>`.

---

## 3. Backward compatibility

- `every` with `unit` → **literal mode** (today's behaviour, byte-identical).
- `every` with `fromField` → **field-driven mode**.
- Both, or neither → validation error.
- Existing schemas are unchanged at the JSON level and entirely unaffected.

### Zod shape — `z.union`, not `z.discriminatedUnion`

The two arms share **no common literal discriminant key** (`unit` vs
`fromField`), so `z.discriminatedUnion` does not apply. Implement
`EverySchema` (`discovery.ts:229-233`) as
`z.union([EveryLiteralSchema, EveryFieldDrivenSchema])` where **both arms
are `.strict()`**. This makes the "both, or neither → error" rule fall out
for free: an object carrying both `unit` and `fromField` fails the literal
arm (unknown `fromField`) *and* the field-driven arm (unknown `unit`); an
empty object fails both (each requires its discriminating key). No extra
refine needed for §3's mutual exclusion.

### Type model — keep `CollectionEvery` literal; widen only `spawn.every`

Do **not** widen `CollectionEvery`
(`packages/plugins/collection-plugin/src/core/schema.ts:83-96`) into the
union. `advanceTriggerDate` (`spawn.ts:87-99`) destructures `every.unit` and
`every.dayOfMonth`, which exist only on the literal arm — widening that type
breaks its signature and forces casts. Instead:

- `CollectionEvery` stays the **literal** shape (unchanged) — still what
  `advanceTriggerDate` takes.
- Add `CollectionEveryFieldDriven` (`{ fromField: string; map: Record<string,
  CollectionEvery> }`).
- `CollectionSpawn.every`
  (`schema.ts:110`) widens to `CollectionEvery | CollectionEveryFieldDriven`.

So `advanceTriggerDate` is **literally untouched** — the per-record
resolution narrows to a `CollectionEvery` before calling it.

---

## 4. Discovery-time validation (new refines)

Added alongside the existing `spawn` refines in `CollectionSchemaZ`
(`discovery.ts:480-506`, next to the `spawn.carry` check and
`spawnSuccessorStartsInert`):

1. `fromField` names a real **top-level** field **and** that field is
   `type: "enum"` (same `schema.fields[...]` discipline as `triggerField` /
   `when.field`).
2. `map`'s key set **exactly covers** `fromField`'s `values` (no missing
   keys, no extra keys). **Precedent to follow:** toggle-field validation
   already checks author values against an enum's closed `values` set —
   `collectToggleFieldRefs` (`discovery.ts:274-282`) + its refine
   (`discovery.ts:553-556`). Mirror that shape (`new Set(field.values)` vs
   `Object.keys(map)`) rather than inventing a new idiom.
3. Each map value satisfies the existing `every` constraints — **reuse
   `EveryLiteralSchema` as the per-map-value type** (`unit ∈ {day, week,
   month, year}`, `interval ≥ 1`, `dayOfMonth` only on month/year, `1–31` or
   `"last"`), so the constraint is defined once and the field-driven arm is
   literally `z.record(z.string(), EveryLiteralSchema)`. Checks 2 and 3
   (coverage + per-value shape) are then split: shape is enforced by the arm
   itself in Zod; coverage is a `CollectionSchemaZ` refine (it needs the
   sibling `fields[fromField].values`, which the `every` arm can't see).
4. `spawn` still requires `triggerField` (unchanged).
5. **`fromField` MUST appear in `carry` (or be written by `set`)** — a hard
   error, not a warning. If the successor loses its frequency, the next
   `spawn` along the chain silently halts, which defeats the whole point of
   "fully automatic". Reject the schema rather than warn. (See §6.)
   When satisfied via `set`, the written value must itself be a **key of
   `map`** (and non-empty): `set` writes a fixed value, so an unmapped one
   (`set: { frequency: "yearly" }`) would birth the successor with an
   unresolvable driver — `resolveEvery` returns null on its next completion
   and the chain halts, the exact failure this rule prevents. A `carry`ed
   driver needs no value check: it copies the source's own value, which —
   for a record that matched the spawn — is one of the enum's values, all of
   which `map` covers by §4.2, so it is always resolvable.

These checks are unaffected by — and do not affect — the existing
`spawnSuccessorStartsInert` guard (`spawn.ts:294-308`) or the runtime
runaway guard (`maybeSpawnSuccessor`, `spawn.ts:193-200`), because both
operate on `when` / `set` / `carry`, never on `every`. This is a key
"nothing else breaks" property and should be asserted in tests.

### Host-side gate mirror — expected to be a no-op here

All five checks (§4.1–4.5) are **schema-internal** — they read only
`schema.fields`, `spawn.every`, `spawn.carry`, and `spawn.set`, never the
filesystem or cross-package state. So all five are **Zod refines inside
`CollectionSchemaZ`** (or, for §4.3, the `every` arm itself). That object is
the *same* one `handlePutSchema` already runs via
`CollectionSchemaZ.safeParse` (`manageCollection.ts:379`), so the refines
fire host-side automatically.

`schemaDiscoveryGate` (`manageCollection.ts:358-364`) exists only for the
handful of gates Zod **cannot** express — filesystem `dataPath` resolution
and `primary: true`. Nothing in §4 fits that category, so **`manageCollection.ts`
needs no change**. The gate-drift warning ("keep putSchema gates host-side")
stays relevant only as a guardrail: *if* a future check ever needs
out-of-Zod state, it MUST be added to both discovery and `schemaDiscoveryGate`.
That is not the case for any check in this plan.

---

## 5. Runtime changes

Single touch point: `computeSuccessor`
(`packages/plugins/collection-plugin/src/server/spawn.ts:150-165`).

Resolve the effective `every` per-record before advancing:

- If `spawn.every` is literal → use it as today.
- If field-driven → read `sourceItem[spawn.every.fromField]`, look up the
  map. On a **missing/unknown value** or **empty field**, return `null`
  (caller does not write) — consistent with the existing "source trigger
  date unparseable → skip + log" path in `maybeSpawnSuccessor`
  (`spawn.ts:172-212`). This is the runtime backstop for the case where an
  `enum` gained a value but the `map` was not updated (discovery would
  normally reject that, but a record could predate the map update).

**Distinct skip message (required).** `computeSuccessor` returning `null`
today means exactly one thing — the source trigger date is unparseable — and
the caller hardcodes that wording (`spawn.ts:185`: *"spawn skipped: source
trigger date unparseable"*). Field-driven resolution adds a **second** null
cause; emitting the date-unparseable message for an unknown-frequency skip
would be actively misleading in logs. Pin the requirement: the two skip
reasons MUST log distinctly (e.g. *"spawn skipped: no `every` mapping for
frequency value '<v>'"*). Suggested mechanics — keep `computeSuccessor` pure
(still returns `null`), and have `maybeSpawnSuccessor` distinguish by which
precondition failed: if `parseCivil(sourceItem[triggerField])` is null →
date message; otherwise → frequency message. Re-parsing the date in the
caller is cheap and avoids threading a tagged reason through the return type.
Implementation is free to choose a tagged return instead, but the two
messages must not collide.

No change to `successorId`, the reconciler tick
(`packages/services/collection-watchers/src/reconciler.ts:225-276`), or the
watcher cadence.

---

## 6. `fromField` carry: hard error vs auto-carry

Two ways to guarantee the successor keeps its frequency:

- **Hard error (recommended):** discovery rejects a field-driven `spawn`
  whose `fromField` is absent from both `carry` and `set` keys. Explicit,
  matches the project's "fail loud, never silently stop" posture, easy to
  add to the existing carry refine.
- **Auto-carry:** the host implicitly appends `fromField` to `carry`.
  Friendlier but adds implicit behaviour.

Decision: **hard error.** Authoring a field-driven spawn without carrying
the driver is almost always a mistake, and the error message can point
straight at the fix.

---

## 7. Deferred: `triggerLeadDays` field-driven (separate phase)

A natural follow-on is per-frequency notification lead time (daily → 0 days,
monthly → 10 days). It is **deliberately out of scope here** because of a
design gap that must be resolved first:

`triggerField` / `triggerLeadDays` live at **schema top level** and gate
notifications even when `spawn` is absent (`reconciler.ts:256-267`), whereas
`fromField` lives **inside `spawn.every`**. A field-driven
`triggerLeadDaysMap` therefore cannot implicitly borrow
`spawn.every.fromField` — it needs **its own** `fromField` declaration so it
works on trigger-only collections and can key off a different column than
spawn. Shape (later):

```json
"triggerLeadDays": {
  "fromField": "frequency",
  "map": { "daily": 0, "weekly": 1, "monthly": 10 }
}
```

with: key set covers the field's `values`; each value a non-negative
integer; mutually exclusive with the single-value `triggerLeadDays`. Ship
the interval-driven `spawn` first, observe usage, then add this.

---

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| Month-end (`dayOfMonth: "last"` / `31`) | Reuse existing canonical clamp (`advanceTriggerDate`, `Math.min(anchor, dim)`) — no change. |
| Map missing a value (enum extended, map not updated) | Discovery rejects (§4.2). Runtime backstop for pre-existing records: skip + log (§5). |
| Empty `fromField` on a record | Skip + log. |
| Literal `every` (no `fromField`) | Fully unchanged behaviour. |
| `fromField` not carried | Discovery rejects (§4.5 / §6). |

---

## 9. Files touched

| File | Change |
| --- | --- |
| `packages/plugins/collection-plugin/src/core/schema.ts` | `CollectionEvery` stays literal (untouched); add `CollectionEveryFieldDriven`; widen `CollectionSpawn.every` to the union. |
| `packages/plugins/collection-plugin/src/server/discovery.ts` | `EverySchema` → `z.union` of two `.strict()` arms (literal + field-driven); new `CollectionSchemaZ` refines (§4.1, §4.2, §4.5). |
| `packages/plugins/collection-plugin/src/server/spawn.ts` | `computeSuccessor` narrows the union to a literal `every` per-record before `advanceTriggerDate`; **distinct** skip-log for unknown/empty frequency vs unparseable date (§5). |
| `server/agent/mcp-tools/manageCollection.ts` | **No change expected** — every §4 check is a Zod refine, run host-side via the existing `CollectionSchemaZ.safeParse`. Listed only as the place to add a host gate *if* a future check ever needs out-of-Zod state. |
| `docs/` (collection schema reference / `schemaDocs`) | Document field-driven `every`. |
| tests | Date-advance per frequency; discovery accept/reject (coverage, enum-type, carry rule); runtime skip+log; assert `spawnSuccessorStartsInert` + runaway guard still hold under field-driven mode. |

---

## 10. Scope decision

- **§2–§6 (interval-driven `spawn`): Go.** Condition: §4.5/§6 carry rule as
  a hard error. (The host-gate-mirror condition is resolved up front — all
  §4 checks are Zod refines, so no host-side gate is added; see §4.)
- **§7 (`triggerLeadDays` field-driven): deferred** to a later phase, after
  the independent `fromField` design above is settled.

The result: a single list manages daily / weekly / monthly obligations, and
the moment a record is marked done the next one is generated **fully
host-native** — while the value set stays closed (enum) so validation is
tractable and the UI dropdown maps directly.
