// RSS / Atom retriever. Fetches the feed, parses it, and projects each
// item's RAW parsed XML element through `ingest.map`. The map's source
// paths are the item's own tags/attributes (e.g. `title`, `pubDate`,
// `enclosure.@_url`, `itunes:duration`) — the host hard-codes no field
// list; the caller inspects the feed and maps what it carries.

import { fetchText } from "../fetch/httpClient.js";
import { parseFeed } from "../fetch/rssParser.js";
import { projectRecord } from "../projectItem.js";
import { registerRetriever, type RetrieveFn } from "./index.js";

const retrieveRss: RetrieveFn = async (ingest, schema) => {
  const body = await fetchText(ingest.url);
  const feed = parseFeed(body);
  if (!feed) return { items: [], cursor: {} };
  const items = feed.items.map((item) => projectRecord(item.raw, ingest, schema));
  return { items, cursor: {} };
};

// Atom shares the same parser + projection path.
registerRetriever("rss", retrieveRss);
registerRetriever("atom", retrieveRss);

export { retrieveRss };
