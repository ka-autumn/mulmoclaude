// Regression test for #1499 — the permission-prompt-tool MCP
// handler. The Claude Code CLI calls this whenever a built-in
// tool's checkPermissions returns `behavior:"ask"`; without this
// hook the CLI used to echo the literal `"Answer questions?"`
// permission message back to the LLM as the AskUserQuestion tool
// result, and the model treated it as "the user skipped the
// question". This test pins:
//
//   1. AskUserQuestion is denied with an actionable message that
//      redirects the LLM to presentForm.
//   2. Every OTHER ask-mode tool is also denied (deny-by-default
//      after Codex review on PR #1560 — auto-allow would silently
//      bypass the per-call consent the tool itself requested).
//   3. The return value is a JSON string matching the CLI's
//      `{ behavior, ... }` shape (the MCP bridge wraps it as a
//      single text block, which the CLI then parses).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handlePermission, ASK_USER_QUESTION_TOOL_NAME } from "../../server/agent/mcp-tools/handlePermission.js";

interface ParsedDeny {
  behavior: "deny";
  message: string;
}
interface ParsedAllow {
  behavior: "allow";
  updatedInput: Record<string, unknown>;
}

function parse(result: string): ParsedDeny | ParsedAllow {
  const parsed = JSON.parse(result) as ParsedDeny | ParsedAllow;
  return parsed;
}

describe("handlePermission MCP tool", () => {
  it("denies AskUserQuestion with an instruction to use presentForm", async () => {
    const result = await handlePermission.handler({
      tool_name: ASK_USER_QUESTION_TOOL_NAME,
      input: { questions: [{ question: "favourite colour?", options: ["red", "blue"] }] },
    });
    const decision = parse(result);
    assert.equal(decision.behavior, "deny");
    if (decision.behavior === "deny") {
      // The LLM needs a clear path forward — not just "denied".
      assert.match(decision.message, /presentForm/);
      assert.match(decision.message, /AskUserQuestion is not supported/);
    }
  });

  it("deny-by-default for every other ask-mode tool (no auto-allow)", async () => {
    // Codex security review on #1560: auto-allowing ask-mode for
    // arbitrary tools bypasses per-call user consent. Deny by
    // default; tools that we want unconditionally allowed should
    // be on `--allowedTools` instead so they never escalate here.
    const input = { command: "ls", description: "list workspace" };
    const result = await handlePermission.handler({ tool_name: "Bash", input });
    const decision = parse(result);
    assert.equal(decision.behavior, "deny");
    if (decision.behavior === "deny") {
      assert.match(decision.message, /Bash/);
      // Should suggest a non-ask alternative path, not silent fail.
      assert.match(decision.message, /alternative|presentForm|user/i);
    }
  });

  it("includes the tool name in the deny message for arbitrary unknown tools", async () => {
    const result = await handlePermission.handler({ tool_name: "WeirdNewTool", input: {} });
    const decision = parse(result);
    assert.equal(decision.behavior, "deny");
    if (decision.behavior === "deny") {
      assert.match(decision.message, /WeirdNewTool/);
    }
  });

  it("handles missing / non-string tool_name without crashing", async () => {
    const result = await handlePermission.handler({ tool_name: undefined as unknown, input: {} });
    const decision = parse(result);
    assert.equal(decision.behavior, "deny");
    if (decision.behavior === "deny") {
      assert.match(decision.message, /<unknown>/);
    }
  });

  it("returns a JSON-parseable string for every code path (the CLI parses it back)", async () => {
    for (const toolName of [ASK_USER_QUESTION_TOOL_NAME, "Bash", "Read", "Edit", "Glob"]) {
      const result = await handlePermission.handler({ tool_name: toolName, input: {} });
      assert.doesNotThrow(() => JSON.parse(result), `result for ${toolName} must be JSON`);
    }
  });

  it("declares the MCP tool name the CLI expects via --permission-prompt-tool", () => {
    // The host wires `--permission-prompt-tool mcp__mulmoclaude__handlePermission`
    // in `buildCliArgs`; this assertion catches a future rename.
    assert.equal(handlePermission.definition.name, "handlePermission");
  });
});
