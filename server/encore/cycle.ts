// Per-cycle state file.
//
// One cycle = one markdown file at obligations/<id>/<cycleId>.md.
// Frontmatter holds ONLY user-recorded data — no status flags, no
// notification ids. Closure ("is this step/target/cycle done?") is
// derived on the fly by `./closure.ts` from the recorded data; if
// it were stored as a flag, the flag could disagree with the data
// (and did — see PR #1416 follow-up).
//
// Three things on disk per target:
//   - `values` — what was collected (markStepDone / recordValues)
//   - `skipped` — explicit per-target skip for this cycle
//   - `completedSteps[stepId]` — timestamp set by markStepDone
//
// Notification-bell tracking (`activeNotificationId`,
// `lastPublishedSeverity`) lives in tickets, NOT in this file.
// One ticket = one live bell entry; the tick scans
// `tickets/*.json` to know what's active.

import { parseEncoreFrontmatter as parseFrontmatter, serializeEncoreFrontmatter as serializeWithFrontmatter } from "./yaml-fm.js";
import type { EncoreDsl } from "../../src/types/encore-dsl/schema.js";
import type { CycleSlot } from "../../src/types/encore-dsl/cadence.js";
import { cycleDeadline, cycleStart, formatCycleId } from "../../src/types/encore-dsl/cadence.js";

export interface TargetRecord {
  /** Per-cycle field values keyed by formSchema field name.
   *  Sparse — fields the user hasn't told us about yet are absent
   *  (or null). Optional pre-fill from `targets[].defaults`. */
  values?: Record<string, unknown>;
  /** Explicit "skip this target for this cycle" marker. Set by
   *  markTargetSkipped. Presence means the entire target counts
   *  as closed regardless of values / completedSteps. */
  skipped?: string;
  /** stepId → ISO timestamp when markStepDone was called for this
   *  (target, step). Set by markStepDone; the only signal that a
   *  step is closed. Steps with no required fields can only close
   *  via this map; steps with required fields ALSO require this
   *  marker (recordValues alone never closes anything). */
  completedSteps?: Record<string, string>;
  /** stepId → ISO timestamp until which the step is snoozed. The
   *  tick skips steps whose snooze hasn't expired (treats them as
   *  un-firable). Set by `snooze`; once the timestamp passes, the
   *  next tick re-evaluates and may re-fire. NOT closure — a
   *  snoozed step is still considered open by closure.ts. */
  snoozedSteps?: Record<string, string>;
}

export interface CycleState {
  cycleId: string;
  cycleStart: string;
  cycleDeadline: string;
  /** Sparse — targets the user hasn't touched are absent. */
  records: Record<string, TargetRecord>;
}

/** Build a fresh CycleState for a new cycle of the obligation.
 *  Pre-fills per-target defaults into `values` where the DSL
 *  provides them. */
export function buildCycleState(dsl: EncoreDsl, slot: CycleSlot): CycleState {
  const startIso = cycleStart(dsl.cadence, slot);
  const deadlineIso = cycleDeadline(dsl.cadence, slot);

  const records: Record<string, TargetRecord> = {};
  for (const target of dsl.targets) {
    if (target.defaults && Object.keys(target.defaults).length > 0) {
      records[target.id] = { values: { ...target.defaults } };
    }
  }

  return {
    cycleId: formatCycleId(slot),
    cycleStart: startIso,
    cycleDeadline: deadlineIso,
    records,
  };
}

// ── pure mutators — write data, never flags ──────────────────────

/** Record a step as done for one target. Stamps
 *  `completedSteps[stepId]` AND merges any provided values. The
 *  closure-derivation reads `completedSteps`; values are kept as
 *  data the LLM can quote back later. */
export function recordStepDone(state: CycleState, targetId: string, stepId: string, values?: Record<string, unknown>): CycleState {
  const next = cloneState(state);
  const record = upsertRecord(next, targetId);
  record.completedSteps = { ...(record.completedSteps ?? {}), [stepId]: new Date().toISOString() };
  if (values && Object.keys(values).length > 0) {
    record.values = { ...(record.values ?? {}), ...values };
  }
  return next;
}

/** Skip an entire target for this cycle. Derivation treats this
 *  as closed without inspecting individual steps. */
export function recordTargetSkip(state: CycleState, targetId: string): CycleState {
  const next = cloneState(state);
  const record = upsertRecord(next, targetId);
  record.skipped = new Date().toISOString();
  return next;
}

/** Mark a step snoozed until `untilIso` for one target. The tick
 *  will skip it until the timestamp passes. Not closure — once
 *  the snooze expires the step is firable again. */
export function recordStepSnooze(state: CycleState, targetId: string, stepId: string, untilIso: string): CycleState {
  const next = cloneState(state);
  const record = upsertRecord(next, targetId);
  record.snoozedSteps = { ...(record.snoozedSteps ?? {}), [stepId]: untilIso };
  return next;
}

/** Inverse of `recordStepSnooze`. Idempotent — no-op if the entry
 *  was already absent. Used by the `unsnooze` dispatch kind so the
 *  bell can republish in the same turn (the reconciler sees the
 *  pair eligible to fire again). */
export function recordStepUnsnooze(state: CycleState, targetId: string, stepId: string): CycleState {
  const next = cloneState(state);
  const record = next.records[targetId];
  if (record?.snoozedSteps && stepId in record.snoozedSteps) {
    const rest: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.snoozedSteps)) {
      if (key !== stepId) rest[key] = value;
    }
    record.snoozedSteps = Object.keys(rest).length > 0 ? rest : undefined;
  }
  return next;
}

