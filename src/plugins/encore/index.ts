// Encore plugin registration — two MCP tools sharing one apiNamespace
// (same pattern as scheduler/{calendar,automations}):
//
//   - `defineEncore` — structural; composes or amends a DSL document.
//   - `manageEncore` — operational; records progress, queries, etc.
//
// Both POST to the same `/api/encore` dispatch endpoint. The server's
// dispatch.ts routes by the `kind` field in the body (`defineEncore`
// for the structural tool, `markStepDone` / `snooze` / `query` / ...
// for the operational one).
//
// Vue surface:
//   - One View at `/encore` (chat-on-mount for bell clicks). Shared
//     between both tools — the page only handles `resolveNotification`
//     and that's tool-independent.
//
// See plans/done/feat-encore-as-builtin.md for the original build plan,
// plans/done/feat-encore-plugin.md for the DSL spec, and
// plans/done/feat-encore-define-tool.md for why the tool was split.

import type { ToolResult } from "gui-chat-protocol";
import type { PluginEntry, PluginRegistration, ToolPlugin } from "../../tools/types";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";
import View from "./View.vue";
import manageEncoreDefinition, { TOOL_NAME as MANAGE_ENCORE, type EncoreEndpoints } from "./manageEncoreDefinition";
import defineEncoreDefinition, { TOOL_NAME as DEFINE_ENCORE } from "./defineEncoreDefinition";
import { META as MANAGE_META } from "./manageEncoreMeta";

export interface EncoreData {
  kind?: string;
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}

/** Generate an `execute` function bound to a specific toolName so
 *  the result envelope carries the matching name through to chat
 *  history and View lookup. Both tools POST to the same dispatch
 *  endpoint (resolved from `MANAGE_META.apiNamespace`, which both
 *  tools share). */
function makeExecute(toolName: typeof MANAGE_ENCORE | typeof DEFINE_ENCORE): ToolPlugin<EncoreData>["execute"] {
  return async function execute(_context, args) {
    const endpoints = pluginEndpoints<EncoreEndpoints>(MANAGE_META.apiNamespace);
    const { method, url } = endpoints.dispatch;
    const result = await apiCall<ToolResult<EncoreData>>(url, { method, body: args });
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
  };
}

export const manageEncorePlugin: ToolPlugin<EncoreData> = {
  toolDefinition: manageEncoreDefinition,
  execute: makeExecute(MANAGE_ENCORE),
  isEnabled: () => true,
  generatingMessage: "Updating Encore...",
  viewComponent: wrapWithScope("encore", View),
};

export const defineEncorePlugin: ToolPlugin<EncoreData> = {
  toolDefinition: defineEncoreDefinition,
  execute: makeExecute(DEFINE_ENCORE),
  isEnabled: () => true,
  generatingMessage: "Composing Encore obligation...",
  // Reuse the same View — `defineEncore` doesn't produce its own
  // bell entries (it produces the obligation; the tick produces the
  // bells), so there's nothing tool-specific to render. The shared
  // View handles the chat-on-mount flow for any Encore bell.
  viewComponent: wrapWithScope("encore", View),
};

const manageEntry: PluginEntry = manageEncorePlugin as unknown as PluginEntry;
const defineEntry: PluginEntry = defineEncorePlugin as unknown as PluginEntry;

// One plugin module, two tool registrations — scheduler pattern.
export const REGISTRATIONS: PluginRegistration[] = [
  { toolName: MANAGE_ENCORE, entry: manageEntry },
  { toolName: DEFINE_ENCORE, entry: defineEntry },
];

export default manageEncorePlugin;
