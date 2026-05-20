// `appendNote` handler — append free-form markdown to an obligation
// index body, or to a specific cycle body when `cycleId` is set.
//
// NOTE on INVARIANTS Rule 2 (mutation funnel): this handler does NOT
// route through `persistAndReconcile`. The reconciler reads
// `state.records` (closures, snoozes, skips) to compute bell state;
// it ignores the markdown body. A body-only write therefore has no
// effect on what the reconciler would decide, and forcing it through
// reconcile each call would only add CPU for a no-op. If a future
// rule ever derives bell state from the body, route through the
// funnel and revisit this comment.

import { z } from "zod";

import { parseCycleFile, serializeCycleFile } from "../cycle.js";
import { parseIndexFile, serializeIndexFile } from "../obligation.js";
import { cycleFilePath, obligationIndexPath } from "../paths.js";
import { readTextOrNull, writeText } from "../../utils/files/encore-io.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const AppendNoteArgs = z.object({
  kind: z.literal("appendNote"),
  obligationId: z.string().trim().min(1),
  cycleId: z.string().trim().min(1).optional(),
  // `.trim().min(1)` rejects whitespace-only notes — those would
  // pass `min(1)` and create effectively empty append calls that the
  // user can't easily distinguish from a real note in the file.
  body: z.string().trim().min(1),
});

export async function handleAppendNote(args: z.infer<typeof AppendNoteArgs>): Promise<EncoreDispatchResult> {
  if (args.cycleId) {
    const rel = cycleFilePath(args.obligationId, args.cycleId);
    const raw = await readTextOrNull(rel);
    if (raw === null) {
      throw new EncoreError(404, `cycle file ${args.obligationId}/${args.cycleId}.md not found`);
    }
    const { state, body } = parseCycleFile(raw);
    const newBody = appendBody(body, args.body);
    await writeText(rel, serializeCycleFile(state, newBody));
    log.info("encore", "appendNote: cycle body updated", { obligationId: args.obligationId, cycleId: args.cycleId });
    return {
      ok: true,
      message: `Note appended to cycle ${args.cycleId} of ${args.obligationId}.`,
      obligationId: args.obligationId,
      cycleId: args.cycleId,
      path: workspaceRelativePath(rel),
    };
  }

  const indexRel = obligationIndexPath(args.obligationId);
  const raw = await readTextOrNull(indexRel);
  if (raw === null) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }
  const { dsl, body } = parseIndexFile(raw);
  const newBody = appendBody(body, args.body);
  await writeText(indexRel, serializeIndexFile(dsl, newBody));
  log.info("encore", "appendNote: obligation body updated", { obligationId: args.obligationId });
  return {
    ok: true,
    message: `Note appended to obligation ${args.obligationId}.`,
    obligationId: args.obligationId,
    path: workspaceRelativePath(indexRel),
  };
}

function appendBody(existing: string, addition: string): string {
  if (existing.trim().length === 0) return addition.endsWith("\n") ? addition : `${addition}\n`;
  const sep = existing.endsWith("\n") ? "" : "\n";
  const tail = addition.endsWith("\n") ? addition : `${addition}\n`;
  return `${existing}${sep}\n${tail}`;
}
