import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import {
  publish,
  clear,
  cancel,
  clearForPlugin,
  updateForPlugin,
  getForPlugin,
  get,
  listFor,
  listAll,
  listHistory,
  initNotifier,
  _setFilePathsForTesting,
  NOTIFIER_LIMITS,
} from "../../../server/notifier/engine.js";
import type { NotifierEvent } from "../../../server/notifier/types.js";

let tmpDir = "";
let activeFile = "";
let historyFile = "";
let emittedEvents: NotifierEvent[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-notifier-test-"));
  activeFile = path.join(tmpDir, "active.json");
  historyFile = path.join(tmpDir, "history.json");
  _setFilePathsForTesting({ active: activeFile, history: historyFile });
  emittedEvents = [];
  initNotifier({
    publish: (_channel, payload) => {
      emittedEvents.push(payload as NotifierEvent);
    },
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("publish", () => {
  it("returns an id and stores the entry", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "Backup completed",
    });
    assert.match(id, /^[0-9a-f-]{36}$/);
    const entry = await get(id);
    assert.ok(entry);
    assert.equal(entry?.id, id);
    assert.equal(entry?.pluginPkg, "debug__system");
    assert.equal(entry?.severity, "info");
    assert.equal(entry?.title, "Backup completed");
    assert.match(entry?.createdAt ?? "", /\d{4}-\d{2}-\d{2}T/);
  });

  it("emits a `published` event after persistence", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "hello",
    });
    assert.equal(emittedEvents.length, 1);
    const [event] = emittedEvents;
    assert.equal(event.type, "published");
    if (event.type === "published") {
      assert.equal(event.entry.id, id);
    }
  });

  it("preserves opaque pluginData through JSON round-trip", async () => {
    const pluginData = { taxYear: 2026, items: ["w2", "1099"], nested: { ok: true } };
    const { id } = await publish({
      pluginPkg: "encore",
      severity: "urgent",
      lifecycle: "action",
      title: "File taxes",
      navigateTarget: "/encore/taxes",
      pluginData,
    });
    const entry = await get(id);
    assert.deepEqual(entry?.pluginData, pluginData);
  });

  it("rejects action lifecycle without a navigateTarget", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "nudge",
        lifecycle: "action",
        title: "no link",
      }),
      /navigateTarget/,
    );
  });

  it("rejects action lifecycle with an empty-string navigateTarget", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "nudge",
        lifecycle: "action",
        title: "empty link",
        navigateTarget: "",
      }),
      /navigateTarget/,
    );
  });

  it("rejects action lifecycle with info severity (incoherent combination)", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "info",
        lifecycle: "action",
        title: "low-priority obligation",
        navigateTarget: "/somewhere",
      }),
      /info severity/,
    );
  });

  it("accepts action lifecycle with nudge or urgent severity (paired with navigateTarget)", async () => {
    const { id: nudgeId } = await publish({
      pluginPkg: "x",
      severity: "nudge",
      lifecycle: "action",
      title: "nudge action",
      navigateTarget: "/x",
    });
    const { id: urgentId } = await publish({
      pluginPkg: "x",
      severity: "urgent",
      lifecycle: "action",
      title: "urgent action",
      navigateTarget: "/y",
    });
    assert.ok(await get(nudgeId));
    assert.ok(await get(urgentId));
  });

  it("accepts fyi lifecycle without a navigateTarget (no link required)", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", lifecycle: "fyi", title: "no link needed" });
    assert.ok(await get(id));
  });

  it("persists across engine 'restart' (re-reading from disk)", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "persist me",
    });
    // Simulating a restart: drop the engine's path binding, then
    // re-set it. The engine has no in-memory cache, so a fresh
    // listAll() must read from disk and find the entry.
    _setFilePathsForTesting({ active: activeFile, history: historyFile });
    const entries = await listAll();
    const found = entries.find((entry) => entry.id === id);
    assert.ok(found, "entry should survive a path rebind");
  });
});

