import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listFeeds } from "../../../server/workspace/feeds/registry.js";

// Feeds are now agent-authored files (no register tool): a
// feeds/<slug>/schema.json under the workspace. listFeeds() discovers
// them (filtered to source "feed"), with icon/dataPath defaulted.
function writeFeedSchema(root: string, slug: string, schema: Record<string, unknown>): void {
  const dir = path.join(root, "feeds", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
}

describe("listFeeds — discovery of agent-authored feed files", () => {
  it("discovers a feed and defaults icon + dataPath when omitted", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-discovery-"));
    writeFeedSchema(root, "news", {
      title: "News",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true }, title: { type: "string", label: "Title" } },
      ingest: { kind: "rss", url: "https://example.com/feed.xml", schedule: "hourly", idFrom: "guid", map: { id: "guid", title: "title" } },
    });
    const feed = (await listFeeds(root)).find((entry) => entry.slug === "news");
    assert.ok(feed, "feed discovered");
    assert.equal(feed.source, "feed");
    assert.equal(feed.schema.icon, "dynamic_feed", "icon defaulted");
    assert.equal(feed.schema.dataPath, "data/feeds/news", "dataPath defaulted");
  });

  it("keeps an explicit icon / dataPath", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-discovery-"));
    writeFeedSchema(root, "wx", {
      title: "Weather",
      icon: "cloud",
      dataPath: "data/custom",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      ingest: { kind: "http-json", url: "https://example.com/x.json", schedule: "hourly", map: { id: "id" } },
    });
    const feed = (await listFeeds(root)).find((entry) => entry.slug === "wx");
    assert.ok(feed);
    assert.equal(feed.schema.icon, "cloud");
    assert.equal(feed.schema.dataPath, "data/custom");
  });

  it("skips a schema whose primaryKey field is not flagged primary", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "feeds-discovery-"));
    writeFeedSchema(root, "broken", {
      title: "Broken",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID" } }, // missing primary: true
      ingest: { kind: "rss", url: "https://example.com/feed.xml", schedule: "hourly", map: { id: "guid" } },
    });
    assert.ok(!(await listFeeds(root)).some((entry) => entry.slug === "broken"));
  });
});
