import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { ChartArgs, PresentChartData } from "../core/types";
import { pluginCore } from "../core/plugin";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<PresentChartData, PresentChartData, ChartArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { ChartArgs, ChartDocument, ChartEntry, PresentChartData } from "../core/types";
export { TOOL_NAME, TOOL_DEFINITION, executeChart, isValidChartDocument, pluginCore, type ChartExecuteContext } from "../core/plugin";
export { View, Preview };

export default { plugin };
