import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { MarkdownToolData, MarkdownArgs } from "../plugins/markdown/definition";
import { pluginCore } from "../core/plugin";
import View from "../plugins/markdown/View.vue";
import Preview from "../plugins/markdown/Preview.vue";

export const TOOL_NAME = "presentDocument";

export const plugin: ToolPlugin<MarkdownToolData, MarkdownToolData, MarkdownArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { MarkdownToolData, MarkdownArgs } from "../plugins/markdown/definition";
export type { MarkdownHostApp, MarkdownDispatchArgs, MarkdownDispatchResult, ExportPdfOptions, MarpThemeEntry } from "../plugins/markdown/contract";

export { TOOL_DEFINITION, executeDocument, pluginCore } from "../core/plugin";
export { isFilePath } from "../plugins/markdown/definition";
export { setFilesRawUrl } from "../utils/image/resolve";

export { View, Preview };

export default { plugin };
