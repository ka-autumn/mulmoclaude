// `markTargetSkipped` handler — record an entire target as skipped
// for a given cycle, then reconcile.

import { z } from "zod";

import { recordTargetSkip } from "../cycle.js";
import { log } from "../../system/logger/index.js";
import { assertKnownTargetAndStep, loadCycle, loadDsl, persistAndReconcile, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const MarkTargetSkippedArgs = z.object({
  kind: z.literal("markTargetSkipped"),
  obligationId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  pendingId: z.string().trim().min(1).optional(),
});

export async function handleMarkTargetSkipped(args: z.infer<typeof MarkTargetSkippedArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = recordTargetSkip(state, args.targetId);
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "markTargetSkipped: target skipped", { obligationId: args.obligationId, cycleId: args.cycleId, targetId: args.targetId });
  return {
    ok: true,
    message: `Encore: skipped ${args.targetId} for cycle ${args.cycleId} of ${args.obligationId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    cyclePath: workspaceRelativePath(rel),
  };
}
