import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerRetriever } from "../../../server/workspace/feeds/retrievers/index.js";
import { refreshOne } from "../../../server/workspace/feeds/engine.js";
import { listItems, type CollectionItem, type LoadedCollection } from "../../../server/workspace/collections/index.js";
import type { IngestSpec } from "../../../server/workspace/feeds/ingestTypes.js";

// Cast helper: tests use synthetic ingest kinds (the LoadedCollection is
// hand-built, bypassing schema validation), so widen past the real union.
function fakeIngest(kind: string): IngestSpec {
  return { kind, url: "https://example.com", schedule: "hourly", map: { id: "id" } } as unknown as IngestSpec;
}

// A registered fake retriever whose output we control per test. The kind
// is arbitrary here because we hand-build the LoadedCollection (bypassing
// schema validation), so it doesn't need to be a real ingest kind.
let nextItems: CollectionItem[] = [];
registerRetriever("test-fake", async () => ({ items: nextItems, cursor: { mark: "1" } }));

function makeFeed(root: string): LoadedCollection {
  return {
    slug: "fake-feed",
    source: "feed",
    schema: {
      title: "Fake",
      icon: "rss_feed",
      dataPath: "data/fake-feed",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      ingest: fakeIngest("test-fake"),
    },
    dataDir: path.join(root, "data", "fake-feed"),
    skillDir: path.join(root, "feeds", "fake-feed"),
  };
}

describe("refreshOne — keyed upsert", () => {
  it("writes records on first fetch and upserts by primaryKey on the next", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-engine-"));
    const feed = makeFeed(root);

    nextItems = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ];
    const first = await refreshOne(root, feed);
    assert.equal(first.errors.length, 0);
    assert.equal(first.written, 2);

    let items = await listItems(feed.dataDir, { workspaceRoot: root });
    assert.equal(items.length, 2);

    // Re-fetch: "a" changes, "b" is gone from the source, "c" is new.
    // Upsert replaces "a" in place and adds "c"; "b" is retained (feeds
    // accumulate by id — they don't delete on disappearance).
    nextItems = [
      { id: "a", title: "A2" },
      { id: "c", title: "C" },
    ];
    const second = await refreshOne(root, feed);
    assert.equal(second.written, 2);

    items = await listItems(feed.dataDir, { workspaceRoot: root });
    const byId = new Map(items.map((item) => [String(item.id), item]));
    assert.equal(items.length, 3, "a (updated), b (retained), c (new)");
    assert.equal(byId.get("a")?.title, "A2", "existing id replaced in place");
    assert.ok(byId.has("b"), "untouched id retained");
    assert.ok(byId.has("c"), "new id added");
  });

  it("isolates a retriever failure into the errors array (never throws)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-engine-"));
    const feed = makeFeed(root);
    feed.schema.ingest = fakeIngest("missing-kind");
    const result = await refreshOne(root, feed);
    assert.equal(result.written, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /no retriever/);
  });
});

function makeCappedFeed(root: string, maxItems: number): LoadedCollection {
  return {
    slug: "capped",
    source: "feed",
    schema: {
      title: "Capped",
      icon: "rss_feed",
      dataPath: "data/capped",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true }, when: { type: "date", label: "When" } },
      ingest: { ...fakeIngest("test-fake"), maxItems } as IngestSpec,
    },
    dataDir: path.join(root, "data", "capped"),
    skillDir: path.join(root, "feeds", "capped"),
  };
}

describe("refreshOne — maxItems cap", () => {
  it("keeps only the newest N records by the schema's date field", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-cap-"));
    const feed = makeCappedFeed(root, 2);
    nextItems = [
      { id: "a", when: "2026-01-01T00:00:00.000Z" },
      { id: "b", when: "2026-03-01T00:00:00.000Z" },
      { id: "c", when: "2026-02-01T00:00:00.000Z" },
    ];
    const result = await refreshOne(root, feed);
    assert.equal(result.written, 3);
    assert.equal(result.removed, 1, "oldest record pruned");

    const ids = (await listItems(feed.dataDir, { workspaceRoot: root })).map((item) => String(item.id)).sort();
    assert.deepEqual(ids, ["b", "c"], "kept the two newest (Mar, Feb); Jan pruned");
  });

  it("does not prune when under the cap", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-cap-"));
    const feed = makeCappedFeed(root, 100);
    nextItems = [{ id: "a", when: "2026-01-01T00:00:00.000Z" }];
    const result = await refreshOne(root, feed);
    assert.equal(result.removed, 0);
  });
});
