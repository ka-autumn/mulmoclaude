// Component test for the `deleteObligation` dispatch handler.
//
// Drives `dispatch()` end-to-end against an isolated tmpdir workspace
// (same harness as test_encore_dispatch.ts):
//   - delete is refused while the obligation is active/paused (the
//     retired-only safety guard),
//   - after retiring, delete removes the whole obligation tree and
//     leaves no live bell behind.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { dispatch, type EncoreDispatchResult } from "../../server/encore/dispatch.js";
import { _setFilePathsForTesting, listFor } from "../../server/notifier/engine.js";
import { _resetLockForTesting } from "../../server/encore/lock.js";

let savedEncoreDescriptor: PropertyDescriptor | undefined;
let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "encore-delete-"));
  savedEncoreDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "encore");
  Object.defineProperty(WORKSPACE_PATHS, "encore", {
    ...savedEncoreDescriptor,
    value: path.join(workspaceRoot, "data/plugins/encore"),
  });
  _setFilePathsForTesting({
    active: path.join(workspaceRoot, "notifier-active.json"),
    history: path.join(workspaceRoot, "notifier-history.json"),
  });
  _resetLockForTesting();
});

afterEach(() => {
  if (savedEncoreDescriptor) Object.defineProperty(WORKSPACE_PATHS, "encore", savedEncoreDescriptor);
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const swimDefinition = {
  version: 1,
  displayName: "Morning swim",
  type: "service",
  cadence: { type: "daily" },
  targets: [{ id: "me", displayName: "Me" }],
  steps: [
    {
      id: "swim",
      displayName: "Swim",
      deadline: "cycle-deadline",
      firingPlan: [{ at: "cycle-start", severity: "info" }],
      fields: ["laps"],
    },
  ],
  formSchema: {
    fields: [{ name: "laps", type: "number", label: "Laps", required: true }],
  },
};

interface SetupResult extends EncoreDispatchResult {
  obligationId?: string;
}

interface QueryObligation {
  obligationId: string;
}

interface QueryResult extends EncoreDispatchResult {
  obligations?: QueryObligation[];
}

async function setupSwim(): Promise<string> {
  const result = (await dispatch({ kind: "setup", definition: swimDefinition })) as SetupResult;
  assert.equal(result.ok, true, `setup failed: ${result.message}`);
  assert.ok(result.obligationId, "setup should return obligationId");
  return result.obligationId;
}

async function obligationIds(): Promise<string[]> {
  const result = (await dispatch({ kind: "query", range: "all" })) as QueryResult;
  return (result.obligations ?? []).map((entry) => entry.obligationId);
}

describe("Encore deleteObligation — component tests", () => {
  it("refuses to delete an active obligation (retired-only guard)", async () => {
    const obligationId = await setupSwim();
    await assert.rejects(dispatch({ kind: "deleteObligation", obligationId }), /only a retired obligation can be deleted/);
    // Still present — the guard must not have removed anything.
    assert.deepEqual(await obligationIds(), [obligationId]);
  });

  it("refuses to delete a paused obligation", async () => {
    const obligationId = await setupSwim();
    await dispatch({ kind: "amendDefinition", obligationId, definition: { status: "paused" } });
    await assert.rejects(dispatch({ kind: "deleteObligation", obligationId }), /only a retired obligation can be deleted/);
    assert.deepEqual(await obligationIds(), [obligationId]);
  });

  it("deletes a retired obligation and clears its bells", async () => {
    const obligationId = await setupSwim();
    // Setup's tick fired a bell for the first cycle.
    assert.equal((await listFor("encore")).length, 1, "setup should have published a bell");

    // Retiring runs the reconciler, which clears the obligation's bells.
    await dispatch({ kind: "amendDefinition", obligationId, definition: { status: "retired" } });
    assert.equal((await listFor("encore")).length, 0, "retire should have cleared the bell");

    const result = await dispatch({ kind: "deleteObligation", obligationId });
    assert.equal(result.ok, true, `delete failed: ${result.message}`);

    // The obligation tree is gone — query no longer sees it.
    assert.deepEqual(await obligationIds(), []);
    // And no orphan bell survived.
    assert.equal((await listFor("encore")).length, 0);
  });

  it("rejects an empty obligationId at parse time", async () => {
    await assert.rejects(dispatch({ kind: "deleteObligation", obligationId: "" }), /invalid args[\s\S]*obligationId/);
  });

  it("404s an unknown obligationId", async () => {
    await assert.rejects(dispatch({ kind: "deleteObligation", obligationId: "does-not-exist" }), /not found/);
  });
});
