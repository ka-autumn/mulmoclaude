// End-to-end integration test for the Todo plugin (#1145). Mirrors
// `test_bookmarks_integration.ts`: loads the workspace-built
// `dist/index.js` through the real runtime loader with a real
// `makePluginRuntime`, then exercises both the LLM action path and
// the Vue UI dispatch path against an isolated tmp workspace.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
import { createTaskManager } from "../../server/events/task-manager/index.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";
import * as notifierEngine from "../../server/notifier/engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/plugins/todo-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/todo-plugin";
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

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  status?: string;
  labels?: string[];
}

interface StatusColumn {
  id: string;
  label: string;
  isDone?: boolean;
}

interface TodoResult {
  ok?: boolean;
  data?: { items?: TodoItem[]; columns?: StatusColumn[] };
  item?: TodoItem;
  message?: string;
  error?: string;
  status?: number;
}

describe("Todo plugin — end-to-end through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[todo integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/plugins/todo-plugin/`);
    }
  });

  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "todo-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "todo-int-config-"));
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("LLM path: add → show, persists to data root, publishes scoped events", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageTodoList");
    assert.ok(plugin.execute);

    // 1. show on empty workspace returns no items, no publish (read-only).
    let res = (await plugin.execute({}, { action: "show" })) as TodoResult;
    assert.equal(res.error, undefined, `show should not error: ${res.error}`);
    assert.equal(res.data?.items?.length ?? 0, 0);
    assert.equal(published.length, 0, "show is read-only and must not publish");

    // 2. add an item — should publish "changed" with reason llm-action.
    res = (await plugin.execute({}, { action: "add", text: "Write integration test" })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.equal(res.data?.items?.length, 1);
    assert.equal(res.data?.items?.[0]?.text, "Write integration test");
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:changed`);
    assert.deepEqual(published[0].data, { reason: "llm-action", action: "add" });

    // 3. data file lands under the data root, not config.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const expectedDataFile = path.join(dataRoot, sanitisedSeg, "todos.json");
    assert.ok(existsSync(expectedDataFile), `expected ${expectedDataFile} to exist`);
    const expectedConfigFile = path.join(configRoot, sanitisedSeg, "todos.json");
    assert.ok(!existsSync(expectedConfigFile), "todos must not leak into the config root");
  });

  it("UI path: listAll seeds default columns on an empty workspace", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(res.data?.items?.length ?? 0, 0);
    assert.ok((res.data?.columns?.length ?? 0) > 0, "listAll must return seeded default columns on empty workspace");
    assert.equal(published.length, 0, "listAll is read-only and must not publish");
  });

  it("UI path: itemCreate → itemPatch → itemDelete each publishes a scoped 'changed' event", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    let res = (await plugin.execute({}, { kind: "itemCreate", text: "Task 1" })) as TodoResult;
    const itemId = res.data?.items?.[0]?.id;
    assert.ok(itemId, "itemCreate must return an id");
    assert.equal(published[published.length - 1].channel, `plugin:${PKG_NAME}:changed`);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-create" });

    res = (await plugin.execute({}, { kind: "itemPatch", id: itemId, text: "Task 1 (renamed)" })) as TodoResult;
    assert.equal(res.data?.items?.[0]?.text, "Task 1 (renamed)");
    assert.deepEqual(published[published.length - 1].data, { reason: "item-patch", id: itemId });

    res = (await plugin.execute({}, { kind: "itemDelete", id: itemId })) as TodoResult;
    assert.equal(res.data?.items?.length, 0);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-delete", id: itemId });
  });

  it("UI path: columnsAdd appends to the seeded defaults and publishes 'column-add'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const initial = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    const initialLen = initial.data?.columns?.length ?? 0;
    const res = (await plugin.execute({}, { kind: "columnsAdd", label: "Review" })) as TodoResult;
    assert.equal(res.data?.columns?.length, initialLen + 1);
    assert.ok(
      res.data?.columns?.some((column) => column.label === "Review"),
      "added column should appear in the list",
    );
    assert.deepEqual(published[published.length - 1].data, { reason: "column-add" });
  });

  it("UI path: itemMove changes status and flips `completed` when moved into the done column", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Move me" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const moved = (await plugin.execute({}, { kind: "itemMove", id: itemId, status: "done", position: 0 })) as TodoResult;
    assert.equal(moved.data?.items?.[0]?.status, "done");
    assert.equal(moved.data?.items?.[0]?.completed, true);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-move", id: itemId });
  });

  it("UI path: itemMove clamps an out-of-range position rather than erroring", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Drag me" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const clamped = (await plugin.execute({}, { kind: "itemMove", id: itemId, status: "done", position: 9999 })) as TodoResult;
    assert.equal(clamped.error, undefined);
    assert.equal(clamped.data?.items?.find((entry) => entry.id === itemId)?.status, "done");
  });

  it("UI path: itemMove with an unknown id returns 404", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const missing = (await plugin.execute({}, { kind: "itemMove", id: "does-not-exist", status: "done" })) as TodoResult;
    assert.ok(missing.error);
    assert.equal(missing.status, 404);
  });

  it("UI path: columnPatch renames a column and publishes 'column-patch'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "columnPatch", id: "todo", label: "Doing" })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.equal(res.data?.columns?.find((column) => column.id === "todo")?.label, "Doing");
    assert.deepEqual(published[published.length - 1].data, { reason: "column-patch", id: "todo" });

    const missing = (await plugin.execute({}, { kind: "columnPatch", id: "ghost", label: "x" })) as TodoResult;
    assert.ok(missing.error);
    assert.equal(missing.status, 404);
  });

  it("UI path: columnDelete migrates orphaned items into a refuge column and publishes 'column-delete'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Stranded", status: "backlog" })) as TodoResult;
    const itemId = created.data?.items?.find((entry) => entry.text === "Stranded")?.id;
    assert.ok(itemId);

    const removed = (await plugin.execute({}, { kind: "columnDelete", id: "backlog" })) as TodoResult;
    assert.equal(removed.error, undefined);
    assert.equal(
      removed.data?.columns?.some((column) => column.id === "backlog"),
      false,
    );
    assert.notEqual(removed.data?.items?.find((entry) => entry.id === itemId)?.status, "backlog");
    assert.deepEqual(published[published.length - 1].data, { reason: "column-delete", id: "backlog" });
  });

  it("UI path: columnDelete refuses to delete the last remaining column", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    await plugin.execute({}, { kind: "columnDelete", id: "backlog" });
    await plugin.execute({}, { kind: "columnDelete", id: "todo" });
    await plugin.execute({}, { kind: "columnDelete", id: "in-progress" });
    const refused = (await plugin.execute({}, { kind: "columnDelete", id: "done" })) as TodoResult;
    assert.ok(refused.error);
    assert.equal(refused.status, 400);
  });

  it("UI path: columnsOrder validates the id set and applies the new order", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    // Reverse the four default columns.
    const reversed = ["done", "in-progress", "todo", "backlog"];
    const res = (await plugin.execute({}, { kind: "columnsOrder", ids: reversed })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.deepEqual(
      res.data?.columns?.map((column) => column.id),
      reversed,
    );
    assert.deepEqual(published[published.length - 1].data, { reason: "columns-order" });

    // Mismatched id set → 400 (handler enforces a permutation).
    const bad = (await plugin.execute({}, { kind: "columnsOrder", ids: ["todo", "backlog"] })) as TodoResult;
    assert.ok(bad.error);
    assert.equal(bad.status, 400);
  });

  it("UI path: unknown kind returns a 400 error", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "no-such-kind" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });

  it("Robustness: id-based UI patch mutates the right row when two items share a text prefix", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Pre-#1145 the View dispatched LLM-style `{ action: "update",
    // text: "..." }` calls that resolved by case-insensitive
    // substring match — two todos sharing a prefix would clobber
    // each other. The migrated View now uses `{ kind: "itemPatch",
    // id: ... }`, which the `handlePatch` handler resolves by
    // exact id. Pin that contract so a future regression to text-
    // based dispatch shows up here. Codex review iter on PR #1149.
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const first = (await plugin.execute({}, { kind: "itemCreate", text: "Buy milk" })) as TodoResult;
    const second = (await plugin.execute({}, { kind: "itemCreate", text: "Buy milk and bread" })) as TodoResult;
    const idA = first.data?.items?.find((entry) => entry.text === "Buy milk")?.id;
    const idB = second.data?.items?.find((entry) => entry.text === "Buy milk and bread")?.id;
    assert.ok(idA);
    assert.ok(idB);
    assert.notEqual(idA, idB);

    // Patch only the second one. With a substring text match against
    // "Buy milk" the first one would also flip; with id-based dispatch
    // only the targeted row mutates.
    const patched = (await plugin.execute({}, { kind: "itemPatch", id: idB, completed: true })) as TodoResult;
    assert.equal(patched.data?.items?.find((entry) => entry.id === idA)?.completed, false, "first item must remain unchanged");
    assert.equal(patched.data?.items?.find((entry) => entry.id === idB)?.completed, true, "targeted item flipped");
  });

  it("Robustness: a malformed todos.json (object instead of array) degrades to an empty list", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Pre-fix, `loadTodos` would call `migrateItems({}, columns)`
    // which calls `rawItems.map(...)` on a non-array and TypeError-
    // outs, taking every dispatch with it. Codex review iter on PR
    // #1149.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const scopeDir = path.join(dataRoot, sanitisedSeg);
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(path.join(scopeDir, "todos.json"), JSON.stringify({ this: "is not an array" }));

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const empty = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(empty.error, undefined, "dispatch must not throw on a non-array todos.json");
    assert.equal(empty.data?.items?.length ?? 0, 0);
  });

  it("Robustness: an array with mixed valid + garbage entries filters to just the well-formed ones", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Item-level filter: drops anything that doesn't carry
    // {id, text, completed, createdAt} in the right primitive types.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const scopeDir = path.join(dataRoot, sanitisedSeg);
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      path.join(scopeDir, "todos.json"),
      JSON.stringify([{ id: "good", text: "valid", completed: false, createdAt: 1 }, { not: "a todo item" }, "string item is not a todo either", null]),
    );

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const listed = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(listed.error, undefined, "dispatch must not throw on a partly-corrupt array");
    assert.equal(listed.data?.items?.length, 1, "only the well-formed entry should survive");
    assert.equal(listed.data?.items?.[0]?.id, "good");
  });

  it("rejects args with neither `action` nor `kind`", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { foo: "bar" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Priority-alert notifications
//
// The plugin maintains an `action`-lifecycle notification for every
// item with `priority ∈ {"urgent", "high"} && !completed`. Reconcile
// runs after every mutation, with `pluginData.priority` carrying the
// snapshot so a priority transition (high → urgent or vice versa)
// clears the old entry and republishes with the right severity.
// ─────────────────────────────────────────────────────────────────────

describe("Todo plugin — priority-alert notifications", () => {
  // The integration test loads the built dist via `loadPluginFromCacheDir`
  // and the real `makePluginRuntime`, which attaches a real notifier
  // backed by `notifierEngine`. We redirect the engine's file paths
  // to a tmp dir so reads/writes don't touch the user's workspace.
  let notifierTmpDir: string;
  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    notifierTmpDir = mkdtempSync(path.join(tmpdir(), "todo-int-notifier-"));
    notifierEngine._setFilePathsForTesting({
      active: path.join(notifierTmpDir, "active.json"),
      history: path.join(notifierTmpDir, "history.json"),
    });
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "todo-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "todo-int-config-"));
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
    rmSync(notifierTmpDir, { recursive: true, force: true });
  });

  async function load(): Promise<{ execute: NonNullable<NonNullable<Awaited<ReturnType<typeof loadPluginFromCacheDir>>>["execute"]> }> {
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    return { execute: plugin.execute };
  }

  it("itemCreate with priority=urgent publishes a single 'urgent' entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "Pay tax", priority: "urgent" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1, "should publish exactly one entry");
    assert.equal(entries[0].severity, "urgent");
    assert.equal(entries[0].lifecycle, "action");
    assert.equal(entries[0].navigateTarget, "/todos");
    // Title is the todo text verbatim — severity is signalled by the
    // bell's color badge (and on-disk `pluginData.priority`), not by
    // a prefix in the title.
    assert.equal(entries[0].title, "Pay tax");
  });

  it("itemCreate with priority=high publishes a single 'nudge' entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "Review PR", priority: "high" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].severity, "nudge");
    assert.equal(entries[0].title, "Review PR");
  });

  it("itemCreate without notifiable priority publishes nothing", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "Buy milk", priority: "low" });
    await plugin.execute({}, { kind: "itemCreate", text: "Email Sue", priority: "medium" });
    await plugin.execute({}, { kind: "itemCreate", text: "Read book" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 0);
  });

  it("itemPatch to add priority publishes; remove priority clears", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Maybe urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0);

    await plugin.execute({}, { kind: "itemPatch", id: itemId, priority: "urgent" });
    let entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].severity, "urgent");

    await plugin.execute({}, { kind: "itemPatch", id: itemId, priority: "medium" });
    entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 0, "downgrading out of urgent/high must clear the entry");
  });

  it("priority transition urgent → high updates the bell in place (same id, new severity)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Shift severity", priority: "urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const firstId = (await notifierEngine.listFor(PKG_NAME))[0]?.id;
    assert.ok(firstId);

    await plugin.execute({}, { kind: "itemPatch", id: itemId, priority: "high" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1, "still exactly one entry");
    assert.equal(entries[0].severity, "nudge", "severity must follow the new priority");
    assert.equal(entries[0].id, firstId, "in-place update must preserve the notification id");
    // Title is the todo text verbatim — priority is signalled by the
    // bell's color badge, not by a textual prefix.
    assert.equal(entries[0].title, "Shift severity", "title must remain the todo text after a priority shift");

    // The whole point of the migration to notifier.update: a priority
    // shift on a still-active todo no longer pollutes history. The
    // bell entry is the same one, just with new severity / title.
    const history = await notifierEngine.listHistory();
    assert.equal(history.filter((entry) => entry.pluginPkg === PKG_NAME).length, 0, "priority transition must NOT write to history");
  });

  it("rename updates the bell title in place (same id, no churn)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Original name", priority: "urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const [firstEntry] = await notifierEngine.listFor(PKG_NAME);
    assert.ok(firstEntry);
    assert.match(firstEntry.title, /Original name/, "seed bell must include the original todo text");

    await plugin.execute({}, { kind: "itemPatch", id: itemId, text: "Renamed" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1, "rename must not duplicate the bell entry");
    assert.equal(entries[0].id, firstEntry.id, "rename must reuse the same notification id");
    assert.match(entries[0].title, /Renamed/, "rename must update the bell title in place");
    assert.ok(!entries[0].title.includes("Original name"), "old title fragment must not leak through");

    const history = await notifierEngine.listHistory();
    assert.equal(history.filter((entry) => entry.pluginPkg === PKG_NAME).length, 0, "rename must NOT write to history");
  });

  it("reconcile is idempotent — repeat dispatches with no content drift don't churn the bell", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Steady", priority: "high" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const [beforeEntry] = await notifierEngine.listFor(PKG_NAME);
    assert.ok(beforeEntry);
    const beforeId = beforeEntry.id;

    // A second patch that doesn't change anything notification-
    // relevant (e.g. labels) must not trigger an update.
    await plugin.execute({}, { kind: "itemPatch", id: itemId, labels: ["new-label"] });
    const after = await notifierEngine.listFor(PKG_NAME);
    assert.equal(after.length, 1);
    assert.equal(after[0].id, beforeId, "idempotent reconcile must not churn the id");
    assert.equal(after[0].title, beforeEntry.title, "idempotent reconcile must not rewrite the title");
  });

  it("ghost-bell recovery: out-of-band clear → next mutation re-publishes a fresh entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Regression for the Codex CHANGES REQUESTED ghost-id finding.
    // Simulates the user dismissing the bell via the bell UI: we
    // call `engine.clear` directly to wipe the active entry while
    // leaving the plugin's ticket file untouched. The next
    // reconcile (triggered by any mutation) must detect the ghost
    // via `notifier.get`, drop the stale ticket, and re-publish a
    // fresh entry from Phase 2. Without the get-based check, the
    // bell would stay gone forever — `notifier.update` would
    // silently no-op on the dead id and the ticket would lie about
    // being in sync.
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "Ghost recovery", priority: "urgent" });
    const [seed] = await notifierEngine.listFor(PKG_NAME);
    assert.ok(seed);
    const seedId = seed.id;

    // Dismiss the bell out-of-band, matching what the bell UI's
    // "clear" button does (engine-level clear, not plugin-routed).
    const { clear: hostClear } = await import("../../server/notifier/engine.js");
    await hostClear(seedId);
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0, "bell must be gone after out-of-band clear");

    // Any subsequent reconcile pass should rebuild. Trigger one
    // via a no-op-ish mutation (label change) that flows through
    // handleUi → reconcileNotifications.
    await plugin.execute({}, { kind: "itemPatch", id: seed.pluginData && (seed.pluginData as { todoId?: string }).todoId, labels: ["alive"] });

    const after = await notifierEngine.listFor(PKG_NAME);
    assert.equal(after.length, 1, "ghost-recovery must re-publish exactly one fresh bell");
    assert.notEqual(after[0].id, seedId, "the new entry must have a fresh notificationId");
    assert.equal(after[0].title, "Ghost recovery");
  });

  it("oversize note is clamped to the engine's body cap (no silent validation rejection)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Regression for the Codex CHANGES REQUESTED finding: the engine
    // rejects publish/update patches with body > 4000 chars by
    // silently no-op'ing the update (no throw, no event). Without a
    // plugin-side clamp, `safeUpdate` would falsely report success
    // and the ticket would lie about being in sync. We clamp body
    // to `BODY_MAX` in `buildBody` so this validation case can
    // never fire — see priority-notifier.ts.
    const plugin = await load();
    const oversize = "x".repeat(5000);
    await plugin.execute({}, { kind: "itemCreate", text: "Big note", note: oversize, priority: "urgent" });
    const entries = await notifierEngine.listFor(PKG_NAME);
    assert.equal(entries.length, 1, "publish must succeed on an oversized note (clamped)");
    assert.ok((entries[0].body ?? "").length <= 4000, `body must be at or under engine bodyMax; got ${(entries[0].body ?? "").length}`);
  });

  it("removing the note from an alerting todo clears the bell's body", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Regression for the codex/sourcery/github-actions review findings:
    // a previous build skipped the body field from `notifier.update`
    // when desiredBody became undefined, but still wrote
    // `body: undefined` to `urgent-tickets.json`. The bell kept the
    // old note text forever while the ticket lied about being in
    // sync. `buildBody` now returns "" rather than undefined so the
    // patch always carries a concrete value through.
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Pay tax", note: "draft K-1 first", priority: "urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const [seed] = await notifierEngine.listFor(PKG_NAME);
    assert.ok(seed);
    assert.equal(seed.body, "draft K-1 first", "initial publish should carry the note as body");

    // Remove the note. itemPatch treats `note: ""` / `null` as a
    // clear (see applyNotePatch in handlers/items.ts).
    await plugin.execute({}, { kind: "itemPatch", id: itemId, note: null });
    const [after] = await notifierEngine.listFor(PKG_NAME);
    assert.equal(after.id, seed.id, "in-place update — id is stable");
    assert.equal(after.body, "", "bell's body must drop to empty, not stay as the old note");
  });

  it("checking (completed=true via itemPatch) clears the entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Tick me", priority: "urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 1);

    await plugin.execute({}, { kind: "itemPatch", id: itemId, completed: true });
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0);
  });

  it("itemMove into the done column flips completed and clears the entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Drag to done", priority: "high" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 1);

    await plugin.execute({}, { kind: "itemMove", id: itemId, status: "done", position: 0 });
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0);
  });

  it("itemDelete clears the entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Delete me", priority: "urgent" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 1);

    await plugin.execute({}, { kind: "itemDelete", id: itemId });
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0);
  });

  it("LLM check action on an urgent item clears the entry", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "LLM-check me", priority: "urgent" });
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 1);

    // The LLM `check` action matches by partial text and flips
    // completed=true on a hit. Reconcile then clears the entry.
    await plugin.execute({}, { action: "check", text: "LLM-check" });
    assert.equal((await notifierEngine.listFor(PKG_NAME)).length, 0);
  });

  it("isolates entries across plugin scopes (listFor returns only ours)", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const plugin = await load();
    await plugin.execute({}, { kind: "itemCreate", text: "Scoped", priority: "urgent" });
    const ours = await notifierEngine.listFor(PKG_NAME);
    assert.equal(ours.length, 1);
    const others = await notifierEngine.listFor("@mulmoclaude/some-other-plugin");
    assert.equal(others.length, 0, "another plugin's listFor must not see todo entries");
  });
});
