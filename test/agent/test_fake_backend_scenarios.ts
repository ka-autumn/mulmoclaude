// Scenario coverage for the fake-echo backend test seam. These
// exercise the failure-shaped paths that were previously
// unreachable without mocking the real Claude subprocess:
//
//   1. the backend yields an `error` event (CLI exited non-zero)
//   2. the response generator throws (programming error mid-turn)
//   3. the turn is aborted mid-stream (user cancel / timeout)
//   4. a partial stream — tool_call with no tool_call_result
//   5. an empty stream — only the session id, no text/tool
//
// They assert the *contract the consumer relies on* (the
// for-await loop in server/api/routes/agent.ts#runAgentInBackground
// + the begin/endRun lifecycle): every shape terminates the
// generator cleanly so `endRun` in the consumer's `finally` always
// runs and the session never gets stuck `isRunning`.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { fakeEchoBackend, setFakeResponse, resetFakeResponse } from "../../server/agent/backend/fake-echo.js";
import type { AgentInput } from "../../server/agent/backend/types.js";
import { ROLES, type Role } from "../../src/config/roles.js";
import { EVENT_TYPES } from "../../src/types/events.js";

function requireRole(roleId: string): Role {
  const role = ROLES.find((candidate) => candidate.id === roleId);
  if (!role) throw new Error(`test setup: role '${roleId}' not found`);
  return role;
}

const GENERAL_ROLE = requireRole("general");

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    systemPrompt: "test",
    message: "hello",
    role: GENERAL_ROLE,
    workspacePath: "/tmp/does-not-matter",
    sessionId: `test-${randomUUID()}`,
    port: 0,
    activePlugins: [],
    extraAllowedTools: [],
    useDocker: false,
    ...overrides,
  };
}

async function drain(input: AgentInput) {
  const events = [];
  for await (const event of fakeEchoBackend.runAgent(input)) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  resetFakeResponse();
});

describe("fake-echo backend — failure-shaped scenarios", () => {
  it("1. error event: surfaces an error AgentEvent and stops", async () => {
    setFakeResponse(() => ({ error: "claude exited with code 1", text: "should not appear" }));

    const events = await drain(makeInput());

    // claudeSessionId then the error — text is suppressed.
    assert.equal(events.at(-1)?.type, EVENT_TYPES.error);
    const errorEvent = events.find((event) => event.type === EVENT_TYPES.error);
    assert.equal(errorEvent?.message, "claude exited with code 1");
    assert.ok(!events.some((event) => event.type === EVENT_TYPES.text), "text must not be emitted once an error short-circuits the turn");
  });

  it("2. throwing generator: rejects so the consumer's try/catch runs", async () => {
    setFakeResponse(() => {
      throw new Error("boom in response generator");
    });

    // The consumer wraps the for-await in try/catch → pushes an
    // error event + endRun in finally. The contract here is just
    // "the generator rejects rather than hanging".
    await assert.rejects(() => drain(makeInput()), /boom in response generator/);
  });

  it("3. abort before consumption: yields nothing", async () => {
    setFakeResponse(() => ({ text: "unreachable" }));
    const controller = new AbortController();
    controller.abort();

    const events = await drain(makeInput({ abortSignal: controller.signal }));

    assert.deepEqual(events, [], "an already-aborted turn must emit no events");
  });

  it("3b. abort mid-stream: stops before the text event", async () => {
    const controller = new AbortController();
    // Abort while the response generator is resolving, before the
    // text event would be yielded.
    setFakeResponse(async () => {
      controller.abort();
      return { text: "should be cut off" };
    });

    const events = await drain(makeInput({ abortSignal: controller.signal }));

    assert.ok(!events.some((event) => event.type === EVENT_TYPES.text), "no text after an abort fired mid-turn");
  });

  it("4. partial stream: tool_call with no tool_call_result", async () => {
    setFakeResponse(() => ({
      toolCalls: [{ toolName: "presentForm", args: { fields: [] } }],
      omitToolResult: true,
    }));

    const events = await drain(makeInput());

    const calls = events.filter((event) => event.type === EVENT_TYPES.toolCall);
    const results = events.filter((event) => event.type === EVENT_TYPES.toolCallResult);
    assert.equal(calls.length, 1, "the tool_call half is emitted");
    assert.equal(results.length, 0, "the tool_call_result half is intentionally dropped");
  });

  it("5. empty stream: only the session id, no text/tool", async () => {
    setFakeResponse(() => ({}));

    const events = await drain(makeInput());

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, EVENT_TYPES.claudeSessionId);
  });

  it("6. plugin dispatch failure: surfaces an error in tool_call_result", async () => {
    // A known plugin tool whose endpoint is unreachable (port 1 has
    // no server) drives the `dispatchToPlugin` catch path added in
    // #1371. The tool_call still emits, but its result must carry
    // the failure instead of a fake "Done" — the fail-loud contract.
    setFakeResponse(() => ({
      toolCalls: [{ toolName: "presentForm", args: { fields: [] } }],
    }));

    const events = await drain(makeInput({ port: 1 }));

    const result = events.find((event) => event.type === EVENT_TYPES.toolCallResult);
    assert.ok(result, "the tool_call_result half must still be emitted on dispatch failure");
    assert.match(String(result?.content), /error/i, "the result content must carry the dispatch error, not a success envelope");
  });

  it("7. concurrent sessions keep separate history (no bleed)", async () => {
    // Default generator joins per-session message history. Two
    // sessions interleaved must not see each other's turns — the
    // `sessionTurns` map is keyed by sessionId.
    resetFakeResponse();
    const sessionA = makeInput({ sessionId: "sess-A", message: "alpha-secret" });
    const sessionB = makeInput({ sessionId: "sess-B", message: "beta-secret" });

    const eventsA = await drain(sessionA);
    const eventsB = await drain(sessionB);

    const textA = eventsA.find((event) => event.type === EVENT_TYPES.text);
    const textB = eventsB.find((event) => event.type === EVENT_TYPES.text);
    assert.match(String(textA?.message), /alpha-secret/);
    assert.ok(!String(textA?.message).includes("beta-secret"), "session A must not see session B's turn");
    assert.match(String(textB?.message), /beta-secret/);
    assert.ok(!String(textB?.message).includes("alpha-secret"), "session B must not see session A's turn");
  });
});
