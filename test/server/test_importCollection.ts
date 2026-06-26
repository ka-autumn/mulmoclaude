import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isSafeBundlePath, parseManifest, normalizedDataPath, withNormalizedDataPath } from "../../server/workspace/collectionsRegistry/importCollection.js";

describe("isSafeBundlePath", () => {
  it("accepts normal relative bundle paths", () => {
    for (const ok of ["SKILL.md", "schema.json", "views/cinema.html", "seed/items/007-a.json", "templates/x.md"]) {
      assert.ok(isSafeBundlePath(ok), ok);
    }
  });

  it("rejects traversal, absolute, and malformed paths", () => {
    for (const bad of ["", "/etc/passwd", "../secret", "a/../b", "a/./b", "a//b", "a\\b", ".", "..", 42, null, undefined]) {
      assert.ok(!isSafeBundlePath(bad), String(bad));
    }
  });
});

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = parseManifest({ files: ["SKILL.md", "schema.json", "seed/items/a.json"] });
    assert.ok(result.ok);
    assert.deepEqual(result.files, ["SKILL.md", "schema.json", "seed/items/a.json"]);
  });

  it("rejects a non-object or missing files[]", () => {
    for (const bad of [null, 42, {}, { files: "x" }, { files: {} }]) {
      assert.equal(parseManifest(bad).ok, false);
    }
  });

  it("rejects a manifest containing an unsafe path", () => {
    const result = parseManifest({ files: ["SKILL.md", "../../etc/passwd"] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /unsafe path/);
  });
});

describe("dataPath normalization", () => {
  it("derives data/collections/<slug>/items", () => {
    assert.equal(normalizedDataPath("movies"), "data/collections/movies/items");
    assert.equal(normalizedDataPath("isamu-movies"), "data/collections/isamu-movies/items");
  });

  it("replaces the authored dataPath and preserves other fields", () => {
    const schema = { title: "X", icon: "movie", dataPath: "data/movies/items", primaryKey: "id", fields: { id: {} } };
    const out = withNormalizedDataPath(schema, "movies");
    assert.equal(out.dataPath, "data/collections/movies/items");
    assert.equal(out.title, "X");
    assert.equal(out.primaryKey, "id");
    assert.deepEqual(out.fields, { id: {} });
    // input not mutated
    assert.equal(schema.dataPath, "data/movies/items");
  });
});
