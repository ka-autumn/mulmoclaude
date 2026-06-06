import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../../../server/workspace/feeds/fetch/rssParser.js";

const PODCAST = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Remarkable People</title>
    <item>
      <title>Episode 342</title>
      <link>https://example.com/ep/342</link>
      <guid isPermaLink="false">abc-123</guid>
      <pubDate>Wed, 03 Jun 2026 12:00:00 GMT</pubDate>
      <description>Great episode.</description>
      <dc:creator>Guy Kawasaki</dc:creator>
      <enclosure url="https://cdn.example.com/342.mp3" type="audio/mpeg" length="42000000"></enclosure>
      <itunes:duration>52:43</itunes:duration>
    </item>
  </channel>
</rss>`;

describe("parseFeed — raw item exposure", () => {
  it("hands back each item's raw parsed element verbatim", () => {
    const feed = parseFeed(PODCAST);
    assert.ok(feed);
    assert.equal(feed.kind, "rss");
    assert.equal(feed.title, "Remarkable People");
    assert.equal(feed.items.length, 1);
    const [{ raw }] = feed.items;
    assert.equal(raw.title, "Episode 342");
    assert.equal(raw.link, "https://example.com/ep/342");
    assert.equal(raw.pubDate, "Wed, 03 Jun 2026 12:00:00 GMT");
    assert.equal(raw["dc:creator"], "Guy Kawasaki");
    assert.equal(raw["itunes:duration"], "52:43");
  });

  it("preserves attribute (@_) and text-node shapes for the projector", () => {
    const feed = parseFeed(PODCAST);
    assert.ok(feed);
    const [{ raw }] = feed.items;
    const { enclosure, guid } = raw as { enclosure: Record<string, unknown>; guid: Record<string, unknown> };
    assert.equal(enclosure["@_url"], "https://cdn.example.com/342.mp3");
    // <guid> has an attribute, so it parses to a text node (unwrapped later).
    assert.equal(guid["#text"], "abc-123");
  });

  it("skips items with no title", () => {
    const feed = parseFeed(`<rss version="2.0"><channel><title>N</title>
      <item><link>https://x/1</link></item>
      <item><title>Keep</title></item></channel></rss>`);
    assert.ok(feed);
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].raw.title, "Keep");
  });
});
