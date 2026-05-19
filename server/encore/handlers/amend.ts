// `amendDefinition` handler — shallow-merge a patch onto an existing
// obligation's DSL, then republish bells.
//
// Merge semantics are documented in `config/helps/encore-dsl.md`
// (Amend section). Top-level keys merge; array fields (`targets`,
// `steps`, `formSchema`) replace whole. `type`, `currency`,
// `cadence.type`, `id`, and `createdAt` are immutable.

import { z } from "zod";

import { EncoreDslInput, type EncoreDsl } from "../../../src/types/encore-dsl/schema.js";
import { obligationIndexPath } from "../paths.js";
import { readTextOrNull, writeText } from "../../utils/files/encore-io.js";
import { parseIndexFile, serializeIndexFile } from "../obligation.js";
import { reconcileCycleNotifications } from "../reconcile.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, coerceDefinitionToObject, formatZodError, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const AmendArgs = z.object({
  kind: z.literal("amendDefinition"),
  // `.trim().min(1)` so empty AND whitespace-only ids are rejected
  // at parse time with a clear 400, rather than crashing inside
  // `obligationIndexPath("")` / `obligationIndexPath("   ")` →
  // `assertSafeSegment` and bubbling as an opaque 500.
  obligationId: z.string().trim().min(1),
  // `z.unknown()` instead of `z.record(...)` so the handler can also
  // accept a JSON-encoded string and parse it via `coerceDefinitionToObject`
  // — same tolerance as setup. The handler validates the resulting
  // object shape before merging.
  definition: z.unknown(),
});

export async function handleAmend(args: z.infer<typeof AmendArgs>): Promise<EncoreDispatchResult> {
  const indexPath = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexPath);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl: existing, body } = parseIndexFile(raw);
  const patch = coerceDefinitionToObject(args.definition, "amendDefinition");

  // Immutable fields per Resolved #15 / #10: type, currency, and
  // cadence.type. Changing them would invalidate prior cycle records
  // (currency mid-life), break cycle-file naming (cadence.type), or
  // change the validation discriminator (type). Path: retire + new.
  if ("type" in patch && patch.type !== existing.type) {
    throw new EncoreError(400, "amendDefinition: changing `type` is not allowed — retire and create a new obligation");
  }
  if (existing.type === "payment" && "currency" in patch && patch.currency !== existing.currency) {
    throw new EncoreError(400, "amendDefinition: changing `currency` is not allowed — retire and create a new obligation");
  }
  if ("cadence" in patch) {
    const newCadence = patch.cadence as { type?: string } | undefined;
    if (newCadence && typeof newCadence.type === "string" && newCadence.type !== existing.cadence.type) {
      throw new EncoreError(400, "amendDefinition: changing `cadence.type` is not allowed — retire and create a new obligation");
    }
  }

  // Shallow merge at the top level, array fields replace whole.
  const merged: Record<string, unknown> = { ...(existing as unknown as Record<string, unknown>), ...patch };
  // Server-generated identity fields are always immutable. Even if
  // the LLM includes `id` or `createdAt` in the patch (mistake),
  // force them back to the existing values — letting `id` change
  // would desync the directory name (`obligations/<args.obligationId>/`)
  // from `dsl.id`, and tickets / queries written under the new id
  // would point at files that aren't there.
  merged.id = existing.id;
  merged.createdAt = existing.createdAt;

  let validated: EncoreDsl;
  try {
    validated = EncoreDslInput.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EncoreError(400, `amendDefinition: ${formatZodError(err)}`, { issues: err.issues });
    }
    throw err;
  }

  await writeText(indexPath, serializeIndexFile(validated, body));

  // Re-run the reconciler so any DSL-driven content drift (the most
  // common amend is a `displayName` edit) flushes to the bells. The
  // trim path detects title/body drift per ticket and calls
  // `notifier.update` in place — same notificationId, no history
  // record, no flicker. Prior to that engine op, this call required
  // an `invalidateAllBells: true` flag that nuked every bell for the
  // cycle and republished them; the flag and its supporting
  // `clearAllForCycle` helper are gone.
  await reconcileCycleNotifications({ obligationId: args.obligationId, now: new Date(), log });
  log.info("encore", "amendDefinition: obligation updated", { obligationId: args.obligationId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(validated.displayName)} updated (id: ${args.obligationId}).`,
    obligationId: args.obligationId,
    indexPath: workspaceRelativePath(indexPath),
  };
}
