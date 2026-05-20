// `resolveNotification` handler — handle the bell-click path. Seeds
// a fresh chat session for an active ticket, or clears an orphan
// bell entry whose ticket was already swept.
//
// DOCUMENTED EXCEPTION to the reconciler-owns-the-bell rule:
// `handleOrphanResolve` calls `encoreNotifier.clear` directly because
// there's no ticket to reconcile against. See server/encore/INVARIANTS.md.

import { z } from "zod";
import { randomUUID } from "node:crypto";

import { ticketPath } from "../paths.js";
import { readTextOrNull, writeText } from "../../utils/files/encore-io.js";
import * as encoreNotifier from "../notifier.js";
import { ENCORE_PLUGIN_PKG } from "../notifier.js";
import { startChat } from "../../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../../src/config/roles.js";
import { log } from "../../system/logger/index.js";
import type { Ticket } from "../tick.js";
import { EncoreError, type EncoreDispatchResult } from "./shared.js";

export const ResolveNotificationArgs = z.object({
  kind: z.literal("resolveNotification"),
  pendingId: z.string(),
  /** Bell entry id, spliced onto the navigateTarget at click time
   *  by the host's NotificationBell.vue. Lets us clear orphan bell
   *  entries whose ticket was already swept. */
  notificationId: z.string().optional(),
});

async function handleOrphanResolve(args: z.infer<typeof ResolveNotificationArgs>): Promise<EncoreDispatchResult> {
  // The ticket was already swept (e.g. the LLM resolved the
  // obligation in another chat before this click). Clear the bell
  // entry so it disappears.
  //
  // DOCUMENTED EXCEPTION to the reconciler-owns-the-bell rule:
  // there's no ticket to reconcile against, so the reconciler can't
  // know the bell entry exists. Direct clear is the only way out.
  let cleared = false;
  if (args.notificationId) {
    try {
      await encoreNotifier.clear(args.notificationId);
      cleared = true;
    } catch (err) {
      log.warn("encore", "resolveNotification: orphan clear failed", {
        notificationId: args.notificationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Distinguish three outcomes in the message so the caller can tell
  // whether action is still needed: cleared, no-id-to-clear-against,
  // or clear attempted but failed (warning was logged).
  const message = orphanMessage(cleared, args.notificationId !== undefined);
  return {
    ok: false,
    orphan: true,
    message,
    error: "ticket not found",
    cleared,
  };
}

function orphanMessage(cleared: boolean, hadNotificationId: boolean): string {
  const head = "Encore: this notification has already been resolved (the ticket is gone).";
  if (cleared) return `${head} Bell entry cleared.`;
  if (hadNotificationId) return `${head} Bell entry clear was attempted but failed; the bell may still be visible.`;
  return head;
}

async function seedChatForTicket(ticket: Ticket, ticketRel: string, pendingId: string): Promise<string> {
  const chatSessionId = randomUUID();
  const result = await startChat({
    message: ticket.seedPrompt,
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
  if (result.kind === "error") {
    throw new EncoreError(result.status ?? 500, `resolveNotification: startChat failed — ${result.error}`);
  }
  await writeText(ticketRel, JSON.stringify({ ...ticket, chatSessionId }, null, 2));
  log.info("encore", "resolveNotification: chat seeded", {
    pendingId,
    chatSessionId,
    obligationId: ticket.obligationId,
    cycleId: ticket.cycleId,
  });
  return chatSessionId;
}

export async function handleResolveNotification(args: z.infer<typeof ResolveNotificationArgs>): Promise<EncoreDispatchResult> {
  const ticketRel = ticketPath(args.pendingId);
  const raw = await readTextOrNull(ticketRel);
  if (raw === null) return handleOrphanResolve(args);

  let ticket: Ticket;
  try {
    ticket = JSON.parse(raw) as Ticket;
  } catch (err) {
    throw new EncoreError(500, `ticket ${JSON.stringify(args.pendingId)} is unparseable`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Idempotency: if this ticket already has a chat session, reuse
  // it rather than spawning a duplicate on double-click.
  const { chatSessionId: existing } = ticket;
  const chatSessionId = existing ?? (await seedChatForTicket(ticket, ticketRel, args.pendingId));
  if (existing) {
    log.info("encore", "resolveNotification: reusing existing chat", { pendingId: args.pendingId, chatSessionId });
  }

  return {
    ok: true,
    message: `Encore: opened chat ${chatSessionId} for ${ticket.obligationId}/${ticket.cycleId}.`,
    chatId: chatSessionId,
    navigateTo: `/chat/${chatSessionId}`,
  };
}
