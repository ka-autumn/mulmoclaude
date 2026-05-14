# MCP Error Hint Chip (#1354)

## Problem

After #1353 lands, `SseToolCallResult` carries `isError: true` when an
MCP tool call failed. The frontend currently just dumps the raw
`event.content` into the result chip — confusing 401 bodies or
"Unable to connect" stack traces that the user has no idea how to
act on.

## Scope (UI-only path of the original #1354 issue)

The issue's literal ask was "inject a structured error to the LLM via
a hook" so the LLM could guide the user. That requires significant
hook-dispatcher API change + bundling mcpCatalog into the hook
script — deferred until concrete demand justifies it.

This PR delivers the **user-facing half**: an enriched error chip in
the right-sidebar tool-call history that pulls the setup-guide URL,
display name, and required-keys list from `src/config/mcpCatalog.ts`
and renders them next to the raw error body. The user can act on the
hint immediately without LLM mediation.

## Implementation

1. **`src/utils/agent/mcpHint.ts`** (new) — pure helper
   `extractMcpHint(toolName: string): McpHint | null` returning
   `{ server, displayNameKey, setupGuideUrl?, requiredKeys[] }` for
   `mcp__<server>__*` tools whose server matches the catalog;
   `null` for non-MCP tools or unknown servers.

2. **`src/types/toolCallHistory.ts`** — add `mcpHint?: McpHint`
   to `ToolCallHistoryItem`. Pure-data extension.

3. **`src/utils/agent/eventDispatch.ts`** — in the
   `EVENT_TYPES.toolCallResult` case, when `event.isError === true`:
   - Set `entry.error = event.content` (instead of `entry.result`).
   - Set `entry.mcpHint = extractMcpHint(entry.toolName)`.

4. **`src/components/RightSidebar.vue`** — when `call.mcpHint` is
   present (only when `call.error` is also present), render an
   additional chip with:
   - Server display name (via `t(mcpHint.displayNameKey)`).
   - Required keys list.
   - "Setup guide" link to `mcpHint.setupGuideUrl` (when present).

5. **i18n lockstep** — new keys under `rightSidebar.mcpHint.*` in
   all 8 locales (en / ja / zh / ko / es / pt-BR / fr / de).

## Acceptance

- MCP tool call to `mcp__notion__page_create` returns `is_error: true`
  → right-sidebar shows the error body AND a hint chip with "Notion",
  setup guide link, and "Required: NOTION_API_KEY".
- Non-MCP tool error (e.g. Bash exit 1) → no hint chip (`mcpHint`
  is `null`).
- Custom MCP server not in the catalog → no hint chip (catalog
  lookup returns null).

## Out of scope (deferred)

- LLM-side context injection via PostToolUse hook. Issue noted as
  the original ask; revisit when a real fallback flow needs it.
- Auto-dismissing the hint chip when subsequent calls succeed.
  Chip persists until a new toolCallResult arrives (matches the
  existing `error` field behaviour).

## Test plan

`test/utils/agent/test_mcpHint.ts` — pure helper tests:

1. Returns null for non-MCP tools (`Bash`, `Read`, `ToolSearch`).
2. Returns null for unknown MCP servers (no catalog match).
3. Returns hint with `setupGuideUrl` for `mcp__notion__page_create`.
4. Returns hint without `setupGuideUrl` for entries that lack one.
5. Required keys reflect `requiredKeysOf(entry)` output.
