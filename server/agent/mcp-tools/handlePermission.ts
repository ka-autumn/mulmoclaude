// Permission-prompt-tool handler — wired via the Claude CLI's
// `--permission-prompt-tool mcp__mulmoclaude__handlePermission`
// flag in `buildCliArgs`. Whenever a built-in CLI tool's own
// `checkPermissions()` returns `behavior: "ask"` (i.e. it wants
// to gate on the user), the CLI calls this tool instead of
// surfacing an interactive prompt — which is what we need
// because MulmoClaude drives the CLI in headless stream-json
// mode with no TTY for the user to answer on.
//
// The CLI expects a JSON-encoded permission decision wrapped in
// a single MCP text block. We return the decision as a string;
// the MCP bridge in `mcp-server.ts` already wraps tool-handler
// strings as `{type:"text", text:<str>}`, which matches the
// CLI's expected shape.
//
// Decision shape (per the Claude Code 2.1.x CLI):
//   { behavior: "allow", updatedInput: <object> }
//   { behavior: "deny",  message: <string> }
//
// Current policy:
//   - `AskUserQuestion` is always denied with an instruction
//     telling the LLM to use `presentForm` instead. The CLI's
//     built-in AskUserQuestion has no UI surface in this
//     environment — without this handler the CLI would echo
//     the literal permission message `"Answer questions?"`
//     back to the LLM as the tool result, which the model
//     misreads as "the user skipped the question". See #1499.
//   - Every other ask-requiring tool is allowed through with
//     the input unchanged. We already pin the agent's effective
//     tool set via `--allowedTools`, so a permission ask that
//     reaches this handler means the tool is on the explicit
//     allow list and the host has no further policy to apply.

import type { McpTool, McpToolContext } from "./index.js";
import { log } from "../../system/logger/index.js";

const TOOL_NAME = "handlePermission";

// Match the literal name the Claude Code CLI emits in `tool_name`
// for the built-in clarifying-question tool. Exported so tests can
// pin against the same constant rather than a duplicated string.
export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";

const DENY_ASK_USER_QUESTION_MESSAGE =
  "AskUserQuestion is not supported in MulmoClaude — use the `presentForm` tool to collect the user's answer. " +
  "Build a small form with the same prompt and choices (radio for one-of, checkbox for many-of, text/textarea for free-form) and call presentForm with it. " +
  "Do not re-call AskUserQuestion; it will be denied again.";

interface PermissionInput {
  tool_name?: unknown;
  input?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAllowResponse(input: unknown): string {
  // CLI expects the permission decision as a JSON string. The
  // `updatedInput` must be the exact arg shape the original tool
  // will be called with — leave it untouched for the
  // pass-through case.
  return JSON.stringify({ behavior: "allow", updatedInput: isRecord(input) ? input : {} });
}

function buildDenyResponse(message: string): string {
  return JSON.stringify({ behavior: "deny", message });
}

export const handlePermission: McpTool = {
  definition: {
    name: TOOL_NAME,
    description:
      "Internal: permission decision hook called by the Claude Code CLI for tools whose `checkPermissions()` returns `behavior:'ask'`. Not for LLM use — the host wires it via `--permission-prompt-tool` and the CLI invokes it on every ask-mode permission check.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "Name of the tool the CLI is asking permission for (e.g. 'AskUserQuestion').",
        },
        input: {
          type: "object",
          description: "Original argument object the LLM passed to the tool.",
        },
      },
      required: ["tool_name", "input"],
    },
  },

  // Internal-only tool: don't surface it to the LLM via the
  // role's allowedTools / system prompt. The CLI calls it
  // directly through the `--permission-prompt-tool` flag.

  async handler(args: Record<string, unknown>, __ctx?: McpToolContext): Promise<string> {
    const raw = args as PermissionInput;
    const toolName = typeof raw.tool_name === "string" ? raw.tool_name : "";

    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      log.info("mcp/handlePermission", "deny AskUserQuestion — instruct LLM to use presentForm");
      return buildDenyResponse(DENY_ASK_USER_QUESTION_MESSAGE);
    }

    log.debug("mcp/handlePermission", "allow", { toolName });
    return buildAllowResponse(raw.input);
  },
};
