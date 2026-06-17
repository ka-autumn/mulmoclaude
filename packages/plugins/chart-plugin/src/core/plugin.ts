import type { FileOps, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { TOOL_NAME, TOOL_DEFINITION } from "./definition";
import { chartArtifactPath } from "./paths";
import type { ChartArgs, ChartDocument, ChartEntry, PresentChartData } from "./types";

/** Host capabilities `executeChart` needs, delivered through the GENERIC
 *  gui-chat-protocol runtime — only `files.artifacts` (the shared,
 *  user-browsable output area). No chart-specific host method: all chart
 *  logic lives in this package. */
export interface ChartExecuteContext {
  files: { artifacts: FileOps };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidChartEntry(value: unknown): value is ChartEntry {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!isOptionalString(value.type)) return false;
  return isRecord(value.option);
}

export function isValidChartDocument(value: unknown): value is ChartDocument {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!Array.isArray(value.charts)) return false;
  if (value.charts.length === 0) return false;
  return value.charts.every((entry) => isValidChartEntry(entry));
}

/**
 * Validate the chart document and persist it to the shared artifacts area
 * (`artifacts/charts/<YYYY>/<MM>/<slug>-<ts>.chart.json`) via the generic
 * `files.artifacts` runtime capability. Returns a ToolResult whose `data`
 * drives the View and preview sidebar.
 */
export const executeChart = async (context: ChartExecuteContext, args: ChartArgs): Promise<ToolResult<PresentChartData>> => {
  const { document, title } = args;
  if (!isValidChartDocument(document)) {
    return {
      message: "document must be { charts: [{ option: {...}, title?, type? }, ...] } with at least one entry",
      instructions: "Acknowledge that the chart could not be created and retry with a valid ECharts document shape.",
    };
  }
  if (title !== undefined && typeof title !== "string") {
    return {
      message: "title must be a string when provided",
      instructions: "Acknowledge the error and retry with a string title (or omit it).",
    };
  }

  const baseLabel = title ?? document.title ?? "chart";
  const { relPath, filePath } = chartArtifactPath(baseLabel);
  await context.files.artifacts.write(relPath, `${JSON.stringify(document, null, 2)}\n`);

  const chartCount = document.charts.length;
  return {
    message: `Saved chart document to ${filePath}`,
    data: { document, title, filePath },
    instructions: `Acknowledge that the chart(s) have been presented to the user. The document contains ${chartCount} chart${chartCount === 1 ? "" : "s"}.`,
  };
};

export const pluginCore: ToolPluginCore<PresentChartData, PresentChartData, ChartArgs> = {
  toolDefinition: TOOL_DEFINITION,
  // `executeChart` reads host backends off `context.files.artifacts` rather
  // than gui-chat-protocol's `ToolContext`; bridge the nominal gap (the host
  // injects the matching shape) the same way @mulmoclaude/markdown-plugin does.
  execute: executeChart as unknown as ToolPluginCore<PresentChartData, PresentChartData, ChartArgs>["execute"],
  generatingMessage: "Rendering chart…",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
