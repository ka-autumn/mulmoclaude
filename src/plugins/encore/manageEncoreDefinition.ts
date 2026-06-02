// MCP ToolDefinition for `manageEncore` (operational kinds only).
//
// Structural kinds (setup / amendDefinition) moved to the sibling
// `defineEncoreDefinition.ts`. The server-side dispatcher still
// accepts them on the wire for backward compat (the new
// `handleDefineEncore` translates to them internally), but the
// LLM-facing enum here is narrower so the LLM picks `defineEncore`
// for DSL composition and `manageEncore` for everything that
// happens after the obligation exists.
//
// Schema details live in the help file (`config/helps/encore-dsl.md`)
// which the host syncs into the workspace at every startup — keeping
// this `description` short and letting Claude lazy-read the help file
// for full grammar is the teaching strategy (see
// plans/done/feat-encore-plugin.md "Teaching the DSL to Claude").

import type { ToolDefinition } from "gui-chat-protocol";
import type { ResolvedRoute } from "../meta-types";
import { META } from "./manageEncoreMeta";

// Derive TOOL_NAME from META so the schema, MCP-bridge dispatch,
// and Vue executor can't drift apart. The host aggregators
// (TOOL_NAMES, API_ROUTES, WORKSPACE_PATHS) read META; everything
// downstream reads from here.
export const TOOL_NAME = META.toolName;

/** Resolved-route shape Encore exposes to the browser via
 *  `pluginEndpoints("encore")`. Derived from META so adding a new
 *  apiRoutes key flows into the type without manual edits. Shared
 *  between manageEncore and defineEncore — both POST to the same
 *  dispatch endpoint. */
export type EncoreEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

/** Server response shape for the `resolveNotification` dispatch kind
 *  (the bell-click path: EncoreRedirect.vue → handleResolveNotification).
 *  Success seeds (or reuses) a chat and returns where to navigate; the
 *  orphan path (the ticket was already swept) returns `orphan`/`error`/
 *  `cleared`. Every other failure throws server-side and surfaces as an
 *  HTTP error, so it never reaches this shape. Shared by the handler
 *  (producer) and the Vue redirect (consumer) so the two can't drift —
 *  the open `EncoreDispatchResult` envelope on the dispatch route can't
 *  enforce per-kind fields on its own. */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a `type` alias, not an `interface`: only a type-literal gets the implicit index signature that keeps this assignable to the open `EncoreDispatchResult` ({ [key: string]: unknown }) envelope the handler return flows through in dispatch.ts.
export type ResolveNotificationResult = {
  ok: boolean;
  message: string;
  chatId?: string;
  navigateTo?: string;
  orphan?: boolean;
  error?: string;
  cleared?: boolean;
};

/** Action kinds the LLM is allowed to invoke via the `manageEncore`
 *  MCP tool. Operational only — structural (setup / amendDefinition)
 *  lives on the `defineEncore` tool. `resolveNotification` is
 *  deliberately excluded because it's a browser-only action
 *  dispatched by the /encore page on mount (calls `startChat`
 *  server-side; calling it from inside an existing chat would spawn
 *  a duplicate chat).
 *
 *  When adding a new action kind, decide whether it's structural
 *  (writes/edits a DSL document → add to defineEncore) or
 *  operational (acts on existing obligation state → add here). */
export const LLM_ENCORE_KINDS = ["markStepDone", "markTargetSkipped", "recordValues", "query", "appendNote", "snooze", "unsnooze"] as const;

/** Every action kind the server-side dispatch handles, including
 *  browser-only ones and the structural kinds the server keeps for
 *  backward compat. NOT the enum exposed to Claude — used by the
 *  dispatch.ts switch and by tests. */
export const ALL_ENCORE_KINDS = [...LLM_ENCORE_KINDS, "resolveNotification", "setup", "amendDefinition", "defineEncore", "deleteObligation"] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Once an Encore obligation exists, use manageEncore to record what happened (markStepDone / markTargetSkipped / recordValues / appendNote), to defer reminders (snooze / unsnooze), or to query (query). " +
    "For composing a NEW obligation or amending an existing one's DSL, use the sibling defineEncore tool. " +
    "Read `config/helps/encore-dsl.md` before calling — it documents every action's call shape and bell-clearing semantics.",
  description: "Record progress on existing Encore obligations — close steps, skip targets, snooze, query.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...LLM_ENCORE_KINDS],
        description: "Which Encore action to perform.",
      },
      // Per-field type hints stay sparse — the handler validates the
      // rest of the args per-kind with Zod (see
      // server/encore/dispatch.ts), and a strict JSON-schema validator
      // can't express cross-field rules anyway. We declare ONLY the
      // fields where the LLM most often produces a structurally wrong
      // shape (and the resulting Zod error reads as a "schema problem"
      // that the LLM tends to loop on rather than self-correct).
      //
      // `values` (markStepDone / recordValues): the LLM commonly
      // JSON.stringify's it or wraps a single field-map in an array
      // (`"[{\"laps\": 0}]"`). Declaring `type: "object"` gives the LLM
      // a strong "this is an object literal" hint at compose time.
      values: {
        type: "object",
        description:
          'Flat field-map keyed by field name — e.g. `{"amount": 5000, "paidOn": "2026-05-16"}`. ' +
          "Do NOT pass a JSON-encoded string. Do NOT wrap in an array. Do NOT nest by targetId. " +
          "One call per target; the `values` are for that single target.",
        additionalProperties: true,
      },
    },
    required: ["kind"],
    // The remaining args (`obligationId` / `cycleId` / `targetId` /
    // `stepId` / `pendingId` / `body` / `range`) are short strings
    // or scalars the LLM gets right most of the time; documenting
    // them in the help file is cheaper than a JSON-schema constraint
    // that doesn't know which fields apply per kind.
    additionalProperties: true,
  },
};

export default toolDefinition;