describe("clear", () => {
  it("removes the entry and emits `cleared`", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "clear me",
    });
    emittedEvents.length = 0;
    await clear(id);
    assert.equal(await get(id), undefined);
    assert.equal(emittedEvents.length, 1);
    assert.deepEqual(emittedEvents[0], { type: "cleared", id });
  });

  it("is idempotent: a second clear is a no-op (no throw, no emit)", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "x",
    });
    await clear(id);
    emittedEvents.length = 0;
    await clear(id);
    assert.equal(emittedEvents.length, 0, "no event on duplicate clear");
  });

  it("on unknown id is a no-op (no throw, no emit, no file mutation)", async () => {
    // Pre-publish so we have a known file state to compare against.
    await publish({ pluginPkg: "debug__system", severity: "info", title: "marker" });
    const before = readFileSync(activeFile, "utf-8");
    emittedEvents.length = 0;
    await clear("00000000-0000-0000-0000-000000000000");
    assert.equal(emittedEvents.length, 0);
    const after = readFileSync(activeFile, "utf-8");
    assert.equal(after, before, "file not rewritten on no-op clear");
  });
});

describe("cancel", () => {
  it("removes the entry and emits `cancelled`", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "cancel me",
    });
    emittedEvents.length = 0;
    await cancel(id);
    assert.equal(await get(id), undefined);
    assert.equal(emittedEvents.length, 1);
    assert.deepEqual(emittedEvents[0], { type: "cancelled", id });
  });

  it("emits `cancelled`, distinct from `cleared`, on the same removal mechanic", async () => {
    const { id: idA } = await publish({ pluginPkg: "x", severity: "info", title: "a" });
    const { id: idB } = await publish({ pluginPkg: "x", severity: "info", title: "b" });
    emittedEvents.length = 0;
    await clear(idA);
    await cancel(idB);
    assert.deepEqual(
      emittedEvents.map((event) => event.type),
      ["cleared", "cancelled"],
    );
  });
});

describe("listFor", () => {
  it("returns only entries with the given pluginPkg", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "a1" });
    await publish({ pluginPkg: "b", severity: "info", title: "b1" });
    await publish({ pluginPkg: "a", severity: "info", title: "a2" });

    const aEntries = await listFor("a");
    const bEntries = await listFor("b");
    assert.equal(aEntries.length, 2);
    assert.equal(bEntries.length, 1);
    assert.deepEqual(aEntries.map((entry) => entry.title).sort(), ["a1", "a2"]);
    assert.deepEqual(bEntries[0].title, "b1");
  });

  it("returns [] when nothing matches", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "x" });
    const result = await listFor("nope");
    assert.deepEqual(result, []);
  });

  it("returns [] on a fresh workspace (file doesn't exist yet)", async () => {
    assert.equal(existsSync(activeFile), false, "precondition: no file");
    const result = await listFor("anything");
    assert.deepEqual(result, []);
  });
});

describe("listAll", () => {
  it("returns every active entry", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "1" });
    await publish({ pluginPkg: "b", severity: "info", title: "2" });
    const entries = await listAll();
    assert.equal(entries.length, 2);
  });

  it("excludes cleared / cancelled entries", async () => {
    const { id: cleared } = await publish({ pluginPkg: "a", severity: "info", title: "c" });
    const { id: kept } = await publish({ pluginPkg: "a", severity: "info", title: "k" });
    await clear(cleared);
    const entries = await listAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, kept);
  });
});

describe("write coordination under concurrency", () => {
  it("10 simultaneous publishes all land in the file", async () => {
    const titles = Array.from({ length: 10 }, (_unused, index) => `concurrent-${index}`);
    const results = await Promise.all(titles.map((title) => publish({ pluginPkg: "concur", severity: "info", title })));
    assert.equal(new Set(results.map((result) => result.id)).size, 10, "ids are unique");

    const entries = await listAll();
    assert.equal(entries.length, 10);
    assert.deepEqual(entries.map((entry) => entry.title).sort(), titles.slice().sort());
  });

  it("interleaved publish + clear leaves the expected residual set", async () => {
    const published = await Promise.all(Array.from({ length: 5 }, (_unused, index) => publish({ pluginPkg: "concur", severity: "info", title: `t-${index}` })));
    // Concurrently clear three of them while two more publishes are
    // in flight; the queue's drainer batches them into one or two
    // load/save cycles. End state must reflect every operation.
    await Promise.all([
      clear(published[0].id),
      clear(published[1].id),
      clear(published[2].id),
      publish({ pluginPkg: "concur", severity: "info", title: "extra-1" }),
      publish({ pluginPkg: "concur", severity: "info", title: "extra-2" }),
    ]);

    const entries = await listAll();
    const titles = entries.map((entry) => entry.title).sort();
    assert.deepEqual(titles, ["extra-1", "extra-2", "t-3", "t-4"]);
  });
});

