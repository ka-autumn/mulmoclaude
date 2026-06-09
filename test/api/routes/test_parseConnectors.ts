import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseConnectors } from "../../../server/api/routes/config.js";

describe("parseConnectors", () => {
  it("parses connected and disconnected connectors", () => {
    const stdout = ["claude.ai Gmail: https://gmail.example.com - ✓ Connected", "claude.ai Slack: https://slack.example.com - ✗ Not connected"].join("\n");

    const result = parseConnectors(stdout);
    assert.deepEqual(result, [
      { name: "Gmail", connected: true },
      { name: "Slack", connected: false },
    ]);
  });

  it("ignores non-claude.ai lines", () => {
    const stdout = [
      "my-custom-server: https://example.com - ✓ Connected",
      "claude.ai Google Calendar: https://cal.example.com - ✓ Connected",
      "another-server: https://other.com",
    ].join("\n");

    const result = parseConnectors(stdout);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Google Calendar");
    assert.equal(result[0].connected, true);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(parseConnectors(""), []);
  });

  it("returns empty array when no claude.ai lines exist", () => {
    const stdout = "local-mcp: http://localhost:3000\nother-server: http://other.com";
    assert.deepEqual(parseConnectors(stdout), []);
  });

  it("handles lines without the Connected marker as disconnected", () => {
    const stdout = "claude.ai Google Drive: https://drive.example.com - Pending";
    const result = parseConnectors(stdout);
    assert.deepEqual(result, [{ name: "Google Drive", connected: false }]);
  });

  it("handles multiple connectors with mixed states", () => {
    const stdout = [
      "claude.ai Gmail: https://gmail.example.com - ✓ Connected",
      "claude.ai Google Calendar: https://cal.example.com - ✓ Connected",
      "claude.ai Google Drive: https://drive.example.com - ✗ Not connected",
      "claude.ai Slack: https://slack.example.com - ✓ Connected",
    ].join("\n");

    const result = parseConnectors(stdout);
    assert.equal(result.length, 4);
    assert.equal(result.filter((entry) => entry.connected).length, 3);
    assert.equal(result.filter((entry) => !entry.connected).length, 1);
  });

  it("recognises heavy check mark (U+2714) as connected", () => {
    const stdout = "claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected";
    const result = parseConnectors(stdout);
    assert.deepEqual(result, [{ name: "Slack", connected: true }]);
  });

  it("skips malformed claude.ai line without colon separator", () => {
    const stdout = ["claude.ai MalformedEntry", "claude.ai Gmail: https://gmail.example.com - ✓ Connected"].join("\n");
    const result = parseConnectors(stdout);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Gmail");
  });

  it("handles trailing newlines", () => {
    const stdout = "claude.ai Gmail: https://gmail.example.com - ✓ Connected\n\n";
    const result = parseConnectors(stdout);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Gmail");
  });
});
