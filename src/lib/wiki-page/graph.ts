// Pure builder for the wiki page→page link graph. Used by:
//   - server/api/routes/wiki.ts — the `graph` action endpoint
//   - src/plugins/wiki/View.vue — backlinks ("linked references") +
//     the Graph tab
//
// All functions are pure string / collection ops; no `node:*` imports,
// so the frontend bundle can import them directly (same discipline as
// the sibling `link.ts` / `lint.ts` / `index-parse.ts` modules).
//
// NOTE: this is page→page link structure, distinct from the
// `server/workspace/wiki-backlinks/` module, which appends *session*
// backlinks (a page → the chat that edited it, #109). Different concept
// — do not conflate.

import { WIKI_LINK_PATTERN, parseWikiLink } from "./link.js";
import { wikiSlugify } from "./slug.js";
import type { WikiPageEntry } from "./index-parse.js";

export interface WikiGraphNode {
  slug: string;
  title: string;
}

export interface WikiGraphEdge {
  from: string;
  to: string;
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
}

/** One page's raw body plus its canonical (file-derived) slug. */
export interface WikiPageContent {
  slug: string;
  content: string;
}

/** Resolve a raw `[[link]]` target to an existing page slug, or null.
 *  Mirrors the route resolver's strategy: slugify first, then fall
 *  back to matching an index entry title so non-ASCII targets like
 *  `[[さくらインターネット]]` resolve to their ASCII file slug. */
export function resolveLinkTarget(target: string, fileSlugs: ReadonlySet<string>, slugByTitle: ReadonlyMap<string, string>): string | null {
  const slug = wikiSlugify(target);
  if (slug.length > 0 && fileSlugs.has(slug)) return slug;
  const byTitle = slugByTitle.get(target.trim());
  if (byTitle !== undefined && fileSlugs.has(byTitle)) return byTitle;
  return null;
}

/** Resolved, deduped outgoing slugs for one page body. Self-links and
 *  links to non-existent pages are dropped (the latter are already a
 *  lint "broken link", not a graph edge). */
export function pageOutgoingSlugs(fromSlug: string, content: string, fileSlugs: ReadonlySet<string>, slugByTitle: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const match of content.matchAll(WIKI_LINK_PATTERN)) {
    const { target } = parseWikiLink(match[1]);
    const resolved = resolveLinkTarget(target, fileSlugs, slugByTitle);
    if (resolved !== null && resolved !== fromSlug) out.add(resolved);
  }
  return [...out];
}

function buildTitleMaps(entries: readonly WikiPageEntry[]): { titleBySlug: Map<string, string>; slugByTitle: Map<string, string> } {
  const titleBySlug = new Map<string, string>();
  const slugByTitle = new Map<string, string>();
  for (const entry of entries) {
    if (!titleBySlug.has(entry.slug)) titleBySlug.set(entry.slug, entry.title);
    if (entry.title.length > 0 && !slugByTitle.has(entry.title)) slugByTitle.set(entry.title, entry.slug);
  }
  return { titleBySlug, slugByTitle };
}

/** Build the full page→page graph. Nodes are the existing page files
 *  (titled from index.md, falling back to the slug for un-indexed
 *  pages); edges are the resolved `[[links]]`, deduped per (from,to). */
export function buildWikiGraph(pages: readonly WikiPageContent[], entries: readonly WikiPageEntry[]): WikiGraph {
  const fileSlugs = new Set(pages.map((page) => page.slug));
  const { titleBySlug, slugByTitle } = buildTitleMaps(entries);
  const nodes: WikiGraphNode[] = pages.map((page) => ({ slug: page.slug, title: titleBySlug.get(page.slug) ?? page.slug }));
  const edges: WikiGraphEdge[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const toSlug of pageOutgoingSlugs(page.slug, page.content, fileSlugs, slugByTitle)) {
      // Newline cannot appear in a wiki slug, so it is a safe pair key.
      const key = [page.slug, toSlug].join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: page.slug, to: toSlug });
    }
  }
  return { nodes, edges };
}

/** Pages that link TO `slug` (incoming edges), deduped, as nodes. */
export function incomingLinks(graph: WikiGraph, slug: string): WikiGraphNode[] {
  const nodeBySlug = new Map(graph.nodes.map((node) => [node.slug, node]));
  const result: WikiGraphNode[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.to !== slug || seen.has(edge.from)) continue;
    seen.add(edge.from);
    const node = nodeBySlug.get(edge.from);
    if (node) result.push(node);
  }
  return result;
}