describe("on-disk format", () => {
  it("writes a valid JSON document with an `entries` map", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "y" });
    const raw = readFileSync(activeFile, "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed && typeof parsed === "object");
    assert.ok(parsed.entries && typeof parsed.entries === "object");
    assert.equal(parsed.entries[id]?.id, id);
  });

  it("creates the file on first publish (no eager init)", async () => {
    assert.equal(existsSync(activeFile), false, "precondition: no file");
    await publish({ pluginPkg: "x", severity: "info", title: "y" });
    assert.equal(existsSync(activeFile), true);
  });
});

describe("navigateTarget", () => {
  it("round-trips through publish / get / listAll", async () => {
    const { id } = await publish({
      pluginPkg: "debug__encore",
      severity: "urgent",
      lifecycle: "action",
      title: "Pay property tax",
      navigateTarget: "/encore/property-tax",
    });
    const fetched = await get(id);
    assert.equal(fetched?.navigateTarget, "/encore/property-tax");
    const all = await listAll();
    const found = all.find((entry) => entry.id === id);
    assert.equal(found?.navigateTarget, "/encore/property-tax");
  });

  it("is undefined when not provided", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "no target" });
    const entry = await get(id);
    assert.equal(entry?.navigateTarget, undefined);
  });
});

describe("history", () => {
  it("starts empty", async () => {
    assert.deepEqual(await listHistory(), []);
  });

  it("captures cleared entries with terminal type and timestamp", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "to clear" });
    await clear(id);
    const history = await listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, id);
    assert.equal(history[0].terminalType, "cleared");
    assert.match(history[0].terminalAt, /\d{4}-\d{2}-\d{2}T/);
  });

  it("captures cancelled entries with `cancelled` terminal type", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "to cancel" });
    await cancel(id);
    const [head] = await listHistory();
    assert.equal(head.terminalType, "cancelled");
  });

  it("preserves the original entry fields (title, severity, navigateTarget, pluginData)", async () => {
    const { id } = await publish({
      pluginPkg: "x",
      severity: "urgent",
      lifecycle: "action",
      title: "preserve me",
      body: "with body",
      navigateTarget: "/somewhere",
      pluginData: { extra: "stuff" },
    });
    await clear(id);
    const [head] = await listHistory();
    assert.equal(head.title, "preserve me");
    assert.equal(head.severity, "urgent");
    assert.equal(head.lifecycle, "action");
    assert.equal(head.body, "with body");
    assert.equal(head.navigateTarget, "/somewhere");
    assert.deepEqual(head.pluginData, { extra: "stuff" });
  });

  it("orders newest first", async () => {
    const { id: idA } = await publish({ pluginPkg: "x", severity: "info", title: "a" });
    const { id: idB } = await publish({ pluginPkg: "x", severity: "info", title: "b" });
    const { id: idC } = await publish({ pluginPkg: "x", severity: "info", title: "c" });
    await clear(idA);
    await clear(idB);
    await clear(idC);
    const history = await listHistory();
    assert.deepEqual(
      history.map((entry) => entry.title),
      ["c", "b", "a"],
    );
  });

  it("caps at 50 entries (FIFO eviction)", async () => {
    const total = 55;
    const ids: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const result = await publish({ pluginPkg: "x", severity: "info", title: `t-${index}` });
      ids.push(result.id);
    }
    for (const entryId of ids) await clear(entryId);
    const history = await listHistory();
    assert.equal(history.length, 50);
    // Newest at index 0; oldest 5 (titles t-0..t-4) should be evicted.
    assert.equal(history[0].title, "t-54");
    assert.equal(history[49].title, "t-5");
  });

  it("survives a path rebind (persists to disk)", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "persist me" });
    await clear(id);
    _setFilePathsForTesting({ active: activeFile, history: historyFile });
    const history = await listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, id);
  });

  it("does not record no-op clears (unknown id)", async () => {
    await clear("00000000-0000-0000-0000-000000000000");
    assert.deepEqual(await listHistory(), []);
  });

  it("writes the history file at the configured path with an `entries` array", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "y" });
    await clear(id);
    const raw = readFileSync(historyFile, "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed && typeof parsed === "object");
    assert.ok(Array.isArray(parsed.entries));
    assert.equal(parsed.entries.length, 1);
  });
});

