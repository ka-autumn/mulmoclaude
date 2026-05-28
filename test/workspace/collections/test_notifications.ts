// Reconciler tests for collection-completion bell notifications.
// Drives the reconciler functions against a tmpdir workspace + tmpdir
// notifier active.json so the assertions are deterministic and never
// touch `~/mulmoclaude/`.
//
// Covers the scenarios called out in the PR review:
//   - publish on pending create (`reconcileItem` with non-done item)
//   - clear on done transition (`reconcileItem` with done item)
//   - clear on delete (`reconcileItem` when the file is gone)
//   - schema flip on/off (sweep + reconcile when completionField vanishes)
//   - runtime collection removal (sweep when the schema is deleted)
//   - defensive multi-drain in `clearItemNotification`
//
// The watcher's plumbing (fs.watch + single-flight + boot reconcile)
// is exercised in test_watcher.ts.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _setFilePathsForTesting, initNotifier, listAll, publish as notifierPublish } from "../../../server/notifier/engine.js";
import {
  clearItemNotification,
  itemIsDone,
  reconcileAllItems,
  reconcileItem,
  resolveDisplayLabel,
  sweepStaleActiveEntries,
} from "../../../server/workspace/collections/notifications.js";
import type { CollectionSchema } from "../../../server/workspace/collections/types.js";

let workdir: string;
let userDir: string;
let notifierDir: string;
let dataDir: string;

const SLUG = "test-completion";

function buildSchema(extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return {
    title: "Test Completion",
    icon: "check_circle",
    dataPath: `data/${SLUG}/items`,
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      read: { type: "boolean", label: "Read", required: true },
    },
    completionField: "read",
    completionDoneValues: ["true"],
    ...extra,
  };
}

