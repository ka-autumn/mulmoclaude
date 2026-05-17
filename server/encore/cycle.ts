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
// `lastPublishedSeverity`) lives in pending-clear tickets, NOT in
// this file. One ticket = one live bell entry; the tick scans
// `pending-clear/*.json` to know what's active.

import { parseEncoreFrontmatter as parseFrontmatter, serializeEncoreFrontmatter as serializeWithFrontmatter } from "./yaml-fm.js";
import type { EncoreDsl } from "./dsl/schema.js";
import type { CycleSlot } from "./dsl/cadence.js";
import { cycleDeadline, cycleStart, formatCycleId } from "./dsl/cadence.js";

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
    meta.records === null
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
function normaliseRecords(raw: Record<string, unknown>): Record<string, TargetRecord> {
  const out: Record<string, TargetRecord> = {};
  for (const [targetId, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const rec = value as Record<string, unknown>;
    const normalised: TargetRecord = {};
    if (rec.values && typeof rec.values === "object") {
      normalised.values = rec.values as Record<string, unknown>;
    }
    if (typeof rec.skipped === "string") {
      normalised.skipped = rec.skipped;
    } else if (rec.skipped === true) {
      // Tolerate boolean form from any intermediate iteration.
      normalised.skipped = new Date(0).toISOString();
    }
    if (rec.completedSteps && typeof rec.completedSteps === "object") {
      normalised.completedSteps = rec.completedSteps as Record<string, string>;
    }
    out[targetId] = normalised;
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
