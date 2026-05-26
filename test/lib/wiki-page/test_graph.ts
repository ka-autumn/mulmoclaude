// Unit tests for the wiki page→page graph builder.
//
// Covers the edge cases the endpoint + backlinks UI depend on:
//   - resolved edges from `[[slug]]` links
//   - `[[target|display]]` aliased links resolve on the target
//   - non-ASCII `[[Japanese Title]]` links resolve via the index
//     title → slug fallback (same strategy as the route resolver)
//   - dangling targets (no such page) are dropped, not emitted
//   - self-links are dropped
//   - duplicate (from,to) edges are collapsed
//   - node titles come from index.md, falling back to the slug
//   - incomingLinks inverts the edge set

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWikiGraph, incomingLinks } from "../../../src/lib/wiki-page/graph.js";
import type { WikiPageEntry } from "../../../src/lib/wiki-page/index-parse.js";

function entry(slug: string, title: string): WikiPageEntry {
  return { slug, title, description: "", tags: [] };
}

describe("buildWikiGraph", () => {
  it("emits a resolved edge for a plain [[slug]] link", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "See [[beta]] for more." },
        { slug: "beta", content: "Nothing here." },
      ],
      [entry("alpha", "Alpha"), entry("beta", "Beta")],
    );
    assert.deepEqual(graph.edges, [{ from: "alpha", to: "beta" }]);
    assert.deepEqual(
      graph.nodes.map((node) => node.title),
      ["Alpha", "Beta"],
    );
  });

  it("resolves [[target|display]] on the target half", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "[[beta|the second letter]]" },
        { slug: "beta", content: "" },
      ],
      [entry("alpha", "Alpha"), entry("beta", "Beta")],
    );
    assert.deepEqual(graph.edges, [{ from: "alpha", to: "beta" }]);
  });

  it("resolves a non-ASCII [[Title]] link via the index title→slug map", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "見て [[さくらインターネット]]" },
        { slug: "sakura-internet", content: "" },
      ],
      [entry("alpha", "Alpha"), entry("sakura-internet", "さくらインターネット")],
    );
    assert.deepEqual(graph.edges, [{ from: "alpha", to: "sakura-internet" }]);
  });

  it("drops links to non-existent pages", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "[[ghost]] [[beta]]" },
        { slug: "beta", content: "" },
      ],
      [entry("alpha", "Alpha"), entry("beta", "Beta")],
    );
    assert.deepEqual(graph.edges, [{ from: "alpha", to: "beta" }]);
  });

  it("drops self-links", () => {
    const graph = buildWikiGraph([{ slug: "alpha", content: "[[alpha]] is me" }], [entry("alpha", "Alpha")]);
    assert.deepEqual(graph.edges, []);
  });

  it("collapses duplicate (from,to) edges", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "[[beta]] and again [[beta]]" },
        { slug: "beta", content: "" },
      ],
      [entry("alpha", "Alpha"), entry("beta", "Beta")],
    );
    assert.deepEqual(graph.edges, [{ from: "alpha", to: "beta" }]);
  });

  it("falls back to the slug for un-indexed page titles", () => {
    const graph = buildWikiGraph([{ slug: "orphan", content: "" }], []);
    assert.deepEqual(graph.nodes, [{ slug: "orphan", title: "orphan" }]);
  });
});

describe("incomingLinks", () => {
  it("returns the pages linking to a slug, deduped, as nodes", () => {
    const graph = buildWikiGraph(
      [
        { slug: "alpha", content: "[[gamma]]" },
        { slug: "beta", content: "[[gamma]] [[gamma]]" },
        { slug: "gamma", content: "" },
      ],
      [entry("alpha", "Alpha"), entry("beta", "Beta"), entry("gamma", "Gamma")],
    );
    assert.deepEqual(incomingLinks(graph, "gamma"), [
      { slug: "alpha", title: "Alpha" },
      { slug: "beta", title: "Beta" },
    ]);
  });

  it("returns an empty list when nothing links to the slug", () => {
    const graph = buildWikiGraph([{ slug: "alpha", content: "" }], [entry("alpha", "Alpha")]);
    assert.deepEqual(incomingLinks(graph, "alpha"), []);
  });
});
