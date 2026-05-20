// `setup` handler — provision a new obligation from a DSL document.

import { z } from "zod";

import { EncoreDslInput, type EncoreDsl } from "../../../src/types/encore-dsl/schema.js";
import { buildCycleState, serializeCycleFile } from "../cycle.js";
import { currentCycleSlot } from "../../../src/types/encore-dsl/cadence.js";
import { serializeIndexFile } from "../obligation.js";
import { cycleFilePath, obligationIndexPath, slugify } from "../paths.js";
import { exists, writeText } from "../../utils/files/encore-io.js";
import { reconcileCycleNotifications } from "../reconcile.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, coerceDefinitionToObject, formatZodError, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const SetupArgs = z.object({
  kind: z.literal("setup"),
  definition: z.unknown(),
});

/** Setup-time id allocation. Reject with 409 if the slugified
 *  `displayName` collides with an existing obligation — the LLM
 *  almost certainly intended to amend an existing obligation but
 *  forgot to pass `obligationId`. The previous behavior (silently
 *  auto-number `-2`, `-3`) masked that mistake and produced
 *  parallel duplicates. The reject message tells the LLM how to
 *  recover (pass `obligationId` to make it an amend, or change
 *  `displayName`). See plans/done/feat-encore-define-tool.md. */
async function requireUniqueObligationId(displayName: string): Promise<string> {
  const slug = slugify(displayName);
  if (!(await exists(obligationIndexPath(slug)))) return slug;
  throw new EncoreError(
    409,
    `Obligation ${JSON.stringify(slug)} already exists (displayName: ${JSON.stringify(displayName)}). ` +
      `To modify it, call defineEncore with obligationId: ${JSON.stringify(slug)} (this becomes an amend). ` +
      `To create a parallel obligation, change the displayName.`,
  );
}

export async function handleSetup(args: z.infer<typeof SetupArgs>): Promise<EncoreDispatchResult> {
  const definitionObject = coerceDefinitionToObject(args.definition, "setup");
  let dsl: EncoreDsl;
  try {
    dsl = EncoreDslInput.parse(definitionObject);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, formatZodError(err), { issues: err.issues });
    }
    throw err;
  }

  const obligationId = await requireUniqueObligationId(dsl.displayName);
  const fullDsl: EncoreDsl = {
    ...dsl,
    id: obligationId,
    createdAt: new Date().toISOString(),
  };

  // Provision the first cycle synchronously so the obligation has
  // something to fire against on the very next tick.
  const slot = currentCycleSlot(fullDsl.cadence, new Date());
  const cycle = buildCycleState(fullDsl, slot);

  await writeText(obligationIndexPath(obligationId), serializeIndexFile(fullDsl, ""));
  await writeText(cycleFilePath(obligationId, cycle.cycleId), serializeCycleFile(cycle, ""));

  // Reconcile so that if the firingPlan's first phase is already due
  // (cycle-start with no offset, for example), the bell surfaces the
  // notification within the same SSE turn.
  await reconcileCycleNotifications({ obligationId, cycleId: cycle.cycleId, now: new Date(), log });

  log.info("encore", "setup: obligation created", { obligationId, cycleId: cycle.cycleId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(dsl.displayName)} created (id: ${obligationId}, first cycle: ${cycle.cycleId}, deadline: ${cycle.cycleDeadline}).`,
    obligationId,
    cycleId: cycle.cycleId,
    cyclePath: workspaceRelativePath(cycleFilePath(obligationId, cycle.cycleId)),
    indexPath: workspaceRelativePath(obligationIndexPath(obligationId)),
  };
}
