// `snooze` / `unsnooze` handlers — inverse pair that mark a step as
// suppressed (or unsuppressed) for a cycle. The reconciler treats
// snoozed pairs as out-of-bundle, so trim/republish flows naturally.

import { z } from "zod";

import { recordStepSnooze, recordStepUnsnooze } from "../cycle.js";
import { ONE_HOUR_MS } from "../../utils/time.js";
import { log } from "../../system/logger/index.js";
import { assertKnownTargetAndStep, loadCycle, loadDsl, persistAndReconcile, type EncoreDispatchResult } from "./shared.js";

export const SnoozeArgs = z.object({
  kind: z.literal("snooze"),
  obligationId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  stepId: z.string().trim().min(1),
  pendingId: z.string().trim().min(1).optional(),
});

export const UnsnoozeArgs = z.object({
  kind: z.literal("unsnooze"),
  obligationId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  stepId: z.string().trim().min(1),
});

export async function handleSnooze(args: z.infer<typeof SnoozeArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  // Snooze under the unified-reconciler model: write
  // `snoozedSteps[stepId]` on the cycle file and let the reconciler
  // do the rest. Because `isPairInBundle` treats snoozed as
  // out-of-bundle, Phase 1 trims this target out of any existing
  // ticket (clearing the bell if the bundle empties); Phase 2 sees
  // the pair as not eligible-to-fire (snooze active), so no
  // republish. The pre-reconciler workaround ("skip the tick after
  // snooze") is no longer needed.
  const snoozeUntilIso = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepSnooze(state, args.targetId, args.stepId, snoozeUntilIso);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "snooze: step snoozed", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
    snoozeUntilIso,
  });
  return {
    ok: true,
    message: `Encore: snoozed ${args.stepId} for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  };
}

export async function handleUnsnooze(args: z.infer<typeof UnsnoozeArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  // Inverse of snooze: delete `snoozedSteps[stepId]`. The reconciler
  // sees the pair eligible to fire again (assuming the step isn't
  // also closed) and Phase 2 publishes a fresh bell — in the same
  // dispatch turn, no tick wait. If the step was already not
  // snoozed, `recordStepUnsnooze` is a no-op and the reconciler
  // sees no state change → no flicker.
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepUnsnooze(state, args.targetId, args.stepId);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "unsnooze: step unsnoozed", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  });
  return {
    ok: true,
    message: `Encore: unsnoozed ${args.stepId} for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
  };
}
