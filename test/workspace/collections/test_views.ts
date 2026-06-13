// deleteCustomView — removes a custom view from every on-disk schema.json
// copy and unlinks its HTML file, source-aware (project staging+mirror vs a
// feed's single tree). Pins the scope guards (user-scope, preset) and the
// path-containment refusal.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { deleteCustomView } from "../../../server/workspace/collections/views.js";
import type { LoadedCollection } from "../../../server/workspace/collections/discovery.js";
import type { CollectionCustomView, CollectionSchema, CollectionSource } from "../../../server/workspace/collections/types.js";

let workdir: string;

const YEAR_VIEW: CollectionCustomView = { id: "year", label: "Year grid", file: "views/year.html", capabilities: ["read"] };
const MONTH_VIEW: CollectionCustomView = { id: "month", label: "Month grid", file: "views/month.html", capabilities: ["read"] };

function schemaWith(slug: string, views: CollectionCustomView[]): CollectionSchema {
  return {
    title: "Events",
    icon: "event",
    dataPath: `data/${slug}/items`,
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true } },
    views,
  };
}

function readViewIds(schemaPath: string): string[] {
  const parsed = JSON.parse(readFileSync(schemaPath, "utf-8")) as { views?: { id?: string }[] };
  return (parsed.views ?? []).map((entry) => entry.id ?? "");
}

/** Project collection: schema.json lives in BOTH the staging tree and the
 *  active mirror; the view HTML is staging-only. */
function seedProject(slug: string, views: CollectionCustomView[]): LoadedCollection {
  const schema = schemaWith(slug, views);
  const staging = path.join(workdir, "data", "skills", slug);
  const active = path.join(workdir, ".claude", "skills", slug);
  mkdirSync(path.join(staging, "views"), { recursive: true });
  mkdirSync(active, { recursive: true });
  writeFileSync(path.join(staging, "schema.json"), JSON.stringify(schema, null, 2));
  writeFileSync(path.join(active, "schema.json"), JSON.stringify(schema, null, 2));
  for (const view of views) writeFileSync(path.join(staging, view.file), "<html></html>");
  return { slug, source: "project", schema, dataDir: path.join(workdir, "data", slug, "items"), skillDir: active };
}

/** Feed (or user) collection: a single tree at skillDir holds schema.json and
 *  the view HTML. */
function seedSingleTree(slug: string, source: CollectionSource, root: string, views: CollectionCustomView[]): LoadedCollection {
  const schema = schemaWith(slug, views);
  const skillDir = path.join(workdir, root, slug);
  mkdirSync(path.join(skillDir, "views"), { recursive: true });
  writeFileSync(path.join(skillDir, "schema.json"), JSON.stringify(schema, null, 2));
  for (const view of views) writeFileSync(path.join(skillDir, view.file), "<html></html>");
  return { slug, source, schema, dataDir: path.join(workdir, "data", "feeds", slug), skillDir };
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-views-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("deleteCustomView", () => {
  it("drops the entry from BOTH schema copies and unlinks the staging HTML (project)", async () => {
    const collection = seedProject("events", [YEAR_VIEW, MONTH_VIEW]);
    const result = await deleteCustomView(collection, "year", { workspaceRoot: workdir });

    assert.equal(result.kind, "ok");
    const staging = path.join(workdir, "data", "skills", "events");
    const active = path.join(workdir, ".claude", "skills", "events");
    // The removed view is gone from staging + active; the other survives.
    assert.deepEqual(readViewIds(path.join(staging, "schema.json")), ["month"]);
    assert.deepEqual(readViewIds(path.join(active, "schema.json")), ["month"]);
    // Its HTML is unlinked; the sibling view's HTML is untouched.
    assert.equal(existsSync(path.join(staging, "views", "year.html")), false, "deleted view HTML must be unlinked");
    assert.equal(existsSync(path.join(staging, "views", "month.html")), true, "sibling view HTML must remain");
  });

  it("keeps a shared HTML file when another view still references it", async () => {
    // Two distinct ids pointing at the same file: deleting one must NOT unlink
    // the file the other still renders from.
    const shared = { ...MONTH_VIEW, id: "month-alt" };
    const collection = seedProject("events", [MONTH_VIEW, shared]);
    const result = await deleteCustomView(collection, "month", { workspaceRoot: workdir });

    assert.equal(result.kind, "ok");
    const staging = path.join(workdir, "data", "skills", "events");
    assert.deepEqual(readViewIds(path.join(staging, "schema.json")), ["month-alt"]);
    assert.equal(existsSync(path.join(staging, "views", "month.html")), true, "shared HTML must survive while a sibling references it");
  });

  it("removes a feed's view from its single-tree schema + HTML", async () => {
    const collection = seedSingleTree("news", "feed", "feeds", [YEAR_VIEW]);
    const result = await deleteCustomView(collection, "year", { workspaceRoot: workdir });

    assert.equal(result.kind, "ok");
    const skillDir = path.join(workdir, "feeds", "news");
    assert.deepEqual(readViewIds(path.join(skillDir, "schema.json")), []);
    assert.equal(existsSync(path.join(skillDir, "views", "year.html")), false, "feed view HTML remains");
  });

  it("still cleans the schema when the HTML file is already missing (idempotent unlink)", async () => {
    const collection = seedProject("events", [YEAR_VIEW]);
    rmSync(path.join(workdir, "data", "skills", "events", "views", "year.html"));
    const result = await deleteCustomView(collection, "year", { workspaceRoot: workdir });

    assert.equal(result.kind, "ok");
    assert.deepEqual(readViewIds(path.join(workdir, "data", "skills", "events", "schema.json")), []);
  });

  it("returns not-found for an unknown view id and touches nothing", async () => {
    const collection = seedProject("events", [YEAR_VIEW]);
    const result = await deleteCustomView(collection, "nope", { workspaceRoot: workdir });

    assert.equal(result.kind, "not-found");
    assert.deepEqual(readViewIds(path.join(workdir, "data", "skills", "events", "schema.json")), ["year"]);
    assert.equal(existsSync(path.join(workdir, "data", "skills", "events", "views", "year.html")), true);
  });

  it("refuses a user-scope collection (read-only) and leaves it intact", async () => {
    const collection = seedSingleTree("private", "user", path.join(".claude", "skills"), [YEAR_VIEW]);
    const result = await deleteCustomView(collection, "year", { workspaceRoot: workdir });

    assert.equal(result.kind, "user-scope");
    assert.deepEqual(readViewIds(path.join(workdir, ".claude", "skills", "private", "schema.json")), ["year"]);
  });

  it("refuses a preset (mc-*) collection and leaves it intact", async () => {
    const collection = seedProject("mc-invoice", [YEAR_VIEW]);
    const result = await deleteCustomView(collection, "year", { workspaceRoot: workdir });

    assert.equal(result.kind, "preset");
    assert.deepEqual(readViewIds(path.join(workdir, "data", "skills", "mc-invoice", "schema.json")), ["year"]);
  });

  it("refuses a view whose file path escapes its base and deletes nothing", async () => {
    const escaping: CollectionCustomView = { id: "evil", label: "Evil", file: "views/../../escape.html", capabilities: ["read"] };
    const collection = seedProject("events", [escaping]);
    const result = await deleteCustomView(collection, "evil", { workspaceRoot: workdir });

    assert.equal(result.kind, "unsafe-path");
    // The schema entry survives — nothing was removed.
    assert.deepEqual(readViewIds(path.join(workdir, "data", "skills", "events", "schema.json")), ["evil"]);
  });
});
