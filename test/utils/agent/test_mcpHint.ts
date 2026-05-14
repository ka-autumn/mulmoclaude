// Tests for the catalog-derived MCP error hint helper (#1354).
// Runs the helper against the actual production catalog so a future
// catalog edit that removes / renames an entry will surface as a
// test break instead of a silent UI regression.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMcpHint } from "../../../src/utils/agent/mcpHint";

describe("extractMcpHint", () => {
  it("returns null for non-MCP tools", () => {
    assert.equal(extractMcpHint("Bash"), null);
    assert.equal(extractMcpHint("Read"), null);
    assert.equal(extractMcpHint("ToolSearch"), null);
    assert.equal(extractMcpHint(""), null);
  });

  it("returns null for unknown MCP servers (custom user-added)", () => {
    assert.equal(extractMcpHint("mcp__my-custom-server__do_thing"), null);
  });

  it("returns a structured hint for the Notion catalog entry", () => {
    const hint = extractMcpHint("mcp__notion__page_create");
    assert.notEqual(hint, null);
    assert.equal(hint?.server, "notion");
    assert.equal(hint?.displayNameKey, "settingsMcpTab.catalog.entry.notion.displayName");
    assert.deepEqual(hint?.requiredKeys, ["NOTION_API_KEY"]);
    assert.equal(typeof hint?.setupGuideUrl, "string");
  });

  it("returns a hint for hyphenated server ids (google-maps, weather-open-meteo)", () => {
    const gmaps = extractMcpHint("mcp__google-maps__search");
    assert.notEqual(gmaps, null);
    assert.equal(gmaps?.server, "google-maps");

    const weather = extractMcpHint("mcp__weather-open-meteo__forecast");
    assert.notEqual(weather, null);
    assert.equal(weather?.server, "weather-open-meteo");
  });

  it("returns hint with empty requiredKeys when the catalog entry has no required fields", () => {
    // deepwiki / context7 / memory / sequential-thinking all have configSchema: [].
    const hint = extractMcpHint("mcp__deepwiki__lookup");
    assert.notEqual(hint, null);
    assert.deepEqual(hint?.requiredKeys, []);
  });

  it("ignores malformed mcp__ names", () => {
    assert.equal(extractMcpHint("mcp__"), null);
    assert.equal(extractMcpHint("mcp_notion"), null);
    assert.equal(extractMcpHint("mcp__notion"), null);
  });
});
