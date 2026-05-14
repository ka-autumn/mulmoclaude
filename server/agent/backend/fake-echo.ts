// Test-only LLM backend. Loaded by `getActiveBackend()` only when
// `MULMOCLAUDE_FAKE_AGENT=1` (CI workflow boot wiring), and re-usable
// from unit tests via `setFakeResponse()` / `resetFakeResponse()`.
//
// Default behavior:
//   - emits a synthesized `claudeSessionId` so the orchestrator's
//     resume bookkeeping sees the same shape as a real run
//   - short-circuits `/<slug>` slash-command turns by reading the
//     seeded SKILL.md and echoing the canary marker line
//   - emits the concatenated per-session message history as the
//     assistant text reply, so context-recall tests (session L-12)
//     see prior turn content
//
// What this does NOT do: synthesize tool_call events for plugin
// Views (presentForm / presentHtml / presentMulmoScript / presentChart).
// An earlier iteration tried that and the Views never mounted —
// plugin canvases need the server-side tool handler to actually
// execute and produce an artifact, which the stub can't fake
// without becoming a per-plugin filesystem mock. Tests that need
// tool dispatch stay gated on `E2E_LIVE_NO_LLM=1`.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { EVENT_TYPES } from "../../../src/types/events.js";
import type { AgentEvent } from "../stream.js";
import type { AgentInput, LLMBackend } from "./types.js";

export interface FakeToolCall {
  toolName: string;
  args: unknown;
  /** Result string emitted in the matching `tool_call_result`.
   *  Defaults to `{ ok: true }` JSON. */
  result?: string;
}

export interface FakeResponse {
  /** Tool calls emitted before the text block. Default generator
   *  never emits any — tests that want tool events drive them
   *  through `setFakeResponse()`. */
  toolCalls?: readonly FakeToolCall[];
  /** Assistant text. Omit to skip the text event entirely. */
  text?: string;
}

export type FakeResponseFn = (input: AgentInput) => FakeResponse | Promise<FakeResponse>;

// Per-session conversation memory so context-recall tests see prior
// turn content in the reply. Cleared by `resetFakeResponse()`.
const sessionTurns = new Map<string, string[]>();

async function defaultResponse(input: AgentInput): Promise<FakeResponse> {
  // Slash-command turn shape: the SPA's "Run" button on a skill row
  // (e2e-live L-22) starts a new chat with `/<slug>` as the only
  // user message. Real Claude resolves this through its skill
  // pipeline and uses the SKILL.md body as system prompt; here we
  // short-circuit to read the seeded body and apply the
  // "respond with this exact line" heuristic the e2e-live canaries
  // rely on. Falls through to default echo on no match.
  const slashMatch = input.message.trim().match(/^\/([a-z0-9][a-z0-9-]*)$/i);
  if (slashMatch) {
    const skillReply = await replyFromSeededSkill(input.workspacePath, slashMatch[1]);
    if (skillReply !== null) return { text: skillReply };
  }

  const history = sessionTurns.get(input.sessionId) ?? [];
  history.push(input.message);
  sessionTurns.set(input.sessionId, history);

  return { text: history.join("\n\n") };
}

// Look up a project-scope skill seeded by `placeProjectSkill` and
// extract the canary line the seeded body asks the model to echo
// back ("respond with this exact line and nothing else: X").
// Returns null when the file is missing or the marker shape is
// absent — caller falls through to default echo.
async function replyFromSeededSkill(workspacePath: string, slug: string): Promise<string | null> {
  const skillFile = path.join(workspacePath, ".claude/skills", slug, "SKILL.md");
  let body: string;
  try {
    body = await readFile(skillFile, "utf8");
  } catch {
    return null;
  }
  // Line-by-line scan to avoid backtracking surprises.
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/respond with this exact line(?: and nothing else)?:\s*(.+)/i);
    if (match) return match[1].trim();
  }
  return null;
}

// ── Backend wiring ────────────────────────────────────────────────

let responseFn: FakeResponseFn = defaultResponse;

/** Replace the default echo + slash-command generator. Useful for
 *  unit tests that want full control over what the fake backend
 *  emits. Pair with `resetFakeResponse()` in teardown so the next
 *  test sees a clean state. */
export function setFakeResponse(generator: FakeResponseFn): void {
  responseFn = generator;
}

/** Restore the default generator AND clear per-session history. */
export function resetFakeResponse(): void {
  responseFn = defaultResponse;
  sessionTurns.clear();
}

async function* runFakeEchoAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  yield { type: EVENT_TYPES.claudeSessionId, id: randomUUID() };

  const response = await responseFn(input);

  for (const call of response.toolCalls ?? []) {
    const toolUseId = `fake-${randomUUID()}`;
    yield {
      type: EVENT_TYPES.toolCall,
      toolUseId,
      toolName: call.toolName,
      args: call.args,
    };
    yield {
      type: EVENT_TYPES.toolCallResult,
      toolUseId,
      content: call.result ?? '{"ok":true}',
    };
  }

  if (response.text !== undefined) {
    yield { type: EVENT_TYPES.text, message: response.text };
  }
}

export const fakeEchoBackend: LLMBackend = {
  id: "fake-echo",
  // Resume-by-token / MCP aren't meaningfully replayable from a
  // stub. Flag them unsupported so callers that depend on the real
  // Claude semantics opt out instead of getting silently wrong
  // behavior.
  capabilities: { sessionResume: false, mcp: false },
  runAgent: runFakeEchoAgent,
};
