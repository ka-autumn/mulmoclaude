import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
// The View + Preview now live in @mulmoclaude/accounting-plugin/vue (shared
// with MulmoTerminal). The built-in host still wraps them in its own plugin
// scope. The host injects the network + pub/sub seams via
// `configureAccountingHost(...)` in src/main.ts before any View mounts.
import { AccountingView, AccountingPreview } from "@mulmoclaude/accounting-plugin/vue";
import toolDefinition from "./definition";
import { META } from "./meta";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

// MulmoClaude never invokes `execute()` at runtime (see ToolPlugin
// contract in src/tools/types.ts) — Claude → MCP → REST goes
// straight to /api/accounting. The implementation is kept as a
// one-line passthrough to satisfy the gui-chat-protocol shape.
export type AccountingActionData = Record<string, unknown>;

const accountingPlugin: ToolPlugin<AccountingActionData> = {
  toolDefinition,

  async execute(_context, args) {
    const toolName = toolDefinition.name;
    const { method, path } = META.apiRoutes.dispatch;
    const result = await apiCall<ToolResult<AccountingActionData>>(`/api/${META.apiNamespace}${path}`, { method, body: args });
    if (!result.ok) {
      return {
        toolName,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName,
      uuid: result.data.uuid ?? makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Working on the books...",
  viewComponent: wrapWithScope("accounting", AccountingView),
  previewComponent: wrapWithScope("accounting", AccountingPreview),
};

export default accountingPlugin;

export const REGISTRATION: PluginRegistration = {
  toolName: META.toolName,
  entry: accountingPlugin,
};
