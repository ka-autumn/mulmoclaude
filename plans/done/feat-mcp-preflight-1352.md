# MCP Preflight (#1352)

## Problem

`mcp.json` external MCP servers (Notion / GitHub / Linear / …) declare
`required: true` fields in `src/config/mcpCatalog.ts`. When the user
adds a catalog entry but doesn't fill those fields, today:

- The spec's env value stays empty / unresolved.
- Claude Code spawns the MCP subprocess anyway.
- Every tool call into that server fails silently (401, "missing
  credentials", etc.).
- The operator sees nothing in MulmoClaude's own logs — they have to
  dig into Claude Code's subprocess stderr.

Built-in MCP-only tools (`notify`, `searchX` etc.) already have parity:
`isMcpToolEnabled` + `logMcpStatus` log both available and
unavailable-due-to-missing-env. External MCP servers need the same
treatment.

## Approach

Add a preflight step that runs **before** MCP servers are handed to
Claude Code. For each user MCP server, look up the catalog entry by
id and check whether the required env fields are populated in the
user's saved spec. Missing values → log warn + exclude the server.

### Component layout

- **`server/agent/mcpPreflight.ts`** (new) — pure helpers:
  - `findMissingRequiredEnv(entry, spec): string[]` — map catalog
    `configSchema.key` → spec env key via the template's `${KEY}`
    placeholder, return the catalog keys whose bound env values are
    empty or still contain `${...}`.
  - `preflightUserServers(userServers): { ready, skipped }` — filter
    a server map; servers with no catalog match pass through (custom).
  - `logPreflightResult(result, source: "boot" | "agent-run")` —
    structured logging with a module-level dedup cache so repeated
    agent runs don't spam the same warn.

- **`server/agent/config.ts`** — `prepareUserServers` calls
  `preflightUserServers` first, before the Docker filter. Wire the
  agent-run logging path.

- **`server/index.ts`** — boot-time:
  - Read `loadMcpConfig().mcpServers` once after `initWorkspace()`.
  - Run preflight + log via `logPreflightResult(..., "boot")`.
  - This is the human-facing "started=N, skipped=M" startup signal.

### Why both boot AND agent-run preflight

Boot-time gives the operator a clear startup signal. But Settings UI
changes mid-session shouldn't require a server restart, and
`prepareUserServers` already runs per agent invocation — adding the
filter inside it means a freshly-saved Notion API key starts working
on the very next chat turn without operator action.

The dedup cache (`Set<string>` keyed by `serverId:keysSorted`)
ensures the per-run path doesn't re-log identical state every turn.

## Catalog mapping detail

Catalog entry shape:

```ts
{
  id: "notion",
  spec: { type: "stdio", env: { NOTION_TOKEN: "${NOTION_API_KEY}" } },
  configSchema: [{ key: "NOTION_API_KEY", required: true }],
}
```

User's saved mcp.json (after filling the form):

```json
{ "type": "stdio", "env": { "NOTION_TOKEN": "secret_xyz" } }
```

The mapping `NOTION_API_KEY` → `NOTION_TOKEN` comes from the catalog
template's env values: we parse each `${KEY}` and remember which env
key holds the placeholder. Then we check the user's spec's matching
env key for a non-empty, non-placeholder value.

HTTP catalog entries don't currently have required fields (only
deepwiki, which is `configSchema: []`). We scope preflight to stdio
for now and leave HTTP as pass-through; an HTTP-side preflight can
land later when a catalog entry uses required headers.

## Acceptance

- Workspace with Notion in mcp.json but `NOTION_TOKEN` empty/placeholder
  → boot log: `mcp.preflight: skipping notion — missing required config { missing: ["NOTION_API_KEY"] }`
  + boot summary `mcp.boot: started=N, skipped=1`
  + Notion subprocess never spawned (tool list doesn't expose
  `mcp__notion__*`).
- Workspace with everything set → no behaviour change, no extra log.
- Settings UI updates → next chat turn picks up the change silently
  (no log spam from the dedup cache).

## Out of scope

- Runtime crash tolerance (#1353).
- Structured error response on call into unavailable server (#1354).
- Markdown-file fallback when integrations absent (deferred from the
  withdrawn #1349).
- HTTP-side preflight for required headers (no current catalog
  entries need it; revisit when one shows up).

## Test plan

`test/agent/test_mcpPreflight.ts` — `node:test` driving the pure
helpers without spinning up an Express server. Cases:

1. **all fields set** — server in `ready`, `skipped` empty.
2. **one field missing (empty value)** — server in `skipped` with the
   right missing-key, NOT in `ready`.
3. **field still has `${KEY}` placeholder** — treated the same as
   empty.
4. **multiple required fields, one missing** — `skipped.missing`
   reports only the missing one.
5. **custom server (no catalog match)** — passes through to `ready`,
   `skipped` empty.
6. **catalog entry with no required fields** — passes through.
