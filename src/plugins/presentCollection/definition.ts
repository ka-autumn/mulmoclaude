import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";
import { TOOL_DEFINITION } from "@mulmoclaude/collection-plugin";

// presentCollection's tool schema + executor now live in the shared
// @mulmoclaude/collection-plugin package (single source of truth, also consumed
// by MulmoTerminal). This built-in is a thin host adapter: it keeps MulmoClaude's
// host-specific routing META + endpoint types while sourcing the definition from
// the package. The plugin codegen scans this file's default ToolDefinition export.
//
// TOOL_NAME is derived from META (the host's plugin-identity contract), not
// re-exported from the package — same as the other built-in adapters.
export const TOOL_NAME = META.toolName;
export type PresentCollectionEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export { TOOL_DEFINITION };
export default TOOL_DEFINITION;
