// `markStepDone` handler — record a step as completed for a given
// (target, cycle), optionally with values, then reconcile.

import { z } from "zod";

import { recordStepDone } from "../cycle.js";
import { log } from "../../system/logger/index.js";
import { assertKnownTargetAndStep, loadCycle, loadDsl, persistAndReconcile, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const MarkStepDoneArgs = z.object({
  kind: z.literal("markStepDone"),
  obligationId: z.string(),
  cycleId: z.string(),
  targetId: z.string(),
  stepId: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
  pendingId: z.string().optional(),
});

export async function handleMarkStepDone(args: z.infer<typeof MarkStepDoneArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordStepDone(state, args.targetId, args.stepId, args.values);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "markStepDone: step recorded", { obligationId: args.obligationId, cycleId: args.cycleId, targetId: args.targetId, stepId: args.stepId });
  return {
    ok: true,
    message: `Encore: marked ${args.stepId} done for ${args.targetId} in cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    stepId: args.stepId,
    cyclePath: workspaceRelativePath(rel),
  };
}
