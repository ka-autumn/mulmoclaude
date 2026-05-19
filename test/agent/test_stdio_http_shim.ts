import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildStdioCommand } from "../../server/agent/stdioHttpShim.js";

// supergateway runs the `--stdio` string via a shell, so the only
// thing that matters is: when a POSIX shell re-parses our string, it
// MUST yield exactly the original argv. This round-trips through real
// `sh` (NUL-delimited so embedded newlines can't corrupt the split).
function shellTokenize(stdioCommand: string): string[] {
  const out = execFileSync("sh", ["-c", `printf '%s\\0' ${stdioCommand}`]);
  const parts = out.toString("utf8").split("\0");
  parts.pop(); // trailing empty after the last NUL
  return parts;
}

describe("buildStdioCommand", () => {
  it("round-trips a plain command + args", () => {
    const cmd = buildStdioCommand({ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] });
    assert.deepEqual(shellTokenize(cmd), ["npx", "-y", "@modelcontextprotocol/server-memory"]);
  });

  it("preserves whitespace inside a single arg", () => {
    const cmd = buildStdioCommand({ type: "stdio", command: "python", args: ["-c", "import sys; print('a b')"] });
    assert.deepEqual(shellTokenize(cmd), ["python", "-c", "import sys; print('a b')"]);
  });

  it("neutralises shell metacharacters (no expansion / injection)", () => {
    const evil = ["$(touch /tmp/pwned)", "`id`", "a;b|c&d", "$HOME", "x>y<z", "'quoted'", '"dq"', "(paren)"];
    const cmd = buildStdioCommand({ type: "stdio", command: "echo", args: evil });
    // Every metacharacter token must survive verbatim — no command
    // substitution, no var expansion, no word splitting.
    assert.deepEqual(shellTokenize(cmd), ["echo", ...evil]);
  });

  it("handles empty-string args and embedded single quotes", () => {
    const cmd = buildStdioCommand({ type: "stdio", command: "tool", args: ["", "it's a 'test'"] });
    assert.deepEqual(shellTokenize(cmd), ["tool", "", "it's a 'test'"]);
  });
});
