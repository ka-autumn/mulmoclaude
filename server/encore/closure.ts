// Closure derivation — pure functions over the cycle file's
// recorded-data shape.
//
// On-disk per-cycle state holds only DATA, not status flags:
//   - values[fieldName] — what the user told us
//   - skipped — explicit "this target is opted out for this cycle"
//   - completedSteps[stepId] — timestamp set by markStepDone
//
// "Closed" is derived from those three. There's no `status: closed`
// field anywhere; if there were, it could disagree with the data
// (and did, in the original landing — bug fixed by this refactor).

import type { EncoreDsl, StepDef } from "../../src/types/encore-dsl/schema.js";
import type { TargetRecord, CycleState } from "./cycle.js";

/** A step is closed if the target is skipped, OR if markStepDone
 *  has explicitly recorded completion in `completedSteps[step.id]`.
 *  The recorded `values` are evidence the user collected — they're
 *  data, not the closure signal. markStepDone is the one verb that
 *  says "this step is done"; recordValues writes partial info
 *  without closure. */
export function isStepClosed(record: TargetRecord | undefined, step: StepDef): boolean {
  if (!record) return false;
  if (record.skipped) return true;
  return Boolean(record.completedSteps?.[step.id]);
}

export function isTargetClosed(record: TargetRecord | undefined, dsl: EncoreDsl): boolean {
  if (!record) return false;
  if (record.skipped) return true;
  return dsl.steps.every((step) => isStepClosed(record, step));
}

export function isCycleClosed(state: CycleState, dsl: EncoreDsl): boolean {
  return dsl.targets.every((target) => isTargetClosed(state.records[target.id], dsl));
}