describe("input validation (size caps + URL shape)", () => {
  it("rejects empty title", async () => {
    await assert.rejects(publish({ pluginPkg: "x", severity: "info", title: "" }), /title/);
  });

  it(`rejects title longer than ${NOTIFIER_LIMITS.titleMax} chars`, async () => {
    const tooLong = "a".repeat(NOTIFIER_LIMITS.titleMax + 1);
    await assert.rejects(publish({ pluginPkg: "x", severity: "info", title: tooLong }), /title.*max length/);
  });

  it(`accepts title at exactly ${NOTIFIER_LIMITS.titleMax} chars (boundary)`, async () => {
    const justRight = "a".repeat(NOTIFIER_LIMITS.titleMax);
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: justRight });
    assert.ok(await get(id));
  });

  it(`rejects body longer than ${NOTIFIER_LIMITS.bodyMax} chars`, async () => {
    const tooLong = "a".repeat(NOTIFIER_LIMITS.bodyMax + 1);
    await assert.rejects(publish({ pluginPkg: "x", severity: "info", title: "ok", body: tooLong }), /body.*max length/);
  });

  it(`rejects navigateTarget longer than ${NOTIFIER_LIMITS.navigateTargetMax} chars`, async () => {
    const tooLong = `/${"a".repeat(NOTIFIER_LIMITS.navigateTargetMax)}`;
    await assert.rejects(
      publish({ pluginPkg: "x", severity: "nudge", lifecycle: "action", title: "t", navigateTarget: tooLong }),
      /navigateTarget.*max length/,
    );
  });

  it("rejects navigateTarget with an absolute URL scheme (open-redirect guard)", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "nudge",
        lifecycle: "action",
        title: "t",
        navigateTarget: "https://attacker.example/path",
      }),
      /navigateTarget.*relative path/,
    );
  });

  it("rejects navigateTarget with a `javascript:` scheme (XSS guard)", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "nudge",
        lifecycle: "action",
        title: "t",
        // eslint-disable-next-line no-script-url -- intentional: this is the attack input we're rejecting
        navigateTarget: "javascript:alert(1)",
      }),
      /navigateTarget.*relative path/,
    );
  });

  it("rejects scheme-relative navigateTarget (`//evil.com/...`)", async () => {
    await assert.rejects(
      publish({
        pluginPkg: "x",
        severity: "nudge",
        lifecycle: "action",
        title: "t",
        navigateTarget: "//evil.example/path",
      }),
      /navigateTarget.*relative path/,
    );
  });

  it("accepts a normal in-app navigateTarget (`/encore/taxes`)", async () => {
    const { id } = await publish({
      pluginPkg: "x",
      severity: "nudge",
      lifecycle: "action",
      title: "t",
      navigateTarget: "/encore/taxes",
    });
    const entry = await get(id);
    assert.equal(entry?.navigateTarget, "/encore/taxes");
  });

  it("rejects pluginData whose JSON exceeds the cap", async () => {
    const huge = "x".repeat(NOTIFIER_LIMITS.pluginDataMaxBytes + 1);
    await assert.rejects(publish({ pluginPkg: "x", severity: "info", title: "t", pluginData: { huge } }), /pluginData.*exceeds/);
  });

  it("rejects pluginData containing a circular reference", async () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    await assert.rejects(publish({ pluginPkg: "x", severity: "info", title: "t", pluginData: cyc }), /pluginData.*not JSON-serialisable/);
  });
});

describe("emit safety (pubsub fan-out failure isolation)", () => {
  it("a throwing pubsub.publish does not strand the awaited publish() call", async () => {
    // Re-init with a publisher that throws for every event. The
    // engine must still resolve the publish() promise — fan-out is
    // best-effort, the write already committed.
    initNotifier({
      publish: () => {
        throw new Error("subscriber blew up");
      },
    });
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "still resolves" });
    // The write committed and is visible on subsequent reads.
    const entry = await get(id);
    assert.equal(entry?.id, id);
  });

  it("subsequent operations remain unblocked after a throwing emit", async () => {
    initNotifier({
      publish: () => {
        throw new Error("nope");
      },
    });
    const { id: idA } = await publish({ pluginPkg: "x", severity: "info", title: "a" });
    const { id: idB } = await publish({ pluginPkg: "x", severity: "info", title: "b" });
    await clear(idA);
    const entries = await listAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, idB);
  });
});

