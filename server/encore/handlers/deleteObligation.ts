// `deleteObligation` handler — permanently remove an obligation and
// all its on-disk state (index + cycle files), gated on the
// obligation already being retired.
//
// UI-only verb (the /encore dashboard's delete button). Deliberately
// NOT in the LLM-facing `LLM_ENCORE_KINDS` enum — destructive bulk
// removal isn't something the LLM should trigger; the user reaches it
// explicitly through the dashboard with a click-again-to-confirm step.
//
// Safety rail (#requested): only a `retired` obligation can be deleted.
// Retiring already runs the reconciler, which clears every bell and
// sweeps every ticket for the obligation (clearAllForObligation), so a
// retired obligation has no live notifications to orphan. The
// status check is the authoritative guard; the dashboard mirrors it by
// only showing the button on retired rows (defense in depth).

import { z } from "zod";

import { obligationDir, obligationIndexPath } from "../paths.js";
import { readTextOrNull, removeDir } from "../../utils/files/encore-io.js";
import { parseIndexFile } from "../obligation.js";
import { clearAllForObligation } from "../reconcile.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, type EncoreDispatchResult } from "./shared.js";

export const DeleteObligationArgs = z.object({
  kind: z.literal("deleteObligation"),
  // `.trim().min(1)` so empty/whitespace ids are rejected with a clear
  // 400 rather than crashing inside the path builder — same guard as
  // amendDefinition.
  obligationId: z.string().trim().min(1),
});

export async function handleDeleteObligation(args: z.infer<typeof DeleteObligationArgs>): Promise<EncoreDispatchResult> {
  const indexPath = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexPath);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }

  const { dsl } = parseIndexFile(raw);
  if (dsl.status !== "retired") {
    throw new EncoreError(
      400,
      `deleteObligation: only a retired obligation can be deleted (status is ${JSON.stringify(dsl.status)}). Retire it first, then delete.`,
    );
  }

  // Belt-and-suspenders: a retired obligation's bells/tickets were
  // already swept when it was retired, but clearing again is
  // idempotent and protects against a ticket that was written
  // out-of-band (or a retire that raced a publish) surviving the
  // directory removal as an orphan bell.
  await clearAllForObligation(args.obligationId, "obligation deleted", log);
  await removeDir(obligationDir(args.obligationId));
  log.info("encore", "deleteObligation: removed", { obligationId: args.obligationId });

  return {
    ok: true,
    message: `Encore obligation ${JSON.stringify(args.obligationId)} deleted.`,
    obligationId: args.obligationId,
  };
}
