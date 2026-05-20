// `recordValues` handler — record form values against a target
// without closing any step, then reconcile.

import { z } from "zod";

import { applyValues } from "../cycle.js";
import { log } from "../../system/logger/index.js";
import { assertKnownTargetAndStep, loadCycle, loadDsl, persistAndReconcile, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const RecordValuesArgs = z.object({
  kind: z.literal("recordValues"),
  obligationId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  values: z.record(z.string(), z.unknown()),
  pendingId: z.string().trim().min(1).optional(),
});

export async function handleRecordValues(args: z.infer<typeof RecordValuesArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  assertKnownTargetAndStep(dsl, args);
  const { rel, state, body } = await loadCycle(args.obligationId, args.cycleId);
  const nextState = applyValues(state, args.targetId, args.values);
  // recordValues never closes anything, so the reconciler is a no-op
  // for bells — but we still funnel through `persistAndReconcile`
  // for uniformity (no special-case handler shape). The reconciler
  // is cheap when nothing changed: Phase 1 sees the same live targets,
  // Phase 2 sees the same covered keys, no notifier calls.
  await persistAndReconcile(rel, nextState, body, args.obligationId, args.cycleId);
  log.info("encore", "recordValues: values recorded", {
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    keys: Object.keys(args.values),
  });
  return {
    ok: true,
    message: `Encore: recorded ${Object.keys(args.values).length} value(s) on ${args.targetId} in cycle ${args.cycleId}.`,
    obligationId: args.obligationId,
    cycleId: args.cycleId,
    targetId: args.targetId,
    cyclePath: workspaceRelativePath(rel),
  };
}
