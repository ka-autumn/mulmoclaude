import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFeed } from "../../../server/workspace/feeds/registry.js";
import { feedDir } from "../../../server/workspace/feeds/paths.js";

// A minimal valid feed schema that OMITS icon + dataPath (the host fills
// them). `fields` is the canonical object-keyed map.
function minimalSchema(): Record<string, unknown> {
  return {
    title: "Example",
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true }, title: { type: "string", label: "Title" } },
    ingest: { kind: "rss", url: "https://example.com/feed", schedule: "hourly", idFrom: "feedId", map: { id: "feedId", title: "title" } },
  };
}

describe("writeFeed", () => {
  it("defaults icon + dataPath when omitted, and persists the schema", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-registry-"));
    const result = await writeFeed(root, "example", minimalSchema());
    assert.equal(result.kind, "ok");

    const raw = await readFile(path.join(feedDir("example", root), "schema.json"), "utf-8");
    const written = JSON.parse(raw) as { icon: string; dataPath: string };
    assert.equal(written.icon, "dynamic_feed", "icon defaulted");
    assert.equal(written.dataPath, "data/feeds/example", "dataPath defaulted under data/feeds/<slug>");
  });

  it("keeps explicit icon / dataPath when provided", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-registry-"));
    const schema = { ...minimalSchema(), icon: "newspaper", dataPath: "data/custom" };
    await writeFeed(root, "example", schema);
    const written = JSON.parse(await readFile(path.join(feedDir("example", root), "schema.json"), "utf-8")) as { icon: string; dataPath: string };
    assert.equal(written.icon, "newspaper");
    assert.equal(written.dataPath, "data/custom");
  });

  it("rejects an array-shaped `fields` (the common LLM mistake) with a message", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-registry-"));
    const bad = { ...minimalSchema(), fields: [{ id: "id", label: "ID", type: "string" }] };
    const result = await writeFeed(root, "bad", bad);
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.match(result.message, /schema validation failed/);
  });

  it("accepts an http-json feed with no itemsAt (top-level array response)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-registry-"));
    const schema = {
      ...minimalSchema(),
      ingest: { kind: "http-json", url: "https://example.com/items.json", schedule: "hourly", idFrom: "id", map: { id: "id", title: "name" } },
    };
    const result = await writeFeed(root, "json-feed", schema);
    assert.equal(result.kind, "ok");
  });

  it("rejects a schema with no ingest block", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-registry-"));
    const noIngest = minimalSchema();
    delete noIngest.ingest;
    const result = await writeFeed(root, "no-ingest", noIngest);
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.match(result.message, /ingest/);
  });
});
