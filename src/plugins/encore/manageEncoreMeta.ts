// Encore plugin META — the central-registry-facing metadata.
// Imported by host aggregators (`src/config/*` and
// `server/workspace/paths.ts`) which iterate over every plugin's META
// and merge automatically. Host code holds zero plugin-specific
// literals.
//
// Browser-safe: no Vue / no Node-only imports.
//
// See plans/done/feat-encore-as-builtin.md for the architecture and
// plans/done/feat-encore-plugin.md for the DSL spec the handlers
// implement.

import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageEncore",
  apiNamespace: "encore",
  apiRoutes: {
    /** POST /api/encore — single dispatch with `kind` discriminator
     *  (setup / amendDefinition / markStepDone / markTargetSkipped /
     *  recordValues / query / appendNote / snooze / resolveNotification).
     *  Both the MCP bridge and the chat-on-mount page (`View.vue`,
     *  which dispatches `resolveNotification` on mount to start
     *  the chat server-side) POST here; the server splits by
     *  `kind`. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
  // `data/plugins/encore/` is the plain-name layout chosen for the
  // built-in (vs. the URL-encoded `%40mulmoclaude%2Fencore-plugin`
  // path the prior runtime-preset attempt used). See
  // plans/done/feat-encore-as-builtin.md "What's intentionally different".
  workspaceDirs: {
    encore: "data/plugins/encore",
  },
});
