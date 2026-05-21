// End-to-end integration test for the Worklog plugin.
// Loads the workspace-built `dist/index.js` through the real
// runtime loader with a real `makePluginRuntime`, then exercises the
// create candidate -> list -> approve -> edit -> delete flow against an isolated tmp workspace.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
import { createTaskManager } from "../../server/events/task-manager/index.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/plugins/worklog-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/worklog-plugin";
const VERSION = "0.1.0";

function makeRecordingPubSub(): { pubsub: IPubSub; published: { channel: string; data: unknown }[] } {
  const published: { channel: string; data: unknown }[] = [];
  return {
    pubsub: {
      publish(channel, data) {
        published.push({ channel, data });
      },
    },
    published,
  };
}

interface CommittedOrCandidateEntry {
  id: string;
  clientId: string;
  projectId?: string;
  startTime: string;
  endTime: string;
  notes?: string;
  billable?: boolean;
  supersedes?: string;
}

interface ListAllResult {
  data: {
    committed: CommittedOrCandidateEntry[];
    candidates: CommittedOrCandidateEntry[];
  };
}

interface WorklogActionResult {
  error?: string;
  status?: number;
  message?: string;
  jsonData?: {
    candidateId?: string;
    worklogId?: string;
    entries?: { id: string; [key: string]: unknown }[];
    deleted?: boolean;
  } & Record<string, unknown>;
  data?: {
    committed?: CommittedOrCandidateEntry[];
    candidates?: CommittedOrCandidateEntry[];
  } & Record<string, unknown>;
  instructions?: string;
}

describe("Worklog plugin — end-to-end integration through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[worklog integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/plugins/worklog/`);
    }
  });

  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "worklog-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "worklog-int-config-"));
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("performs full candidate log cycle: create, list, approve, edit, and delete", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }

    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });

    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageWorklog");
    assert.ok(plugin.execute, "execute handler must be present");

    // 1. Initial UI listAll is empty.
    let uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.deepEqual(uiRes.data.committed, []);
    assert.deepEqual(uiRes.data.candidates, []);

    // 2. Create a candidate draft (action: "create").
    let res = (await plugin.execute(
      {},
      {
        action: "create",
        clientId: "Acme Corp",
        projectId: "Redesign",
        startTime: "2026-05-20T09:00:00-07:00",
        endTime: "2026-05-20T12:00:00-07:00",
        notes: "Initial coding session",
        billable: true,
      },
    )) as WorklogActionResult;

    assert.ok(!res.error, `Create failed: ${res.error}`);
    assert.ok(res.jsonData?.candidateId);
    const { candidateId } = res.jsonData;

    assert.equal(published.length, 1, "Should publish once on create");
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:changed`);

    // 3. UI listAll shows the candidate.
    uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.equal(uiRes.data.candidates.length, 1);
    assert.equal(uiRes.data.candidates[0].id, candidateId);
    assert.equal(uiRes.data.candidates[0].clientId, "Acme Corp");

    // 4. Approve the candidate (action: "approve").
    res = (await plugin.execute({}, { action: "approve", candidateId })) as WorklogActionResult;
    assert.ok(!res.error, `Approve failed: ${res.error}`);
    assert.ok(res.jsonData?.worklogId);
    const { worklogId } = res.jsonData;

    assert.equal(published.length, 2, "Should publish again on approve");
    assert.equal(published[1].channel, `plugin:${PKG_NAME}:changed`);

    // 5. UI listAll shows no candidates, and 1 committed entry.
    uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.equal(uiRes.data.candidates.length, 0);
    assert.equal(uiRes.data.committed.length, 1);
    assert.equal(uiRes.data.committed[0].id, worklogId);
    assert.equal(uiRes.data.committed[0].notes, "Initial coding session");

    // 6. MCP List action shows active log.
    res = (await plugin.execute({}, { action: "list", clientId: "Acme Corp" })) as WorklogActionResult;
    assert.ok(!res.error);
    assert.equal(res.jsonData?.entries?.length, 1);
    assert.equal(res.jsonData?.entries?.[0]?.id, worklogId);

    // 6a. MCP Present action returns visual data payload.
    const presentRes = (await plugin.execute({}, { action: "present" })) as WorklogActionResult;
    assert.ok(!presentRes.error);
    assert.ok(presentRes.data);
    assert.equal(presentRes.message, "Presented the Worklog Review Board and committed logs.");
    assert.equal(presentRes.instructions, "Show the Worklog Review Board and committed logs.");

    // 6b. MCP Present action handles optional query parameters gracefully without throwing.
    const presentFilteredRes = (await plugin.execute({}, { action: "present", clientId: "Acme Corp", weekOffset: -1 })) as WorklogActionResult;
    assert.ok(!presentFilteredRes.error);
    assert.ok(presentFilteredRes.data);
    assert.equal(presentFilteredRes.message, "Presented the Worklog Review Board and committed logs.");

    // 7. Edit the committed log (action: "edit").
    res = (await plugin.execute(
      {},
      {
        action: "edit",
        worklogId,
        notes: "Initial coding session with minor bug fixes",
        billable: true,
      },
    )) as WorklogActionResult;

    assert.ok(!res.error, `Edit failed: ${res.error}`);
    assert.ok(res.jsonData?.worklogId);
    const editedWorklogId = res.jsonData.worklogId;
    assert.notEqual(editedWorklogId, worklogId);

    assert.equal(published.length, 3, "Should publish on edit");

    // 8. UI listAll resolves the supersedes graph, showing ONLY the edited version.
    uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.equal(uiRes.data.committed.length, 1);
    assert.equal(uiRes.data.committed[0].id, editedWorklogId);
    assert.equal(uiRes.data.committed[0].notes, "Initial coding session with minor bug fixes");
    assert.equal(uiRes.data.committed[0].supersedes, worklogId);

    // 9. Delete the committed entry (action: "delete").
    res = (await plugin.execute({}, { action: "delete", worklogId: editedWorklogId })) as WorklogActionResult;
    assert.ok(!res.error, `Delete failed: ${res.error}`);
    assert.equal(res.jsonData?.deleted, true);

    assert.equal(published.length, 4, "Should publish on delete");

    // 10. UI listAll resolves the deletion, returning 0 active entries.
    uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.equal(uiRes.data.committed.length, 0);
  });

  it("serialises concurrent candidate creation to prevent write conflicts", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });

    if (!plugin || !plugin.execute) {
      throw new Error("Plugin failed to load or execute method is missing");
    }
    const { execute } = plugin;

    // Launch multiple create requests concurrently.
    const CONCURRENCY = 5;
    const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
      execute(
        {},
        {
          action: "create",
          clientId: `Client ${i}`,
          startTime: "2026-05-20T10:00:00-07:00",
          endTime: "2026-05-20T11:00:00-07:00",
          notes: `Session ${i}`,
        },
      ),
    );

    await Promise.all(promises);

    const uiRes = (await plugin.execute({}, { kind: "listAll" })) as unknown as ListAllResult;
    assert.equal(uiRes.data.candidates.length, CONCURRENCY);
  });
});