describe("clearForPlugin (per-plugin isolation)", () => {
  it("clears an entry the caller owns", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "mine" });
    await clearForPlugin("@scope/owner", id);
    assert.equal(await get(id), undefined);
    const [terminal] = await listHistory();
    assert.equal(terminal.id, id);
    assert.equal(terminal.terminalType, "cleared");
  });

  it("silently no-ops when the entry belongs to another plugin", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "owned" });
    emittedEvents.length = 0;
    await clearForPlugin("@scope/intruder", id);
    // Entry survives, no event was emitted, history stays empty.
    assert.ok(await get(id), "entry must remain when caller is not the owner");
    assert.equal(emittedEvents.length, 0, "no event emitted on owner mismatch");
    assert.deepEqual(await listHistory(), []);
  });

  it("silently no-ops on an unknown id (matches existing clear semantics)", async () => {
    emittedEvents.length = 0;
    await clearForPlugin("@scope/anyone", "00000000-0000-0000-0000-000000000000");
    assert.equal(emittedEvents.length, 0);
  });

  it("does not record cross-plugin attempts in history (audit cleanliness)", async () => {
    await publish({ pluginPkg: "@scope/a", severity: "info", title: "ours" });
    const { id: stranger } = await publish({ pluginPkg: "@scope/b", severity: "info", title: "theirs" });
    await clearForPlugin("@scope/a", stranger); // attempt
    assert.deepEqual(await listHistory(), []);
  });
});

