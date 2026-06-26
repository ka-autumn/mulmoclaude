import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRegistryIndex } from "../../server/workspace/collectionsRegistry/registryIndex.js";

function validEntry(): Record<string, unknown> {
  return {
    id: "isamu/movies",
    author: "isamu",
    slug: "movies",
    title: "映画リスト",
    icon: "movie",
    description: "Movies I track.",
    version: "1.0.0",
    tags: ["entertainment"],
    license: "MIT",
    fieldCount: 15,
    views: ["シネマ"],
    hasSeed: true,
    seedCount: 3,
    path: "collections/isamu/movies",
    contentSha: "305247fb2e1432da",
  };
}

function validIndex(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-26T20:36:50.991Z",
    registry: "receptron/mulmoclaude-collections",
    collections: [validEntry()],
  };
}

describe("parseRegistryIndex", () => {
  it("accepts a well-formed index and preserves entries", () => {
    const result = parseRegistryIndex(validIndex());
    assert.ok(result.ok);
    assert.equal(result.index.registry, "receptron/mulmoclaude-collections");
    assert.equal(result.index.collections.length, 1);
    const [entry] = result.index.collections;
    assert.equal(entry.id, "isamu/movies");
    assert.equal(entry.fieldCount, 15);
    assert.deepEqual(entry.views, ["シネマ"]);
    assert.equal(entry.hasSeed, true);
  });

  it("rejects a non-object", () => {
    for (const bad of [null, 42, "x", []]) {
      const result = parseRegistryIndex(bad);
      assert.equal(result.ok, false);
    }
  });

  it("rejects an unsupported schemaVersion", () => {
    const result = parseRegistryIndex({ ...validIndex(), schemaVersion: 2 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /schemaVersion/);
  });

  it("rejects a missing registry or generatedAt", () => {
    const noRegistry = parseRegistryIndex({ ...validIndex(), registry: "" });
    assert.equal(noRegistry.ok, false);
    const noGenerated = parseRegistryIndex({ ...validIndex(), generatedAt: undefined });
    assert.equal(noGenerated.ok, false);
  });

  it("rejects when collections is not an array", () => {
    const result = parseRegistryIndex({ ...validIndex(), collections: {} });
    assert.equal(result.ok, false);
  });

  it("rejects an entry missing a required string field", () => {
    const broken = validEntry();
    delete broken.contentSha;
    const result = parseRegistryIndex({ ...validIndex(), collections: [broken] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /collections\[0\]/);
  });

  it("defaults optional fields when omitted", () => {
    const minimal = {
      id: "a/b",
      author: "a",
      slug: "b",
      title: "B",
      version: "0.1.0",
      path: "collections/a/b",
      contentSha: "deadbeef",
    };
    const result = parseRegistryIndex({ ...validIndex(), collections: [minimal] });
    assert.ok(result.ok);
    const [entry] = result.index.collections;
    assert.deepEqual(entry.tags, []);
    assert.deepEqual(entry.views, []);
    assert.equal(entry.hasSeed, false);
    assert.equal(entry.seedCount, 0);
    assert.equal(entry.fieldCount, 0);
    assert.equal(entry.screenshot, undefined);
    assert.equal(entry.icon, "");
  });

  it("rejects negative or fractional count fields", () => {
    for (const bad of [-1, 1.5, -0.5]) {
      const fieldBad = parseRegistryIndex({ ...validIndex(), collections: [{ ...validEntry(), fieldCount: bad }] });
      assert.equal(fieldBad.ok, false, `fieldCount ${bad}`);
      const seedBad = parseRegistryIndex({ ...validIndex(), collections: [{ ...validEntry(), seedCount: bad }] });
      assert.equal(seedBad.ok, false, `seedCount ${bad}`);
    }
  });

  it("rejects entries whose id/path disagree with author/slug", () => {
    const idMismatch = parseRegistryIndex({ ...validIndex(), collections: [{ ...validEntry(), id: "someone-else/movies" }] });
    assert.equal(idMismatch.ok, false);
    if (!idMismatch.ok) assert.match(idMismatch.error, /\.id must equal/);

    const pathMismatch = parseRegistryIndex({ ...validIndex(), collections: [{ ...validEntry(), path: "collections/someone-else/movies" }] });
    assert.equal(pathMismatch.ok, false);
    if (!pathMismatch.ok) assert.match(pathMismatch.error, /\.path must equal/);
  });

  it("rejects traversal/invalid author or slug even when id/path are internally consistent", () => {
    const poisoned = (author: string, slug: string) => ({ ...validEntry(), author, slug, id: `${author}/${slug}`, path: `collections/${author}/${slug}` });
    const cases: [string, string][] = [
      ["..", "movies"],
      ["a/b", "movies"],
      ["isamu", ".."],
      ["isamu", "a/b"],
      ["isamu.", "movies"],
      ["isamu", "mov.ies"],
      ["isa\\mu", "movies"],
      ["-isamu", "movies"],
    ];
    for (const [author, slug] of cases) {
      const result = parseRegistryIndex({ ...validIndex(), collections: [poisoned(author, slug)] });
      assert.equal(result.ok, false, `${author}/${slug} should be rejected`);
    }
  });

  it("accepts zero and positive integer counts", () => {
    const result = parseRegistryIndex({ ...validIndex(), collections: [{ ...validEntry(), fieldCount: 0, seedCount: 42 }] });
    assert.ok(result.ok);
    assert.equal(result.index.collections[0].fieldCount, 0);
    assert.equal(result.index.collections[0].seedCount, 42);
  });

  it("drops non-string members from tags/views", () => {
    const entry = { ...validEntry(), tags: ["ok", 1, null, "two"], views: [true, "v"] };
    const result = parseRegistryIndex({ ...validIndex(), collections: [entry] });
    assert.ok(result.ok);
    assert.deepEqual(result.index.collections[0].tags, ["ok", "two"]);
    assert.deepEqual(result.index.collections[0].views, ["v"]);
  });
});
