// Encore plugin — server-side dispatch router.
//
// Data-only on-disk model (PR #1416 follow-up): cycle files hold
// only what the user recorded (values / skipped / completedSteps /
// snoozedSteps). Closure is derived. Bell-entry tracking lives in
// tickets, not in the cycle file.
//
// `dispatch(body)` is the single entry point; the Express adapter in
// `server/api/routes/encore.ts` calls it. The dispatch wrapper
// acquires the per-plugin mutex before each handler runs so two
// concurrent mutations can't race on writeFileAtomic, and so a
// reconcile from a handler can't double-publish with the hourly
// heartbeat.
//
// Handler bodies live in `./handlers/*.ts`; this file only wires
// kind→handler routing and the lock envelope. See
// `server/encore/INVARIANTS.md` for the lifecycle contract that
// handlers and the reconciler share.

import { z } from "zod";

import { withLock } from "./lock.js";
import { handleAmend, AmendArgs } from "./handlers/amend.js";
import { handleAppendNote, AppendNoteArgs } from "./handlers/appendNote.js";
import { handleDefineEncore, DefineArgs } from "./handlers/defineEncore.js";
import { handleDeleteObligation, DeleteObligationArgs } from "./handlers/deleteObligation.js";
import { handleMarkStepDone, MarkStepDoneArgs } from "./handlers/markStepDone.js";
import { handleMarkTargetSkipped, MarkTargetSkippedArgs } from "./handlers/markTargetSkipped.js";
import { handleQuery, QueryArgs } from "./handlers/query.js";
import { handleRecordValues, RecordValuesArgs } from "./handlers/recordValues.js";
import { handleResolveNotification, ResolveNotificationArgs } from "./handlers/resolveNotification.js";
import { handleSetup, SetupArgs } from "./handlers/setup.js";
import { handleSnooze, handleUnsnooze, SnoozeArgs, UnsnoozeArgs } from "./handlers/snooze.js";
import { handleStartObligationChat, StartObligationChatArgs } from "./handlers/startObligationChat.js";
import { handleListTickets, ListTicketsArgs } from "./handlers/listTickets.js";
import { handleStartSetupChat, StartSetupChatArgs } from "./handlers/startSetupChat.js";
import { EncoreError } from "./handlers/shared.js";
import type { EncoreDispatchBody, EncoreDispatchResult } from "./handlers/shared.js";

export { EncoreError } from "./handlers/shared.js";
export type { EncoreDispatchBody, EncoreDispatchResult } from "./handlers/shared.js";

/** Wrap a Zod parse to convert validation failures into a 400
 *  `EncoreError` with a field-path-aware message. Without this, the
 *  caller sees a generic 500 ("encore dispatch failed") and has no
 *  way to know whether the shape was wrong or the server actually
 *  crashed — Claude in particular tends to spiral with retries on
 *  generic errors. */
function safeParse<T>(schema: z.ZodType<T>, body: unknown, kind: string): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join(".") : "(root)";
    return `${fieldPath}: ${issue.message}`;
  });
  const summary = issues.join("; ");
  throw new EncoreError(400, `manageEncore(${kind}): invalid args — ${summary}. See config/helps/encore-dsl.md for the call shape.`, {
    issues: result.error.issues,
  });
}

async function dispatchInner(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  const { kind } = body;
  if (kind === "setup") return handleSetup(safeParse(SetupArgs, body, kind));
  if (kind === "amendDefinition") return handleAmend(safeParse(AmendArgs, body, kind));
  if (kind === "query") return handleQuery(safeParse(QueryArgs, body, kind));
  if (kind === "appendNote") return handleAppendNote(safeParse(AppendNoteArgs, body, kind));
  if (kind === "markStepDone") return handleMarkStepDone(safeParse(MarkStepDoneArgs, body, kind));
  if (kind === "markTargetSkipped") return handleMarkTargetSkipped(safeParse(MarkTargetSkippedArgs, body, kind));
  if (kind === "recordValues") return handleRecordValues(safeParse(RecordValuesArgs, body, kind));
  if (kind === "snooze") return handleSnooze(safeParse(SnoozeArgs, body, kind));
  if (kind === "unsnooze") return handleUnsnooze(safeParse(UnsnoozeArgs, body, kind));
  if (kind === "defineEncore") return handleDefineEncore(safeParse(DefineArgs, body, kind));
  return dispatchUiKind(kind, body);
}

/** UI-only verbs — dashboard / bell-triggered, deliberately NOT in the
 *  LLM-facing tool schema (`LLM_ENCORE_KINDS`). Split out of
 *  `dispatchInner` so neither routing function trips the
 *  cognitive-complexity ceiling as the kind list grows. */
async function dispatchUiKind(kind: string, body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  // Bell-click landing — seeds (or reuses) a chat for a live ticket.
  if (kind === "resolveNotification") return handleResolveNotification(safeParse(ResolveNotificationArgs, body, kind));
  // Dashboard chat button — the LLM reaches chat via the normal
  // session start path; this one is for users.
  if (kind === "startObligationChat") return handleStartObligationChat(safeParse(StartObligationChatArgs, body, kind));
  // Dashboard bell badge — lists live tickets. The LLM learns about
  // pending work through cycle state, not tickets.
  if (kind === "listTickets") return handleListTickets(safeParse(ListTicketsArgs, body, kind));
  // Dashboard "+ Add" button — seeds a new chat for composing a fresh
  // obligation.
  if (kind === "startSetupChat") return handleStartSetupChat(safeParse(StartSetupChatArgs, body, kind));
  // Dashboard delete button — destructive (removes the obligation's
  // whole on-disk tree), so it's gated server-side on the obligation
  // being retired and kept out of the LLM tool schema.
  if (kind === "deleteObligation") return handleDeleteObligation(safeParse(DeleteObligationArgs, body, kind));
  throw new EncoreError(400, `unknown kind ${JSON.stringify(kind)}`);
}

export async function dispatch(body: EncoreDispatchBody): Promise<EncoreDispatchResult> {
  if (!body || typeof body !== "object") {
    throw new EncoreError(400, "request body must be an object with a string `kind` field");
  }
  if (typeof body.kind !== "string") {
    throw new EncoreError(400, "missing or non-string `kind`");
  }
  // Serialise every dispatch through the per-plugin mutex (Resolved
  // #22). The mutex also covers handler-side reconcile calls since
  // we run them from inside this same critical section.
  return withLock(() => dispatchInner(body));
}
