import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";
import { TOOL_DEFINITION } from "@mulmoclaude/chart-plugin";

// presentChart's tool schema, validation, and UI now live in the shared
// @mulmoclaude/chart-plugin package (single source of truth, also consumed by
// MulmoTerminal). This built-in is a thin host adapter: it keeps MulmoClaude's
// host-specific routing META and scoped-runtime wrapping while sourcing the
// schema/logic/View from the package.
export const TOOL_NAME = META.toolName;

/** Resolved-URL view of the chart plugin's routes (create). Plugin code reads
 *  `endpoints.create.{method, url}` to drive `apiCall`. Auto-derived from META. */
export type ChartEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export { TOOL_DEFINITION };
export default TOOL_DEFINITION;
