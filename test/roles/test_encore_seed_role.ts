import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLES, ENCORE_SEED_ROLE_ID } from "../../src/config/roles.ts";
import { TOOL_NAMES } from "../../src/config/toolNames.ts";

// Encore's `resolveNotification` flow seeds a new chat under
// `ENCORE_SEED_ROLE_ID`. The seeded role MUST exist and MUST expose
// `manageEncore`, otherwise the agent wakes up with no way to drive
// the obligation it was just resumed for. These tests catch:
//   - renaming the role id without updating ENCORE_SEED_ROLE_ID
//   - dropping `manageEncore` from the seed role's availablePlugins
//   - removing the role entry from ROLES outright

describe("ENCORE_SEED_ROLE_ID", () => {
  it("resolves to a role that exists in ROLES", () => {
    const role = ROLES.find((entry) => entry.id === ENCORE_SEED_ROLE_ID);
    assert.ok(role, `no role found for ENCORE_SEED_ROLE_ID "${ENCORE_SEED_ROLE_ID}"`);
  });

  it("resolves to a role whose availablePlugins includes manageEncore", () => {
    const role = ROLES.find((entry) => entry.id === ENCORE_SEED_ROLE_ID);
    assert.ok(role, `no role found for ENCORE_SEED_ROLE_ID "${ENCORE_SEED_ROLE_ID}"`);
    assert.ok(
      role.availablePlugins.includes(TOOL_NAMES.manageEncore),
      `Encore seed role "${ENCORE_SEED_ROLE_ID}" must include TOOL_NAMES.manageEncore in availablePlugins`,
    );
  });
});
