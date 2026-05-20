import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLES, ENCORE_SEED_ROLE_ID } from "../../src/config/roles.ts";
import { TOOL_NAMES } from "../../src/config/toolNames.ts";

// Encore's `resolveNotification` flow seeds a new chat under
// `ENCORE_SEED_ROLE_ID`. The seeded role MUST exist and MUST expose
// BOTH Encore tools — `manageEncore` (operational kinds: markStepDone /
// snooze / query / ...) for the immediate bell-clearing flow, AND
// `defineEncore` (structural: compose or amend DSL) for cases where
// the user wants to adjust the obligation from inside the seeded
// chat. Without either, the agent wakes up only half-able to drive
// the obligation it was just resumed for. These tests catch:
//   - renaming the role id without updating ENCORE_SEED_ROLE_ID
//   - dropping either Encore tool from the seed role's availablePlugins
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

  it("resolves to a role whose availablePlugins includes defineEncore", () => {
    const role = ROLES.find((entry) => entry.id === ENCORE_SEED_ROLE_ID);
    assert.ok(role, `no role found for ENCORE_SEED_ROLE_ID "${ENCORE_SEED_ROLE_ID}"`);
    assert.ok(
      role.availablePlugins.includes(TOOL_NAMES.defineEncore),
      `Encore seed role "${ENCORE_SEED_ROLE_ID}" must include TOOL_NAMES.defineEncore in availablePlugins`,
    );
  });
});