/** True iff the target's `snoozedSteps[stepId]` is present AND its
 *  ISO timestamp hasn't passed yet. Used by the reconciler both for
 *  "should this bundle target trim?" and "is this un-fired pair
 *  eligible to fire?" — the symmetry the pre-reconciler code lacked.
 *
 *  Use a full ISO timestamp for `nowIso` (not date-only `YYYY-MM-DD`).
 *  `snoozedUntil` is written by `recordStepSnooze` via
 *  `toISOString()`; comparing it lexically against a date-only
 *  string would over-block by ~24h for any snooze that doesn't land
 *  on midnight. */
export function isStepSnoozed(record: TargetRecord | undefined, stepId: string, nowIso: string): boolean {
  const until = record?.snoozedSteps?.[stepId];
  return Boolean(until && until > nowIso);
}

/** Merge new field values onto a target without marking any step
 *  done. This is `recordValues` semantics — partial info, no
 *  closure. */
export function applyValues(state: CycleState, targetId: string, values: Record<string, unknown>): CycleState {
  const next = cloneState(state);
  const record = upsertRecord(next, targetId);
  record.values = { ...(record.values ?? {}), ...values };
  return next;
}

function upsertRecord(state: CycleState, targetId: string): TargetRecord {
  let record = state.records[targetId];
  if (!record) {
    record = {};
    state.records[targetId] = record;
  }
  return record;
}

function cloneState(state: CycleState): CycleState {
  return JSON.parse(JSON.stringify(state)) as CycleState;
}

// ── parse / serialize ─────────────────────────────────────────────

/** Parse a cycle file's raw markdown into (state, body). Tolerant
 *  of extra fields in the frontmatter (old-shape `status` /
 *  `activeNotificationId` / etc. from pre-refactor files are
 *  silently dropped). The first write through `serializeCycleFile`
 *  normalises the file to the new shape. */
export function parseCycleFile(raw: string): { state: CycleState; body: string } {
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasHeader) {
    throw new Error("cycle file: missing YAML frontmatter");
  }
  const meta = parsed.meta as Partial<CycleState> & Record<string, unknown>;
  if (
    typeof meta.cycleId !== "string" ||
    typeof meta.cycleStart !== "string" ||
    typeof meta.cycleDeadline !== "string" ||
    typeof meta.records !== "object" ||
    meta.records === null ||
    Array.isArray(meta.records)
  ) {
    throw new Error("cycle file: frontmatter missing required fields (cycleId/cycleStart/cycleDeadline/records)");
  }
  return {
    state: {
      cycleId: meta.cycleId,
      cycleStart: meta.cycleStart,
      cycleDeadline: meta.cycleDeadline,
      records: normaliseRecords(meta.records as Record<string, unknown>),
    },
    body: parsed.body,
  };
}

/** Strip old-shape fields (status, steps with stepDeadline/
 *  activeNotificationId/lastPublishedSeverity) from each target
 *  record. New-shape fields pass through verbatim. */
/** Pick only string-valued entries from a map. Used to validate
 *  `completedSteps` / `snoozedSteps` so a malformed object/boolean
 *  doesn't get treated as a truthy completion marker. */
function pickStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") filtered[key] = value;
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function normaliseSkipped(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  // Tolerate boolean form from any intermediate iteration.
  if (raw === true) return new Date(0).toISOString();
  return undefined;
}

function normaliseOneRecord(raw: Record<string, unknown>): TargetRecord {
  const normalised: TargetRecord = {};
  // Reject arrays here — `typeof [] === "object"` would otherwise
  // accept a malformed `values: [...]` and normalize it into an
  // invalid field-map.
  if (raw.values && typeof raw.values === "object" && !Array.isArray(raw.values)) {
    normalised.values = raw.values as Record<string, unknown>;
  }
  const skipped = normaliseSkipped(raw.skipped);
  if (skipped) normalised.skipped = skipped;
  const completed = pickStringMap(raw.completedSteps);
  if (completed) normalised.completedSteps = completed;
  const snoozed = pickStringMap(raw.snoozedSteps);
  if (snoozed) normalised.snoozedSteps = snoozed;
  return normalised;
}

function normaliseRecords(raw: Record<string, unknown>): Record<string, TargetRecord> {
  const out: Record<string, TargetRecord> = {};
  for (const [targetId, value] of Object.entries(raw)) {
    // `typeof [] === "object"` would otherwise accept a malformed
    // `records.<targetId>: []` and normalise it to `{}`, silently
    // swallowing the malformed shape. Reject arrays here.
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    out[targetId] = normaliseOneRecord(value as Record<string, unknown>);
  }
  return out;
}

/** Serialize a CycleState + body back to markdown. Empty per-target
 *  `values` / `completedSteps` maps are dropped so the file stays
 *  minimal (a target the user hasn't touched serialises as `{}`,
 *  or is absent entirely from `records` — both shapes round-trip). */
export function serializeCycleFile(state: CycleState, body: string): string {
  const records: Record<string, unknown> = {};
  for (const [targetId, record] of Object.entries(state.records)) {
    const out: Record<string, unknown> = {};
    if (record.values && Object.keys(record.values).length > 0) out.values = record.values;
    if (record.skipped) out.skipped = record.skipped;
    if (record.completedSteps && Object.keys(record.completedSteps).length > 0) out.completedSteps = record.completedSteps;
    if (record.snoozedSteps && Object.keys(record.snoozedSteps).length > 0) out.snoozedSteps = record.snoozedSteps;
    records[targetId] = out;
  }
  return serializeWithFrontmatter(
    {
      cycleId: state.cycleId,
      cycleStart: state.cycleStart,
      cycleDeadline: state.cycleDeadline,
      records,
    },
    body,
  );
}