describe("updateForPlugin (in-place state refresh)", () => {
  it("rewrites only the patched fields and keeps id, lifecycle, createdAt, pluginPkg fixed", async () => {
    const { id } = await publish({
      pluginPkg: "@scope/owner",
      severity: "nudge",
      lifecycle: "action",
      title: "Pay tax",
      body: "Due Friday",
      navigateTarget: "/x",
      pluginData: { todoId: "abc" },
    });
    const before = await get(id);
    assert.ok(before);
    const { createdAt } = before;

    await updateForPlugin("@scope/owner", id, { title: "Pay state tax", severity: "urgent" });

    const after = await get(id);
    assert.ok(after);
    assert.equal(after.id, id, "id must be stable");
    assert.equal(after.pluginPkg, "@scope/owner");
    assert.equal(after.lifecycle, "action", "lifecycle is not updatable");
    assert.equal(after.createdAt, createdAt, "createdAt must be stable");
    assert.equal(after.title, "Pay state tax", "title rewritten");
    assert.equal(after.severity, "urgent", "severity rewritten");
    assert.equal(after.body, "Due Friday", "body not in patch — must be preserved");
    assert.equal(after.navigateTarget, "/x", "navigateTarget not in patch — must be preserved");
    assert.deepEqual(after.pluginData, { todoId: "abc" }, "pluginData not in patch — must be preserved");
  });

  it("emits exactly one `updated` event after a successful update", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "t" });
    emittedEvents.length = 0;
    await updateForPlugin("@scope/owner", id, { title: "t2" });
    assert.equal(emittedEvents.length, 1);
    const [event] = emittedEvents;
    assert.equal(event.type, "updated");
    if (event.type === "updated") {
      assert.equal(event.entry.id, id);
      assert.equal(event.entry.title, "t2");
    }
  });

  it("never writes to history (updated entries are still active)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "t" });
    await updateForPlugin("@scope/owner", id, { title: "t2" });
    assert.deepEqual(await listHistory(), [], "update must not pollute history");
  });

  it("survives a JSON round-trip (active.json persists the new fields)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "first" });
    await updateForPlugin("@scope/owner", id, { title: "second", body: "now with body" });
    // The file on disk is the source of truth — re-read it directly.
    const fileContents = JSON.parse(readFileSync(activeFile, "utf-8"));
    assert.equal(fileContents.entries[id].title, "second");
    assert.equal(fileContents.entries[id].body, "now with body");
  });

  it("silently no-ops on unknown id", async () => {
    emittedEvents.length = 0;
    await updateForPlugin("@scope/anyone", "00000000-0000-0000-0000-000000000000", { title: "ghost" });
    assert.equal(emittedEvents.length, 0);
    assert.deepEqual(await listHistory(), []);
  });

  it("silently no-ops when the entry belongs to another plugin", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "theirs" });
    emittedEvents.length = 0;
    await updateForPlugin("@scope/intruder", id, { title: "hijacked" });
    const after = await get(id);
    assert.equal(after?.title, "theirs", "another plugin must not be able to mutate this entry");
    assert.equal(emittedEvents.length, 0);
  });

  it("rejects a patch that would make action+info severity (validation re-runs)", async () => {
    const { id } = await publish({
      pluginPkg: "@scope/owner",
      severity: "nudge",
      lifecycle: "action",
      title: "Live",
      navigateTarget: "/x",
    });
    emittedEvents.length = 0;
    await updateForPlugin("@scope/owner", id, { severity: "info" });
    // Patch silently rejected — entry unchanged, no event emitted.
    const after = await get(id);
    assert.equal(after?.severity, "nudge", "severity must not have dropped to info on an action entry");
    assert.equal(emittedEvents.length, 0);
  });

  it("rejects a patch that would empty the title", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "non-empty" });
    emittedEvents.length = 0;
    await updateForPlugin("@scope/owner", id, { title: "" });
    const after = await get(id);
    assert.equal(after?.title, "non-empty", "empty title rejected, original preserved");
    assert.equal(emittedEvents.length, 0);
  });

  it("rejects a patch that would oversize the title", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "ok" });
    emittedEvents.length = 0;
    await updateForPlugin("@scope/owner", id, { title: "x".repeat(NOTIFIER_LIMITS.titleMax + 1) });
    const after = await get(id);
    assert.equal(after?.title, "ok");
    assert.equal(emittedEvents.length, 0);
  });

  it("allows updating pluginData (opaque round-trip, like publish)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "t", pluginData: { v: 1 } });
    await updateForPlugin("@scope/owner", id, { pluginData: { v: 2, extra: "added" } });
    const after = await get(id);
    assert.deepEqual(after?.pluginData, { v: 2, extra: "added" });
  });

  it("does not interfere with a subsequent clear (same id, normal terminal path)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "t" });
    await updateForPlugin("@scope/owner", id, { title: "t2" });
    await clearForPlugin("@scope/owner", id);
    assert.equal(await get(id), undefined, "entry removed by clear");
    const [terminal] = await listHistory();
    assert.equal(terminal.id, id);
    assert.equal(terminal.title, "t2", "history records the LAST seen title before clear");
  });
});

describe("getForPlugin (scoped point lookup)", () => {
  it("returns the entry when caller owns it", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "mine" });
    const entry = await getForPlugin("@scope/owner", id);
    assert.ok(entry);
    assert.equal(entry.id, id);
    assert.equal(entry.title, "mine");
  });

  it("returns undefined for an unknown id (ghost bell)", async () => {
    const entry = await getForPlugin("@scope/owner", "00000000-0000-0000-0000-000000000000");
    assert.equal(entry, undefined);
  });

  it("returns undefined when the entry belongs to another plugin (isolation)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/a", severity: "info", title: "ours" });
    // Probe from another plugin — must not be readable, same shape
    // as clearForPlugin/updateForPlugin isolation.
    const fromStranger = await getForPlugin("@scope/b", id);
    assert.equal(fromStranger, undefined, "cross-plugin lookups must come back as undefined");
    // Owner can still see it.
    const fromOwner = await getForPlugin("@scope/a", id);
    assert.ok(fromOwner, "owner read must succeed");
  });

  it("returns undefined for an entry that was just cleared (ghost detection works post-clear)", async () => {
    const { id } = await publish({ pluginPkg: "@scope/owner", severity: "info", title: "doomed" });
    assert.ok(await getForPlugin("@scope/owner", id), "alive before clear");
    await clearForPlugin("@scope/owner", id);
    assert.equal(await getForPlugin("@scope/owner", id), undefined, "absent after clear");
  });
});
