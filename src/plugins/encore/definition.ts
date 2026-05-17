// MCP ToolDefinition for `manageEncore`. The argument shape is a
// discriminated union on `kind`; the LLM picks the action it wants
// and supplies the relevant fields. Schema details live in the help
// file (`config/helps/encore-dsl.md`) which the host syncs into the
// workspace at every startup — keeping this `description` short and
// letting Claude lazy-read the help file for full grammar is the
// teaching strategy (see plans/feat-encore-plugin.md "Teaching the
// DSL to Claude").

import type { ToolDefinition } from "gui-chat-protocol";
import type { ResolvedRoute } from "../meta-types";
import { META } from "./meta";

// Derive TOOL_NAME from META so the schema, MCP-bridge dispatch,
// and Vue executor can't drift apart. The host aggregators
// (TOOL_NAMES, API_ROUTES, WORKSPACE_PATHS) read META; everything
// downstream reads from here.
export const TOOL_NAME = META.toolName;

/** Resolved-route shape Encore exposes to the browser via
 *  `pluginEndpoints("encore")`. Derived from META so adding a new
 *  apiRoutes key flows into the type without manual edits. */
export type EncoreEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

/** Action kinds the LLM is allowed to invoke via the MCP tool.
 *
 *  `resolveNotification` is DELIBERATELY excluded from this list:
 *  it's a browser-only action dispatched by the /encore page on
 *  mount (when the user clicks a bell entry). It calls `startChat`
 *  server-side, which would create a brand-new chat if the LLM
 *  invoked it from inside an existing chat — never the right
 *  behavior. The dispatch handler still accepts it (over POST
 *  /api/encore from the page), but the MCP-facing enum hides it.
 *
 *  When adding a new action kind, decide whether the LLM should
 *  call it: if yes, add it here; if it's a browser-internal
 *  dispatch like resolveNotification, leave it out of this list
 *  and only handle it in dispatch.ts. */
export const LLM_ENCORE_KINDS = ["setup", "amendDefinition", "markStepDone", "markTargetSkipped", "recordValues", "query", "appendNote", "snooze"] as const;

/** Every action kind the server-side dispatch handles, including
 *  browser-only ones. Re-exported for the dispatch.ts switch and
 *  for tests; NOT the enum exposed to Claude. */
export const ALL_ENCORE_KINDS = [...LLM_ENCORE_KINDS, "resolveNotification"] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Encore registers recurring obligations (monthly payments, biannual taxes, annual physicals, daily check-ins, etc.) and surfaces reminders in the notification bell at the right times. " +
    "Read `helps/encore-dsl.md` before calling — it documents the DSL grammar, every action's call shape, bell-clearing semantics, and three worked examples.",
  description: "Manage recurring obligations defined in the Encore DSL — payments and services with cadence, targets, steps, and firing plans.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...LLM_ENCORE_KINDS],
        description: "Which Encore action to perform.",
      },
    },
    required: ["kind"],
    // The handler validates the rest of the args per-kind with Zod
    // (see src/plugins/encore/server.ts). Keeping the top-level
    // schema minimal lets Claude compose any shape and surface
    // structural errors via the help-file-pointer messages, rather
    // than fighting a strict JSON-schema validator that doesn't
    // know about cross-field rules.
    additionalProperties: true,
  },
};

export default toolDefinition;
