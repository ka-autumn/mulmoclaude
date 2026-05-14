// Tests for the MCP preflight helper (#1352).
//
// Drives the pure functions without spinning up Express. The catalog
// is consumed read-only via `findCatalogEntry`, so the tests work
// against the actual production catalog (matching `notion`,
// `github`, etc. by id) rather than a fixture.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { findMissingRequiredEnv, preflightUserServers, _resetPreflightLogCache } from "../../server/agent/mcpPreflight.js";
import { findCatalogEntry } from "../../src/config/mcpCatalog.js";
import type { McpServerSpec } from "../../server/system/config.js";

beforeEach(() => {
  _resetPreflightLogCache();
});

function getEntry(entryId: string) {
  const entry = findCatalogEntry(entryId);
  if (entry === null) throw new Error(`catalog entry ${entryId} missing — test fixture out of date`);
  return entry;
}

describe("findMissingRequiredEnv — Notion (single required field)", () => {
  it("returns [] when the bound env value is resolved", () => {
    const entry = getEntry("notion");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_TOKEN: "secret_xyz" },
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), []);
  });

  it("flags the required field when the env value is empty string", () => {
    const entry = getEntry("notion");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { NOTION_TOKEN: "" },
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), ["NOTION_API_KEY"]);
  });

  it("flags the required field when the env value is whitespace only (Codex review on #1355)", () => {
    // `"   "` has non-zero length but is just as misconfigured as
    // `""` — a server with a whitespace-only token can't
    // authenticate. Without trimming, preflight greenlit it.
    const entry = getEntry("notion");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { NOTION_TOKEN: "   " },
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), ["NOTION_API_KEY"]);
  });

  it("flags the required field when the env key is missing entirely", () => {
    const entry = getEntry("notion");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: {},
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), ["NOTION_API_KEY"]);
  });

  it("flags the required field when the env value still holds the unresolved ${KEY} placeholder", () => {
    // Settings UI is supposed to substitute placeholders before
    // writing mcp.json, but a hand-edited file might leave them
    // unresolved. Treat as missing so the operator gets the warn.
    const entry = getEntry("notion");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { NOTION_TOKEN: "${NOTION_API_KEY}" },
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), ["NOTION_API_KEY"]);
  });
});

describe("findMissingRequiredEnv — Slack (two required fields)", () => {
  it("reports only the missing one when others are set", () => {
    const entry = getEntry("slack");
    const spec: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { SLACK_BOT_TOKEN: "xoxb-real", SLACK_TEAM_ID: "" },
    };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), ["SLACK_TEAM_ID"]);
  });

  it("reports both when both are missing", () => {
    const entry = getEntry("slack");
    const spec: McpServerSpec = { type: "stdio", command: "npx", env: {} };
    const missing = findMissingRequiredEnv(entry, spec);
    assert.deepEqual(missing.sort(), ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"]);
  });
});

describe("findMissingRequiredEnv — HTTP entries fall through (no env to check)", () => {
  it("returns [] for the HTTP-typed deepwiki entry", () => {
    const entry = getEntry("deepwiki");
    const spec: McpServerSpec = { type: "http", url: "https://mcp.deepwiki.com/sse" };
    assert.deepEqual(findMissingRequiredEnv(entry, spec), []);
  });
});

describe("preflightUserServers", () => {
  it("passes through a custom server with no catalog match", () => {
    const userServers: Record<string, McpServerSpec> = {
      "my-custom-server": { type: "stdio", command: "node", args: ["./bin.js"] },
    };
    const result = preflightUserServers(userServers);
    assert.deepEqual(Object.keys(result.ready), ["my-custom-server"]);
    assert.deepEqual(result.skipped, []);
  });

  it("excludes a catalog server with missing required config", () => {
    const userServers: Record<string, McpServerSpec> = {
      notion: { type: "stdio", command: "npx", env: { NOTION_TOKEN: "" } },
    };
    const result = preflightUserServers(userServers);
    assert.deepEqual(Object.keys(result.ready), []);
    assert.deepEqual(result.skipped, [{ serverId: "notion", missing: ["NOTION_API_KEY"] }]);
  });

  it("passes catalog servers with all required env populated", () => {
    const userServers: Record<string, McpServerSpec> = {
      notion: { type: "stdio", command: "npx", env: { NOTION_TOKEN: "secret_xyz" } },
    };
    const result = preflightUserServers(userServers);
    assert.deepEqual(Object.keys(result.ready), ["notion"]);
    assert.deepEqual(result.skipped, []);
  });

  it("handles a mix: one ready, one skipped, one custom — all in one pass", () => {
    const userServers: Record<string, McpServerSpec> = {
      notion: { type: "stdio", command: "npx", env: { NOTION_TOKEN: "secret_ok" } },
      slack: { type: "stdio", command: "npx", env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" } },
      "my-custom": { type: "stdio", command: "node" },
    };
    const result = preflightUserServers(userServers);
    assert.deepEqual(Object.keys(result.ready).sort(), ["my-custom", "notion"]);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].serverId, "slack");
    assert.deepEqual(result.skipped[0].missing.sort(), ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"]);
  });
});
