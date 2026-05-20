// Encore plugin — second META (toolName-only sibling to manageEncoreMeta).
//
// Same pattern as `scheduler/automationsMeta.ts`: two tools share one
// apiNamespace, so only ONE meta declares apiNamespace/apiRoutes/
// workspaceDirs/mcpDispatch (the full one lives in `manageEncoreMeta.ts`).
// This file exists purely so the host aggregator's `TOOL_NAMES`
// records the second tool name; everything else is shared.

import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "defineEncore",
});
