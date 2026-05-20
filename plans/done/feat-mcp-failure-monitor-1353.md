# MCP Runtime Failure Monitor (#1353)

## Problem

Even after #1352 (boot-time preflight + skip) lands, an MCP server
that passed preflight can still fail at runtime:

- API key was valid yesterday but rotated today → repeated 401s.
- Upstream service is down → ECONNREFUSED.
- Wrong workspace / scope set in OAuth → repeated permission errors.

Today MulmoClaude has no per-server runtime failure signal. The
existing `mcpTracker` (`server/agent/backend/claude-code.ts:61`) only
notices the binary case "ToolSearch happened but no MCP tool was
ever called" — useful but coarse. An MCP that calls *succeeded* and
*also failed* slips through.

## Approach — parse `is_error` from `tool_result`

Anthropic's `tool_result` block carries `is_error?: boolean`. When an
MCP tool call ends in an error (server-reported, transport-reported,
or auth), Claude Code surfaces it in the stream-json with
`is_error: true`. That's our hook.

### Pipeline

1. **`server/agent/stream.ts`** — extend the `toolCallResult` event
   to carry `isError?: boolean`. Currently the parser strips this
   flag. Mirror the field on `SseToolCallResult` so it survives to
   the frontend (useful for #1354).
2. **`server/agent/mcpFailureMonitor.ts`** (new) — module-level
   monitor that tracks per-server consecutive failure count, with
   threshold-based reporting. The monitor:
   - Keeps a `Map<toolUseId, toolName>` from `toolCall` events to
     correlate tool-name with each `toolCallResult`.
   - For `mcp__<server>__<tool>` results, increments a per-server
     consecutive-failure counter on `is_error: true`, resets on
     success.
   - When a server crosses the threshold (default 3 consecutive
     failures), emits one `log.warn` + one `publishNotification`
     for that server. Idempotent per server until success resets
     the counter.
3. **`server/agent/backend/claude-code.ts`** — instantiate the
   monitor next to `mcpTracker`, feed each `agentEvent` through
   `monitor.track(event)`.
4. **Defensive wrapping** (#1353 acceptance "server resilience"):
   - Wrap `getActiveToolDescriptors` calls in defensive try/catch
     where they currently throw — none today since `activeTools.ts`
     is pure data, but the *consumers* (`buildSystemPrompt`,
     `buildCliArgs`) read from it. Audit and add a guard layer at
     `getActivePlugins` so a malformed role doesn't crash the
     agent.

### Bell notification shape

Mirror the existing `announcePluginMetaDiagnostics` pattern:

```ts
publishNotification({
  id: `mcp-failure-${serverId}`,
  kind: "system",
  title: "MCP server failing",
  body: `${serverId} returned errors on ${count} consecutive tool calls. Check the API key / network.`,
  action: { type: NOTIFICATION_ACTION_TYPES.none },
  priority: NOTIFICATION_PRIORITIES.high,
});
```

The `legacyId` dedup in the notification engine ensures a server
that's consistently failing across multiple agent runs only shows
one bell entry until the user dismisses it OR a success resets
the counter (which fires `dismissNotification(id)` on next success).

### Threshold rationale

A single `is_error: true` is *not* a sign of MCP brokenness — the
user might have asked the MCP something it can't answer ("create
page in database that doesn't exist"). Two consecutive could still
be a sequence of bad inputs.

Three+ consecutive errors with no successes in between is a strong
"this server is broken" signal: a healthy server returns success
*sometimes*, even if the user is asking weird things.

The threshold is exported as a constant so a future config or test
can override it. Default `MCP_FAILURE_THRESHOLD = 3`.

## What this does NOT do

- **Doesn't restart the MCP server.** That's the operator's call.
- **Doesn't capture stderr from the MCP subprocess.** Claude Agent
  SDK holds those handles, not MulmoClaude. Out of scope.
- **Doesn't gate tool registration.** A flagged server still appears
  in the tool list — #1354 will return a structured error from the
  flagged tools so the LLM can recover.

## Acceptance

- 3 consecutive `is_error: true` results on `mcp__notion__*` →
  warn log + bell notification with `id: "mcp-failure-notion"`.
- 1 success on `mcp__notion__*` after the flag → counter resets,
  next 3 failures re-flag (no zombie suppression).
- Mix of MCP servers failing → each gets its own counter + bell
  entry; one server's success doesn't reset another's count.
- Server boot completes even when `getActivePlugins` would otherwise
  throw on a malformed role (defensive guard).

## Test plan

`test/agent/test_mcpFailureMonitor.ts` — drives `monitor.track()`
with synthetic `AgentEvent`s. Cases:

1. **Threshold reached** — 3 errors → 1 notification + warn.
2. **Below threshold** — 2 errors → nothing.
3. **Reset on success** — 2 errors + 1 success + 2 errors → nothing.
4. **Per-server isolation** — notion failing 3× + github succeeding
   → only notion gets the notification.
5. **Non-MCP tool result** — `Bash` / `Read` errors are ignored.
6. **toolUseId not seen first** — orphan toolCallResult (no prior
   toolCall) is ignored without crashing.
