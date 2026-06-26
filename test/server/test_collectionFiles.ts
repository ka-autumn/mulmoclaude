import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { collectionFileUrl, parseJsonObject, rawBaseUrl } from "../../server/workspace/collectionsRegistry/collectionFiles.js";

describe("collectionFileUrl", () => {
  afterEach(() => {
    delete process.env.COLLECTIONS_REGISTRY_RAW_BASE;
  });

  it("composes the default raw URL", () => {
    assert.equal(
      collectionFileUrl("collections/isamu/movies", "schema.json"),
      "https://raw.githubusercontent.com/receptron/mulmoclaude-collections/main/collections/isamu/movies/schema.json",
    );
  });

  it("trims leading/trailing slashes in the dir path", () => {
    assert.equal(collectionFileUrl("/collections/a/b/", "meta.json"), `${rawBaseUrl()}/collections/a/b/meta.json`);
  });

  it("honors the COLLECTIONS_REGISTRY_RAW_BASE override", () => {
    process.env.COLLECTIONS_REGISTRY_RAW_BASE = "https://example.test/reg";
    assert.equal(collectionFileUrl("collections/a/b", "schema.json"), "https://example.test/reg/collections/a/b/schema.json");
  });
});

describe("parseJsonObject", () => {
  it("accepts a JSON object", () => {
    const result = parseJsonObject('{"a":1}', "x");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { a: 1 });
  });

  it("rejects invalid JSON", () => {
    const result = parseJsonObject("{not json", "x");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not valid JSON/);
  });

  it("rejects non-object JSON (array, number, null)", () => {
    for (const text of ["[]", "42", "null", '"str"']) {
      const result = parseJsonObject(text, "x");
      assert.equal(result.ok, false, text);
    }
  });
});
