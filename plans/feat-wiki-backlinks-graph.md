# Plan: Wiki backlinks + graph view

Status: design / discussion. **Document-only**, no code changes yet.

## Why

Obsidian's signature features are the **backlinks panel** ("linked references" — what
links to this page) and the **graph view** (force-directed map of the `[[link]]`
network). MulmoClaude's wiki already stores `[[wiki-link]]` edges and frontmatter, but
the `/wiki` UI surfaces none of the link *structure* — only a flat catalog, tag filter,
log, and lint.

This is high-leverage *because of* MulmoClaude's bet, not despite it. Obsidian users
link by hand and link sparsely; here **Claude maintains the links** and links densely
during ingest. Backlinks/graph make that auto-built connective tissue *visible* — which
a hand-curated vault never achieves. So this reinforces the differentiator rather than
chasing feature parity.

## Why MulmoClaude (feasibility)

The substrate already exists — no new dependency, no data-model change:

| Primitive | Location | Gives us |
|---|---|---|
| `WIKI_LINK_PATTERN`, `parseWikiLink` | `src/lib/wiki-page/link.ts` | extract a page's raw `[[links]]` (pure, browser-safe) |
| `wikiSlugify` | `src/lib/wiki-page/slug.ts` | resolve a link target → slug |
| `findBrokenLinksInPage` | `src/lib/wiki-page/lint.ts:46` | already walks every link in a page and resolves it |
| `getPageIndex(dir)` | `server/api/routes/wiki/pageIndex.ts` | slug→filename map, mtime-cached |
| `collectLintIssues` | `server/api/routes/wiki.ts:283` | already enumerates all pages, reads them in parallel, walks links — **this IS the graph traversal** |
| `echarts@6` | `package.json` (chart plugin uses it) | built-in `graph` series w/ force layout — **no d3/cytoscape needed** |
| Tab strips | `src/plugins/wiki/View.vue` | top-level Index/Log/Lint tabs + per-page Content/History tabs = mount points |

The graph adjacency is a near-trivial refactor of `collectLintIssues`: reuse its
page-read loop, but per page emit resolved outgoing edges instead of broken-link
strings. Backlinks = the same edge list inverted.

## ⚠ Naming collision

`server/workspace/wiki-backlinks/` already exists but is **session backlinks** (#109:
links a page back to the chat session that edited it) — a different feature. The new
page→page concept MUST be named distinctly to avoid confusion. Proposed: **"linked
references"** (incoming) / **"links"** (outgoing). Do NOT call the new module
`wiki-backlinks`.

## Architecture

### Shared graph endpoint (both features consume this)

Add a `graph` action to the wiki route (or `GET /api/wiki/graph`) returning a resolved,
deduplicated link graph:

```ts
interface WikiGraph {
  nodes: { slug: string; title: string }[];
  edges: { from: string; to: string }[]; // from/to are existing slugs only
}
```

- Factor the per-page link resolution out of `findBrokenLinksInPage` so lint and graph
  share one "outgoing resolved slugs for this page" helper (keep both in
  `src/lib/wiki-page/`, pure).
- Resolve targets with the SAME logic the resolver/lint share (`wikiSlugify` + the
  index title-match fallback in `resolvePagePath`) so non-ASCII `[[日本語]]` edges don't
  dangle.
- Drop edges whose target isn't an existing page (those are already a lint "broken
  link" — not a graph edge).

### Backlinks panel (per-page)

- On the per-page view, a **"Linked references"** section: pages whose edges point at
  the current slug = `edges.filter(e => e.to === slug)`.
- Reuse `WikiPageBody`'s existing `wiki-link-click` → `navigatePage` for navigation.
- Pure client-side filter over the endpoint payload; no extra server work.

### Graph view (top-level tab)

- New top-level tab **"Graph"** beside Index/Log/Lint in `View.vue`.
- Render `{nodes, edges}` via an echarts `graph` series (force layout, click node →
  `navigatePage`). echarts is already bundled.
- Wiki scale (tens–low hundreds of pages) is trivial for echarts force layout.

## Phases

1. **Graph endpoint** — extract the shared `pageOutgoingSlugs` helper from lint; add the
   `graph` action returning `{nodes, edges}`; unit-test the pure helper (incl. non-ASCII
   + `[[target|display]]` + dangling-target drop). No UI yet.
2. **Backlinks panel** — "Linked references" section on the per-page view, consuming the
   endpoint. Higher value, ship first.
3. **Graph tab** — echarts `graph` component as a new top-level tab on the same endpoint.

## Cross-cutting obligations (repo rules)

- **i18n**: each new tab/heading needs a `pluginWiki.*` key across **all 8 locales**
  (`src/lang/*.ts`) in the same PR — `tabGraph`, the "Linked references" heading, empty
  states. Product names stay English.
- **testids + cheatsheet**: new surfaces need `data-testid`s and a matching block in
  `docs/ui-cheatsheet.md` (the `(:wiki)` section).
- **E2E**: a Playwright test under `e2e/` (mock APIs) for the backlinks panel and graph
  tab rendering from a fixture graph.

## Risks / open questions

- **Non-ASCII slug identity** — empty-slug pages fall back to title-match
  (`resolvePagePath`). Node keys and edge endpoints must use one canonical id or edges
  dangle. Mitigation: route graph resolution through the shared resolver.
- **Orphan nodes** — pages with no in/out links: show as isolated dots, or hide behind a
  toggle? (Lean: show; their isolation is itself information.)
- **Outgoing vs incoming in the panel** — start with incoming only ("linked
  references", the Obsidian default), or show both? (Lean: incoming first.)
- **Endpoint shape** — reuse the existing POST `action` switch vs. a dedicated GET route.
  (Lean: `action: "graph"` on the existing route for consistency with index/log/lint.)

## Out of scope

- Editing links from the graph (Obsidian doesn't either).
- Tag-based graph coloring / clustering (possible follow-up).
- Touching the session-backlink appendix (`#109`) — unrelated.
