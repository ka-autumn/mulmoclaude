// `startObligationChat` handler — user-initiated chat about a
// specific obligation. Reached from the dashboard chat button
// (`/encore` landing); NOT exposed in the LLM-facing tool schema.
//
// Compared to `resolveNotification` (the bell-click path):
//   - No ticket. There's no notification to clear and no severity
//     baseline to track — this is purely user-initiated.
//   - No reuse / idempotency. Each click yields a fresh chat. If
//     the user wants to continue a previous conversation, they
//     pick it from the sidebar instead.
//   - Seed prompt is composed here from the DSL (id + displayName)
//     rather than read from a ticket.

import { z } from "zod";
import { randomUUID } from "node:crypto";

import { startChat } from "../../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../../src/config/roles.js";
import { ENCORE_PLUGIN_PKG } from "../notifier.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, loadDsl, type EncoreDispatchResult } from "./shared.js";

export const StartObligationChatArgs = z.object({
  kind: z.literal("startObligationChat"),
  obligationId: z.string().min(1),
});

function buildSeedPrompt(obligationId: string, displayName: string): string {
  // Mention the obligationId explicitly so the LLM can call
  // `manageEncore({ kind: "query", obligationId })` to read the
  // current state on its first turn without guessing.
  return `Let's talk about my "${displayName}" obligation (obligationId: ${obligationId}). Please query its current state first, then ask me what I'd like to do.`;
}

export async function handleStartObligationChat(args: z.infer<typeof StartObligationChatArgs>): Promise<EncoreDispatchResult> {
  const dsl = await loadDsl(args.obligationId);
  if (!dsl) {
    throw new EncoreError(404, `obligation ${JSON.stringify(args.obligationId)} not found`);
  }

  const chatSessionId = randomUUID();
  const result = await startChat({
    message: buildSeedPrompt(args.obligationId, dsl.displayName),
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
  if (result.kind === "error") {
    throw new EncoreError(result.status ?? 500, `startObligationChat: startChat failed — ${result.error}`);
  }

  log.info("encore", "startObligationChat: chat seeded", {
    obligationId: args.obligationId,
    chatSessionId,
  });

  return {
    ok: true,
    message: `Encore: opened chat ${chatSessionId} for ${args.obligationId}.`,
    chatId: chatSessionId,
    navigateTo: `/chat/${chatSessionId}`,
  };
}