function writeSchemaJson(schema: CollectionSchema | null): void {
  const skillDir = path.join(workdir, ".claude/skills", SLUG);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${SLUG}\ndescription: test\n---\nbody\n`);
  if (schema !== null) {
    writeFileSync(path.join(skillDir, "schema.json"), JSON.stringify(schema));
  }
}

function deleteSchemaDir(): void {
  rmSync(path.join(workdir, ".claude/skills", SLUG), { recursive: true, force: true });
}

function writeItem(itemId: string, body: Record<string, unknown>): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, `${itemId}.json`), JSON.stringify({ id: itemId, ...body }));
}

function deleteItemFile(itemId: string): void {
  unlinkSync(path.join(dataDir, `${itemId}.json`));
}

async function activeCompletionEntries(): Promise<{ id: string; legacyId: string; navigateTarget: string | undefined; title: string }[]> {
  const entries = await listAll();
  return entries
    .filter((entry) => {
      const data = entry.pluginData as Record<string, unknown> | undefined;
      return data?.legacy === true && typeof data.legacyId === "string" && (data.legacyId as string).startsWith("collection-completion:");
    })
    .map((entry) => ({
      id: entry.id,
      legacyId: (entry.pluginData as Record<string, unknown>).legacyId as string,
      navigateTarget: entry.navigateTarget,
      title: entry.title,
    }));
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "test-completion-notifications-"));
  userDir = mkdtempSync(path.join(tmpdir(), "test-completion-notifications-user-"));
  notifierDir = mkdtempSync(path.join(tmpdir(), "test-completion-notifications-notifier-"));
  dataDir = path.join(workdir, "data", SLUG, "items");
  _setFilePathsForTesting({
    active: path.join(notifierDir, "active.json"),
    history: path.join(notifierDir, "history.json"),
  });
  initNotifier({ publish: () => {} });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
  rmSync(notifierDir, { recursive: true, force: true });
});

describe("itemIsDone", () => {
  it("returns true when the stringified field value is in completionDoneValues", () => {
    const schema = buildSchema();
    assert.equal(itemIsDone(schema, { id: "x", read: true }), true);
    assert.equal(itemIsDone(schema, { id: "x", read: "true" }), true);
  });

  it("returns false when the value is not in completionDoneValues", () => {
    const schema = buildSchema();
    assert.equal(itemIsDone(schema, { id: "x", read: false }), false);
    assert.equal(itemIsDone(schema, { id: "x", read: "false" }), false);
  });

  it("returns false when the value is missing entirely", () => {
    const schema = buildSchema();
    assert.equal(itemIsDone(schema, { id: "x" }), false);
    assert.equal(itemIsDone(schema, { id: "x", read: undefined }), false);
    assert.equal(itemIsDone(schema, { id: "x", read: null }), false);
  });

  it("returns false when the schema doesn't declare completion tracking", () => {
    const schema = buildSchema({ completionField: undefined, completionDoneValues: undefined });
    assert.equal(itemIsDone(schema, { id: "x", read: true }), false);
  });

  it("supports enum-style completion (e.g. invoice status)", () => {
    const schema = buildSchema({ completionField: "status", completionDoneValues: ["paid", "void"] });
    assert.equal(itemIsDone(schema, { id: "x", status: "paid" }), true);
    assert.equal(itemIsDone(schema, { id: "x", status: "void" }), true);
    assert.equal(itemIsDone(schema, { id: "x", status: "draft" }), false);
  });
});

describe("reconcileItem", () => {
  it("publishes a bell entry for a pending item with no existing entry", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    const entries = await activeCompletionEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.legacyId, `collection-completion:${SLUG}:a`);
    assert.equal(entries[0]?.title, `${schema.title}: a`);
    // Deep-link target includes the itemId so the bell click opens the detail.
    assert.equal(entries[0]?.navigateTarget, `/collections/${SLUG}?selected=a`);
  });

  it("is idempotent — a second reconcile on the same pending item doesn't dup", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    const entries = await activeCompletionEntries();
    assert.equal(entries.length, 1);
  });

  it("clears the bell entry when the item transitions to a done value", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    // Flip the item to done by rewriting the file.
    writeItem("a", { read: true });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("clears the bell entry when the item file is deleted", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    deleteItemFile("a");
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("clears the entry when the schema no longer declares completionField", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    // Simulate a runtime schema edit that drops completion tracking.
    const flipped = buildSchema({ completionField: undefined, completionDoneValues: undefined });
    await reconcileItem(SLUG, flipped, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("does NOT publish for an item born done", async () => {
    const schema = buildSchema();
    writeItem("a", { read: true });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("titles the entry with displayField value when declared", async () => {
    const schema = buildSchema({
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        title: { type: "string", label: "Title", required: true },
        read: { type: "boolean", label: "Read", required: true },
      },
      displayField: "title",
    });
    writeItem("a", { title: "Buy milk", read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    const entries = await activeCompletionEntries();
    assert.equal(entries[0]?.title, `${schema.title}: Buy milk`);
    // Deep-link still keys on the primaryKey, not the label.
    assert.equal(entries[0]?.navigateTarget, `/collections/${SLUG}?selected=a`);
  });

  it("falls back to the primaryKey when displayField value is empty", async () => {
    const schema = buildSchema({
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        title: { type: "string", label: "Title", required: true },
        read: { type: "boolean", label: "Read", required: true },
      },
      displayField: "title",
    });
    writeItem("a", { title: "   ", read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    const entries = await activeCompletionEntries();
    assert.equal(entries[0]?.title, `${schema.title}: a`);
  });
});

describe("resolveDisplayLabel", () => {
  it("returns the itemId when no displayField is declared", () => {
    assert.equal(resolveDisplayLabel(buildSchema(), { id: "a", read: false }, "a"), "a");
  });

  it("returns the displayField value when present and non-empty", () => {
    const schema = buildSchema({ displayField: "title" });
    assert.equal(resolveDisplayLabel(schema, { id: "a", title: "Buy milk" }, "a"), "Buy milk");
  });

  it("trims the displayField value", () => {
    const schema = buildSchema({ displayField: "title" });
    assert.equal(resolveDisplayLabel(schema, { id: "a", title: "  Buy milk  " }, "a"), "Buy milk");
  });

  it("falls back to the itemId when the displayField value is missing or empty", () => {
    const schema = buildSchema({ displayField: "title" });
    assert.equal(resolveDisplayLabel(schema, { id: "a", read: false }, "a"), "a");
    assert.equal(resolveDisplayLabel(schema, { id: "a", title: "" }, "a"), "a");
    assert.equal(resolveDisplayLabel(schema, { id: "a", title: null }, "a"), "a");
  });

  it("stringifies a non-string displayField value", () => {
    const schema = buildSchema({ displayField: "count" });
    assert.equal(resolveDisplayLabel(schema, { id: "a", count: 42 }, "a"), "42");
  });
});

describe("reconcileAllItems", () => {
  it("walks every record and reconciles each", async () => {
    const schema = buildSchema();
    writeItem("a", { read: false });
    writeItem("b", { read: true });
    writeItem("c", { read: false });
    await reconcileAllItems(SLUG, schema, dataDir, { workspaceRoot: workdir });
    const entries = await activeCompletionEntries();
    const legacyIds = entries.map((entry) => entry.legacyId).sort();
    assert.deepEqual(legacyIds, [`collection-completion:${SLUG}:a`, `collection-completion:${SLUG}:c`]);
  });

  it("is a no-op when the schema has no completionField", async () => {
    const schema = buildSchema({ completionField: undefined, completionDoneValues: undefined });
    writeItem("a", { read: false });
    await reconcileAllItems(SLUG, schema, dataDir, { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });
});

describe("clearItemNotification", () => {
  it("drains every matching entry, not just the first (defense against dupes)", async () => {
    // Manually publish two entries with the same legacyId to simulate a
    // historical race producing duplicates — the clear path must take
    // them both out, not leave a stuck one behind.
    const legacyId = `collection-completion:${SLUG}:a`;
    const pluginData = {
      legacy: true,
      legacyId,
      kind: "todo",
      priority: "normal",
      action: { type: "navigate", target: { view: "collections", slug: SLUG, itemId: "a" } },
    };
    await notifierPublish({
      pluginPkg: "todo",
      severity: "nudge",
      lifecycle: "action",
      title: "dup 1",
      navigateTarget: `/collections/${SLUG}?selected=a`,
      pluginData,
    });
    await notifierPublish({
      pluginPkg: "todo",
      severity: "nudge",
      lifecycle: "action",
      title: "dup 2",
      navigateTarget: `/collections/${SLUG}?selected=a`,
      pluginData,
    });
    assert.equal((await activeCompletionEntries()).length, 2);
    await clearItemNotification(SLUG, "a");
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("is a silent no-op when no matching entry exists", async () => {
    await clearItemNotification(SLUG, "ghost");
    assert.equal((await activeCompletionEntries()).length, 0);
  });
});

describe("sweepStaleActiveEntries", () => {
  it("clears entries whose collection no longer exists", async () => {
    const schema = buildSchema();
    writeSchemaJson(schema);
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    // Delete the schema dir to simulate a collection deletion.
    deleteSchemaDir();
    await sweepStaleActiveEntries({ workspaceRoot: workdir, userSkillsDir: userDir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("clears entries when the schema dropped its completionField", async () => {
    const schema = buildSchema();
    writeSchemaJson(schema);
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    // Rewrite the schema without completionField.
    writeSchemaJson(buildSchema({ completionField: undefined, completionDoneValues: undefined }));
    await sweepStaleActiveEntries({ workspaceRoot: workdir, userSkillsDir: userDir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("clears entries whose underlying item file is gone", async () => {
    const schema = buildSchema();
    writeSchemaJson(schema);
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    deleteItemFile("a");
    await sweepStaleActiveEntries({ workspaceRoot: workdir, userSkillsDir: userDir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("clears entries when the item is now done", async () => {
    const schema = buildSchema();
    writeSchemaJson(schema);
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    // Flip the file to done without going through reconcileItem — sweep
    // is the safety net for changes made while the watcher was down.
    writeItem("a", { read: true });
    await sweepStaleActiveEntries({ workspaceRoot: workdir, userSkillsDir: userDir });
    assert.equal((await activeCompletionEntries()).length, 0);
  });

  it("leaves still-pending entries alone", async () => {
    const schema = buildSchema();
    writeSchemaJson(schema);
    writeItem("a", { read: false });
    await reconcileItem(SLUG, schema, dataDir, "a", { workspaceRoot: workdir });
    assert.equal((await activeCompletionEntries()).length, 1);
    await sweepStaleActiveEntries({ workspaceRoot: workdir, userSkillsDir: userDir });
    assert.equal((await activeCompletionEntries()).length, 1);
  });
});
