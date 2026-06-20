import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  configureNotifier,
  setNotifierFilePaths,
  resetNotifier,
  onEvent,
  publish,
  clear,
  cancel,
  updateForPlugin,
  clearForPlugin,
  getForPlugin,
  listAll,
  listFor,
  listHistory,
  validatePublishInput,
  type NotifierEvent,
} from "../src/index.ts";

let events: NotifierEvent[] = [];

function setup(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "notifier-"));
  events = [];
  configureNotifier({
    // Minimal atomic-ish writer for the test: ensure dir, then write.
    writeJson: async (filePath, data) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2));
    },
    publishEvent: (event) => events.push(event),
  });
  setNotifierFilePaths({ active: path.join(dir, "active.json"), history: path.join(dir, "history.json") });
  return dir;
}

afterEach(() => resetNotifier());

test("publish persists, emits, and is readable", async () => {
  const dir = setup();
  try {
    const { id } = await publish({ pluginPkg: "todo", severity: "nudge", title: "Hi" });
    assert.ok(id);
    const all = await listAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, "Hi");
    assert.deepEqual(
      events.map((event) => event.type),
      ["published"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clear moves to history and emits cleared", async () => {
  const dir = setup();
  try {
    const { id } = await publish({ pluginPkg: "todo", severity: "nudge", title: "Bye" });
    await clear(id);
    assert.equal((await listAll()).length, 0);
    const history = await listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].terminalType, "cleared");
    assert.deepEqual(
      events.map((event) => event.type),
      ["published", "cleared"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plugin isolation: clearForPlugin/getForPlugin no-op across plugins", async () => {
  const dir = setup();
  try {
    const { id } = await publish({ pluginPkg: "todo", severity: "nudge", title: "Mine" });
    assert.equal(await getForPlugin("other", id), undefined);
    await clearForPlugin("other", id); // no-op
    assert.equal((await listFor("todo")).length, 1);
    await clearForPlugin("todo", id); // real
    assert.equal((await listFor("todo")).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateForPlugin refreshes in place and rejects invalid merges silently", async () => {
  const dir = setup();
  try {
    const { id } = await publish({ pluginPkg: "todo", severity: "nudge", title: "v1" });
    await updateForPlugin("todo", id, { title: "v2" });
    assert.equal((await listAll())[0].title, "v2");
    // Empty title would violate validation → silent no-op (title stays v2).
    await updateForPlugin("todo", id, { title: "" });
    assert.equal((await listAll())[0].title, "v2");
    assert.deepEqual(
      events.map((event) => event.type),
      ["published", "updated"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("action lifecycle rules: publish throws on info severity / missing navigateTarget", async () => {
  const dir = setup();
  try {
    await assert.rejects(() => publish({ pluginPkg: "x", severity: "info", lifecycle: "action", title: "t", navigateTarget: "/x" }));
    await assert.rejects(() => publish({ pluginPkg: "x", severity: "urgent", lifecycle: "action", title: "t" }));
    const ok = await publish({ pluginPkg: "x", severity: "urgent", lifecycle: "action", title: "t", navigateTarget: "/ok" });
    assert.ok(ok.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onEvent in-process listener fires before pubsub and can unsubscribe", async () => {
  const dir = setup();
  try {
    const seen: string[] = [];
    const off = onEvent((event) => seen.push(event.type));
    await publish({ pluginPkg: "todo", severity: "nudge", title: "a" });
    off();
    await publish({ pluginPkg: "todo", severity: "nudge", title: "b" });
    assert.deepEqual(seen, ["published"]); // only the first, after unsubscribe none
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancel emits cancelled; concurrent publishes both persist", async () => {
  const dir = setup();
  try {
    const [first, second] = await Promise.all([
      publish({ pluginPkg: "todo", severity: "nudge", title: "a" }),
      publish({ pluginPkg: "todo", severity: "nudge", title: "b" }),
    ]);
    assert.notEqual(first.id, second.id);
    assert.equal((await listAll()).length, 2);
    await cancel(first.id);
    const history = await listHistory();
    assert.equal(history[0].terminalType, "cancelled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validatePublishInput is pure and matches the engine's wall", () => {
  assert.equal(validatePublishInput({ pluginPkg: "x", severity: "nudge", title: "ok" }), null);
  assert.match(validatePublishInput({ pluginPkg: "x", severity: "nudge", title: "" }) ?? "", /non-empty/);
  assert.match(validatePublishInput({ pluginPkg: "x", severity: "nudge", title: "t", navigateTarget: "//evil.com" }) ?? "", /single '\/'/);
});

test("malformed active.json surfaces as an error", async () => {
  const dir = setup();
  try {
    const active = path.join(dir, "active.json");
    await mkdir(path.dirname(active), { recursive: true });
    await writeFile(active, JSON.stringify({ entries: [] })); // array, not object → malformed
    await assert.rejects(() => listAll(), /malformed active\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
