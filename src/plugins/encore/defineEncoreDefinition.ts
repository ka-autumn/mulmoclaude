// MCP ToolDefinition for `defineEncore` — the structural tool that
// composes or modifies an Encore DSL document.
//
// Discriminator: `obligationId` presence.
//   - absent → setup (server generates `id` from `displayName`,
//     rejects with 409 if the slug collides with an existing
//     obligation — see `requireUniqueObligationId` in dispatch.ts)
//   - present → amend the named obligation (shallow-merge top-level)
//
// The choice to use parameter PRESENCE as the discriminator (instead
// of a `kind: "setup" | "amendDefinition"` enum) gives the LLM a
// natural mental model: "I have an id" / "I don't". The setup vs
// amend intent IS the parameter shape, no redundant flag.
//
// The `dsl` JSON Schema is AUTO-DERIVED from the runtime Zod
// validator (`z.toJSONSchema(EncoreDslInput)`) — so the LLM sees
// the same field names, types, and oneOf branches the server
// enforces, with zero drift risk. The schema lives at
// `src/types/encore-dsl/` (was `server/encore/dsl/`) so plugin
// code can import it without crossing the no-server-imports lint
// boundary.

import { z } from "zod";
import type { ToolDefinition } from "gui-chat-protocol";
import { EncoreDslInput } from "../../types/encore-dsl/schema";
import { META } from "./defineEncoreMeta";

export const TOOL_NAME = META.toolName;

// Strip `$schema` — that's a top-level JSON Schema declaration, not
// valid as a property subschema. The rest (`oneOf` / `type` /
// `properties` / ...) is what we want inside `parameters.dsl`.
const generatedDslSchema = z.toJSONSchema(EncoreDslInput) as Record<string, unknown>;
const { $schema: __ignored, ...dslJsonSchema } = generatedDslSchema;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Use defineEncore to compose a NEW Encore obligation (no `obligationId` argument) or AMEND an existing one (pass its `obligationId`). " +
    "The `dsl` argument is an OBJECT LITERAL — never a JSON-encoded string. " +
    "Setup: provide the complete DSL document (version / displayName / type / cadence / targets / steps / formSchema). " +
    "Amend: provide ONLY the top-level fields you want to change — the server shallow-merges onto the existing DSL. " +
    "Read `config/helps/encore-dsl.md` for the full grammar, severity rules, and worked examples.",
  description:
    "Compose a new Encore obligation, or amend an existing one (pass obligationId). Operational actions (markStepDone, snooze, query, …) live on the sibling manageEncore tool.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [TOOL_NAME],
        description: "Fixed value; the tool's only kind.",
      },
      dsl: {
        ...dslJsonSchema,
        description:
          "Encore DSL document (OBJECT LITERAL — do NOT pass a JSON-encoded string). " +
          "For setup (no obligationId): provide every required field shown in the schema. " +
          "For amend (with obligationId): provide ONLY the top-level fields you want to change — others are preserved from the existing DSL. " +
          "See `config/helps/encore-dsl.md` for cross-field rules and worked examples.",
      },
      obligationId: {
        type: "string",
        description:
          "Present → amend the named obligation. Absent → setup a new one (server generates the id from displayName). If you intend to amend but forget this, the server rejects with 409 and tells you the id to pass.",
      },
    },
    required: ["kind", "dsl"],
    additionalProperties: false,
  },
};

export default toolDefinition;
