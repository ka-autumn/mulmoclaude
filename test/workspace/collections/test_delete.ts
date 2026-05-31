// deleteCollection — archives a restorable copy, then removes all three
// on-disk locations (staging skill, active mirror, records). Also pins
// the scope guards: user-scope and preset (`mc-*`) collections refuse.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { deleteCollection } from "../../../server/workspace/collections/delete.js";
import type { LoadedCollection } from "../../../server/workspace/collections/discovery.js";
import type { CollectionSchema, CollectionSource } from "../../../server/workspace/collections/types.js";

let workdir: string;

function schemaFor(slug: string): CollectionSchema {
  return {
    title: "Restaurants",
    icon: "restaurant",
    dataPath: `data/${slug}/items`,
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true } },
  };
}

/** Lay down the three on-disk locations for `slug` and return the
 *  LoadedCollection a discovery pass would have produced. */
function seedCollection(slug: string, source: CollectionSource): LoadedCollection {
  const schema = schemaFor(slug);
  const stagingDir = path.join(workdir, "data", "skills", slug);
  const skillDir = path.join(workdir, ".claude", "skills", slug);
  const dataDir = path.join(workdir, "data", slug, "items");
  for (const dir of [stagingDir, skillDir, dataDir]) mkdirSync(dir, { recursive: true });
  for (const dir of [stagingDir, skillDir]) {
    writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
    writeFileSync(path.join(dir, "SKILL.md"), `# ${slug}`);
  }
  writeFileSync(path.join(dataDir, "acme.json"), JSON.stringify({ id: "acme" }));
  writeFileSync(path.join(dataDir, "globex.json"), JSON.stringify({ id: "globex" }));
  return { slug, source, schema, dataDir, skillDir };
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-delete-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("deleteCollection", () => {
  it("archives a copy and removes all three locations", async () => {
    const collection = seedCollection("restaurants", "project");
    const result = await deleteCollection(collection, { workspaceRoot: workdir, dateStamp: "2026-05-31" });

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.ok(result.archivePath.startsWith(path.join("archive", "2026-05-31-")), `unexpected archivePath: ${result.archivePath}`);

    // All three sources are gone.
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), false, "staging skill remains");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "restaurants")), false, "active mirror remains");
    assert.equal(existsSync(path.join(workdir, "data", "restaurants")), false, "records (and empty parent) remain");

    // The backup holds one skill copy, the records, and RESTORE.md.
    const archiveDir = path.join(workdir, result.archivePath);
    assert.ok(existsSync(path.join(archiveDir, "skill", "schema.json")), "archived schema.json missing");
    assert.ok(existsSync(path.join(archiveDir, "skill", "SKILL.md")), "archived SKILL.md missing");
    assert.ok(existsSync(path.join(archiveDir, "records", "acme.json")), "archived record missing");
    assert.ok(existsSync(path.join(archiveDir, "records", "globex.json")), "archived record missing");
    const restore = readFileSync(path.join(archiveDir, "RESTORE.md"), "utf-8");
    assert.match(restore, /restaurants/);
    assert.match(restore, /data\/restaurants\/items/);
  });

  it("refuses a user-scope collection (read-only) and leaves it intact", async () => {
    const collection = seedCollection("restaurants", "user");
    const result = await deleteCollection(collection, { workspaceRoot: workdir });
    assert.equal(result.kind, "user-scope");
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), true, "staging must survive a refused delete");
  });

  it("refuses a preset (mc-*) collection and leaves it intact", async () => {
    const collection = seedCollection("mc-invoice", "project");
    const result = await deleteCollection(collection, { workspaceRoot: workdir });
    assert.equal(result.kind, "preset");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "mc-invoice")), true, "mirror must survive a refused delete");
  });

  it("refuses a dataDir outside the per-collection subtree and deletes nothing", async () => {
    // A hostile/malformed schema points dataPath at the shared `data`
    // root, so loadCollection would resolve dataDir to <workdir>/data; a
    // recursive delete there would wipe every collection. The guard
    // validates the RESOLVED dataDir (not the schema string) and must
    // refuse BEFORE any archive/removal runs.
    const collection = seedCollection("restaurants", "project");
    const hostile: LoadedCollection = {
      ...collection,
      schema: { ...collection.schema, dataPath: "data" },
      dataDir: path.join(workdir, "data"),
    };
    const result = await deleteCollection(hostile, { workspaceRoot: workdir });
    assert.equal(result.kind, "unsafe-data-path");
    assert.equal(existsSync(path.join(workdir, "data", "skills", "restaurants")), true, "staging must survive");
    assert.equal(existsSync(path.join(workdir, ".claude", "skills", "restaurants")), true, "mirror must survive");
    assert.equal(existsSync(path.join(workdir, "data", "restaurants", "items")), true, "records must survive");
    assert.equal(existsSync(path.join(workdir, "archive")), false, "no archive should be written on refusal");
  });
});
