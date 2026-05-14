// Pure dispatcher: maps an SseEvent into mutations on an ActiveSession
// via the AgentEventContext adapter. No Vue refs, no component scope.

import type { ActiveSession } from "../../types/session";
import type { SseEvent, SseToolCallResult } from "../../types/sse";
import { EVENT_TYPES, generationKey } from "../../types/events";
import type { ToolCallHistoryItem } from "../../types/toolCallHistory";
import { findPendingToolCall, toToolCallEntry } from "./toolCalls";
import { extractMcpHint } from "./mcpHint";
import { pushErrorMessage, applySkillEvent, applyTextEvent, applyToolResultToSession } from "../session/sessionHelpers";

export interface AgentEventContext {
  session: ActiveSession;
  refreshRoles: () => Promise<void>;
  scrollSidebarToBottom: () => void;
  onGenerationsDrained: () => void;
}

// Route a `toolCallResult` SSE event onto the pending history entry.
// Errors land on `entry.error` (drives the red chip) with an optional
// catalog-derived MCP hint; successes land on `entry.result`. Pulled
// out of `applyAgentEvent` so the dispatch switch keeps its cognitive
// complexity below the lint budget (#1354).
function applyToolCallResult(history: ToolCallHistoryItem[], event: SseToolCallResult): void {
  const entry = findPendingToolCall(history, event.toolUseId);
  if (!entry) return;
  if (event.isError === true) {
    entry.error = event.content;
    const hint = extractMcpHint(entry.toolName);
    if (hint !== null) entry.mcpHint = hint;
    return;
  }
  entry.result = event.content;
}

export async function applyAgentEvent(event: SseEvent, ctx: AgentEventContext): Promise<void> {
  const { session } = ctx;
  switch (event.type) {
    case EVENT_TYPES.toolCall:
      session.toolCallHistory.push(toToolCallEntry(event));
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.toolCallResult:
      applyToolCallResult(session.toolCallHistory, event);
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.status:
      session.statusMessage = event.message;
      return;
    case EVENT_TYPES.rolesUpdated:
      await ctx.refreshRoles();
      return;
    case EVENT_TYPES.text:
      applyTextEvent(session, event.message, event.source ?? "assistant", event.attachments);
      return;
    case EVENT_TYPES.skill:
      applySkillEvent(session, {
        skillName: event.skillName,
        skillScope: event.skillScope,
        skillPath: event.skillPath,
        skillDescription: event.skillDescription,
        message: event.message,
      });
      return;
    case EVENT_TYPES.toolResult:
      applyToolResultToSession(session, event.result);
      return;
    case EVENT_TYPES.error:
      console.error("[agent] error event:", event.message);
      pushErrorMessage(session, event.message);
      return;
    case EVENT_TYPES.sessionFinished:
      return;
    case EVENT_TYPES.generationStarted: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      session.pendingGenerations[mapKey] = {
        kind: event.kind,
        filePath: event.filePath,
        key: event.key,
      };
      return;
    }
    case EVENT_TYPES.generationFinished: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      Reflect.deleteProperty(session.pendingGenerations, mapKey);
      if (Object.keys(session.pendingGenerations).length === 0) {
        ctx.onGenerationsDrained();
      }
    }
  }
}
