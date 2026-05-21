// End-to-end integration test for the Client plugin.
// Loads the workspace-built `dist/index.js` through the real
// runtime loader with a real `makePluginRuntime`, then exercises the
// create client candidate -> list -> approve -> update -> create project -> approve flow.

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
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/plugins/client-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/client-plugin";
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

describe("Client plugin — end-to-end integration through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[client integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/plugins/client-plugin/`);
    }
  });

  let savedClientsDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedClientsDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "clients");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "client-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "client-int-config-"));
    if (savedClientsDescriptor) Object.defineProperty(WORKSPACE_PATHS, "clients", { ...savedClientsDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedClientsDescriptor) Object.defineProperty(WORKSPACE_PATHS, "clients", savedClientsDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("performs full candidate client/project lifecycle: create, list, approve, update, project nesting", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }

    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });

    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageClient");
    assert.ok(plugin.execute, "execute handler must be present");

    // 1. Initial list has empty clients and candidates.
    let listRes = (await plugin.execute({}, { action: "list" })) as any;
    assert.ok(listRes.ok);
    assert.deepEqual(listRes.clients, []);
    assert.deepEqual(listRes.candidates, []);

    // 2. Create client candidate (action: "create").
    const createRes = (await plugin.execute(
      {},
      {
        action: "create",
        id: "acme-corp",
        patch: {
          name: "Acme Corporation",
          contacts: [{ name: "John Doe", email: "john@acme.com", role: "CEO" }],
          rate: { amount: 150, currency: "USD", unit: "hour" },
          paymentTerms: "net-30",
          tags: ["vip", "enterprise"],
          notes: "# Acme Corporation\nPremium enterprise client.",
        },
      },
    )) as any;

    assert.ok(createRes.ok);
    assert.ok(createRes.candidateId);
    const clientCandidateId = createRes.candidateId;

    assert.equal(published.length, 1, "Should publish once on create");
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:changed`);

    // 3. List shows the client candidate.
    listRes = (await plugin.execute({}, { action: "list" })) as any;
    assert.ok(listRes.ok);
    assert.equal(listRes.candidates.length, 1);
    assert.equal(listRes.candidates[0].candidateId, clientCandidateId);
    assert.equal(listRes.candidates[0].data.name, "Acme Corporation");
    assert.equal(listRes.clients.length, 0);

    // 4. Approve the candidate (action: "approveClient").
    const approveRes = (await plugin.execute({}, { action: "approveClient", candidateId: clientCandidateId })) as any;
    assert.ok(approveRes.ok);
    assert.equal(approveRes.id, "acme-corp");

    assert.equal(published.length, 2, "Should publish again on approve");

    // 5. List shows client committed and candidate deleted.
    listRes = (await plugin.execute({}, { action: "list" })) as any;
    assert.ok(listRes.ok);
    assert.equal(listRes.candidates.length, 0);
    assert.equal(listRes.clients.length, 1);
    assert.equal(listRes.clients[0].id, "acme-corp");
    assert.equal(listRes.clients[0].name, "Acme Corporation");

    // 6. Show client details.
    let showRes = (await plugin.execute({}, { action: "show", id: "acme-corp" })) as any;
    assert.ok(showRes.ok);
    assert.equal(showRes.client.id, "acme-corp");
    assert.equal(showRes.client.notes, "# Acme Corporation\nPremium enterprise client.");
    assert.deepEqual(showRes.projects, []);

    // 7. Update client (action: "update").
    const updateRes = (await plugin.execute(
      {},
      {
        action: "update",
        id: "acme-corp",
        patch: {
          notes: "# Acme Corp\nUpdated notes.",
          paymentTerms: "net-15",
        },
      },
    )) as any;
    assert.ok(updateRes.ok);
    assert.equal(updateRes.data.paymentTerms, "net-15");
    assert.equal(updateRes.data.notes, "# Acme Corp\nUpdated notes.");

    // 8. Create project candidate (action: "createProject").
    const createProjRes = (await plugin.execute(
      {},
      {
        action: "createProject",
        id: "acme-corp",
        projectId: "web-redesign",
        projectPatch: {
          name: "Website Redesign Project",
          feeModel: "fixed",
          rate: { amount: 5000, currency: "USD", unit: "project" },
          startDate: "2026-06-01",
          expectedDeliverables: "Sitemap, Wireframes, Figma, Live Site",
          notes: "Kickoff scheduled for June.",
        },
      },
    )) as any;
    assert.ok(createProjRes.ok);
    assert.ok(createProjRes.candidateId);
    const projCandidateId = createProjRes.candidateId;

    // 9. List projects shows the candidate.
    let listProjRes = (await plugin.execute({}, { action: "listProjects", id: "acme-corp" })) as any;
    assert.ok(listProjRes.ok);
    assert.equal(listProjRes.candidates.length, 1);
    assert.equal(listProjRes.candidates[0].candidateId, projCandidateId);
    assert.equal(listProjRes.projects.length, 0);

    // 10. Approve project (action: "approveProject").
    const approveProjRes = (await plugin.execute({}, { action: "approveProject", candidateId: projCandidateId })) as any;
    assert.ok(approveProjRes.ok);
    assert.equal(approveProjRes.id, "web-redesign");
    assert.equal(approveProjRes.clientId, "acme-corp");

    // 11. List projects shows the committed project.
    listProjRes = (await plugin.execute({}, { action: "listProjects", id: "acme-corp" })) as any;
    assert.ok(listProjRes.ok);
    assert.equal(listProjRes.candidates.length, 0);
    assert.equal(listProjRes.projects.length, 1);
    assert.equal(listProjRes.projects[0].id, "web-redesign");
    assert.equal(listProjRes.projects[0].feeModel, "fixed");

    // 12. Show client aggregates the projects.
    showRes = (await plugin.execute({}, { action: "show", id: "acme-corp" })) as any;
    assert.ok(showRes.ok);
    assert.equal(showRes.projects.length, 1);
    assert.equal(showRes.projects[0].id, "web-redesign");
  });

  it("serialises concurrent candidate creation to prevent conflicts", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });

    assert.ok(plugin);
    const { execute } = plugin;
    assert.ok(execute);

    const CONCURRENCY = 5;
    const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
      execute(
        {},
        {
          action: "create",
          id: `client-${i}`,
          patch: {
            name: `Client ${i}`,
          },
        },
      ),
    );

    await Promise.all(promises);

    const listRes = (await execute({}, { action: "list" })) as any;
    assert.ok(listRes.ok);
    assert.equal(listRes.candidates.length, CONCURRENCY);
  });
});
