import type { Component } from "vue";
import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import { View, Preview, TOOL_DEFINITION, type PresentChartData } from "@mulmoclaude/chart-plugin/vue";
// The package's component scoped styles are compiled into a standalone
// stylesheet; Vite lib mode does NOT auto-inject it, so the consumer must
// import it — same as @mulmoclaude/{form,markdown}-plugin.
import "@mulmoclaude/chart-plugin/style.css";
import { TOOL_NAME, type ChartEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

// The chart's schema, validation, View, and Preview come from the shared
// @mulmoclaude/chart-plugin package. MulmoClaude keeps the client-side create
// path (POST /api/chart) — the host route injects the generic `files.artifacts`
// capability and calls the package's executeChart. We re-wrap the package's
// components in MulmoClaude's scoped runtime provider (wrapWithScope) so the
// package's useT()/locale resolves to the host.
const chartPlugin: ToolPlugin<PresentChartData> = {
  // gui-chat-protocol type is externalized but yarn-4's dual-@vue can make the
  // package's nominal types distinct; coerce once here.
  toolDefinition: TOOL_DEFINITION as ToolPlugin<PresentChartData>["toolDefinition"],

  async execute(_context, args) {
    const endpoints = pluginEndpoints<ChartEndpoints>("chart");
    const { method, url } = endpoints.create;
    const result = await apiCall<ToolResult<PresentChartData>>(url, { method, body: args });
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: TOOL_NAME,
      uuid: makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Rendering chart…",
  viewComponent: wrapWithScope("chart", View as unknown as Component),
  previewComponent: wrapWithScope("chart", Preview as unknown as Component),
};

export default chartPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: chartPlugin,
};
