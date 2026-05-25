// File-disclosure defense for the collections io module. The dataDir-level
// realpath containment in test_paths.ts only proves the directory
// anchor is inside the workspace — a `*.json` symlink dropped INSIDE
// an otherwise-contained data dir could still point at any file on
// disk, and a naive readFile would happily serve it. This file pins
// the symlinked-record-file rejection from CodeRabbit's PR-1483
// round-2 review.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listItems, readItem, resolveCreateItemId } from "../../../server/workspace/collections/io.js";
import type { CollectionSchema } from "../../../server/workspace/collections/types.js";

let workdir: string;
let dataDir: string;
let outsideFile: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "apps-io-"));
  dataDir = path.join(workdir, "data", "clients", "items");
  mkdirSync(dataDir, { recursive: true });
  // A file outside the workspace that an attacker symlink would
  // expose if file-disclosure defense were missing.
  outsideFile = path.join(mkdtempSync(path.join(tmpdir(), "outside-")), "secret.json");
  writeFileSync(outsideFile, JSON.stringify({ secret: "should-not-be-served" }));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(path.dirname(outsideFile), { recursive: true, force: true });
});

describe("listItems file-disclosure defense", () => {
  it("returns regular records", async () => {
    writeFileSync(path.join(dataDir, "acme.json"), JSON.stringify({ id: "acme", name: "Acme" }));
    const items = await listItems(dataDir, { workspaceRoot: workdir });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, "acme");
  });

  it("skips symlinked record files even when the dataDir is contained", async () => {
    writeFileSync(path.join(dataDir, "real.json"), JSON.stringify({ id: "real", name: "Real" }));
    // The symlink lives inside the contained dataDir but points at
    // a file outside the workspace — exactly the file-disclosure
    // shape CodeRabbit flagged.
    symlinkSync(outsideFile, path.join(dataDir, "leaked.json"));
    const items = await listItems(dataDir, { workspaceRoot: workdir });
    assert.equal(items.length, 1, "symlinked record must not be included");
    assert.equal(items[0]?.id, "real");
  });

  it("returns [] when the dataDir does not exist (first-use)", async () => {
    const fresh = path.join(workdir, "data", "fresh", "items");
    const items = await listItems(fresh, { workspaceRoot: workdir });
    assert.deepEqual(items, []);
  });
});

describe("readItem file-disclosure defense", () => {
  it("reads a regular record", async () => {
    writeFileSync(path.join(dataDir, "acme.json"), JSON.stringify({ id: "acme", name: "Acme" }));
    const item = await readItem(dataDir, "acme", { workspaceRoot: workdir });
    assert.equal(item?.id, "acme");
  });

  it("returns null for a symlinked record file", async () => {
    symlinkSync(outsideFile, path.join(dataDir, "leaked.json"));
    const item = await readItem(dataDir, "leaked", { workspaceRoot: workdir });
    assert.equal(item, null);
  });

  it("returns null for an invalid slug", async () => {
    const item = await readItem(dataDir, "../escape", { workspaceRoot: workdir });
    assert.equal(item, null);
  });
});

describe("resolveCreateItemId — singleton enforcement", () => {
  const base = { title: "T", icon: "i", dataPath: "data/x/items", primaryKey: "id" };
  const singleton: CollectionSchema = { ...base, singleton: "me", fields: { id: { type: "string", label: "ID", primary: true } } };
  const normal: CollectionSchema = { ...base, fields: { id: { type: "string", label: "ID", primary: true } } };

  it("pins a singleton create to the fixed id, ignoring the body's primary key", () => {
    assert.equal(resolveCreateItemId(singleton, { id: "evil", name: "x" }), "me");
    assert.equal(resolveCreateItemId(singleton, {}), "me");
  });

  it("uses the body's primary key for a normal collection", () => {
    assert.equal(resolveCreateItemId(normal, { id: "acme-corp" }), "acme-corp");
  });

  it("returns null (caller generates) when a normal collection's body has no primary key", () => {
    assert.equal(resolveCreateItemId(normal, { name: "x" }), null);
    assert.equal(resolveCreateItemId(normal, { id: "" }), null);
  });
});
