// One row of the right-side tool-call history pane. Lifted out of
// `src/components/RightSidebar.vue` so non-component code (the
// session domain types, the pending-calls helper, etc.) can refer
// to it without depending on a Vue file.

import type { McpHint } from "../utils/agent/mcpHint";

export interface ToolCallHistoryItem {
  toolUseId: string;
  toolName: string;
  args: unknown;
  timestamp: number;
  result?: string;
  error?: string;
  /** Structured hint surfaced next to `error` when the failing tool
   *  belongs to a catalogued MCP server. Lets the right-sidebar
   *  render setup-guide links / required-key reminders without the
   *  caller re-parsing the tool name. (#1354) */
  mcpHint?: McpHint;
}
