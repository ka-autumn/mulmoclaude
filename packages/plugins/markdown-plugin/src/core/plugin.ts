import type { ToolContext, ToolResult, ToolPluginCore } from "gui-chat-protocol";
import { TOOL_NAME, TOOL_DEFINITION, type MarkdownToolData, type MarkdownArgs } from "../plugins/markdown/definition";
import { executeMarkdown, type MarkdownExecuteContext } from "../plugins/markdown/core";
import type { MarkdownDispatchArgs } from "../plugins/markdown/contract";

async function createDocument(context: MarkdownExecuteContext, args: MarkdownArgs): Promise<ToolResult<MarkdownToolData>> {
  const { app } = context;
  if (!app) {
    throw new Error("markdown plugin: context.app (MarkdownHostApp) was not provided by the host");
  }
  const { title, markdown, filenamePrefix } = args;
  const filled = (await app.fillImages(markdown)).markdown;
  const { path } = await app.saveNewDoc(filenamePrefix ?? "document", filled);
  return {
    message: `Document created${title ? `: ${title}` : ""}`,
    // `data` is the host's render-gate signal + the view's source.
    data: { markdown: path, filenamePrefix },
    instructions: "The document has been presented to the user in a rendered markdown view.",
  };
}

function hasKind(value: unknown): value is MarkdownDispatchArgs {
  return typeof value === "object" && value !== null && "kind" in value;
}

/**
 * Single server-side entry. Two callers land here:
 *   - the View's `useRuntime().dispatch({ kind, … })` (load/save/pdf/themes/fill)
 *   - the LLM tool-call create path (`{ title, markdown, filenamePrefix }`, no kind)
 * Host backends arrive on `context.app` (gui-chat-protocol ToolContext.app).
 */
export const executeDocument = async (context: ToolContext, args: MarkdownArgs | MarkdownDispatchArgs): Promise<ToolResult<MarkdownToolData>> => {
  // The host injects MarkdownHostApp on context.app; bridge the nominal
  // ToolContextApp → MarkdownHostApp gap (runtime shape matches).
  const ctx = context as unknown as MarkdownExecuteContext;
  if (hasKind(args)) {
    // Dispatch results aren't ToolResults; the host route JSON-forwards
    // them verbatim and the View typed each call at its dispatch site.
    return executeMarkdown(ctx, args) as Promise<ToolResult<MarkdownToolData>>;
  }
  return createDocument(ctx, args);
};

export const pluginCore: ToolPluginCore<MarkdownToolData, MarkdownToolData, MarkdownArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeDocument as ToolPluginCore<MarkdownToolData, MarkdownToolData, MarkdownArgs>["execute"],
  generatingMessage: "Creating document...",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
