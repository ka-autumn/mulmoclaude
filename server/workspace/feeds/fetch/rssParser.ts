// RSS 2.0 + Atom 1.0 + RSS 1.0 (RDF) parser for the Feeds engine.
//
// Deliberately NON-normalizing: it locates the feed's items and hands
// each one back as its RAW parsed XML element. The host hard-codes no
// per-feed field list — `ingest.map` resolves source paths against the
// raw item (tags are keys; attributes are prefixed `@_`; namespaced tags
// keep their prefix), and the caller inspects the feed to decide what to
// map. Generic value handling (text-node unwrapping, date parsing by the
// target field's declared type) lives in `projectItem.ts`, not here.
//
// Own copy of the XML plumbing — the Feeds tree does not import the
// legacy `sources` tree. Pure; unit-testable with fixture strings.

import { XMLParser } from "fast-xml-parser";
import { isNonEmptyString, isRecord } from "../../../utils/types.js";

export interface ParsedFeedItem {
  /** The raw parsed XML <item>/<entry> object, verbatim. */
  raw: Record<string, unknown>;
}

export interface ParsedFeed {
  kind: "rss" | "atom";
  title: string | null;
  items: ParsedFeedItem[];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Only the item containers are forced to arrays (single vs. many).
  // Everything else stays in its natural parsed shape so `ingest.map`
  // resolves paths the way the caller sees them in the feed.
  isArray: (name) => name === "item" || name === "entry",
});

/** Parse an RSS/Atom/RDF feed body. Returns null when the input doesn't
 *  look like a feed we understand. */
export function parseFeed(body: string): ParsedFeed | null {
  const text = stripBom(body);
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = xml.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (isRecord(parsed.rss)) return parseRss(parsed.rss);
  if (isRecord(parsed.feed)) return parseAtom(parsed.feed);
  const rdf = parsed["rdf:RDF"] ?? parsed.RDF;
  if (isRecord(rdf)) return parseRss10(rdf);
  return null;
}

// Collect the raw item objects, skipping anything that isn't a record or
// carries no <title> (drops feed-level noise / empty entries).
function collectItems(value: unknown): ParsedFeedItem[] {
  const rawItems = Array.isArray(value) ? value : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawItems) {
    if (isRecord(raw) && readString(raw.title) !== null) items.push({ raw });
  }
  return items;
}

function parseRss(rss: Record<string, unknown>): ParsedFeed | null {
  const { channel } = rss;
  if (!isRecord(channel)) return null;
  return { kind: "rss", title: readString(channel.title), items: collectItems(channel.item) };
}

function parseRss10(rdf: Record<string, unknown>): ParsedFeed | null {
  const channel = isRecord(rdf.channel) ? rdf.channel : null;
  return { kind: "rss", title: channel ? readString(channel.title) : null, items: collectItems(rdf.item) };
}

function parseAtom(feed: Record<string, unknown>): ParsedFeed | null {
  return { kind: "atom", title: readString(feed.title), items: collectItems(feed.entry) };
}

// --- helpers ------------------------------------------------------------

// Extract a string from a plain string, a `{ "#text" }` / `{ "#cdata" }`
// node, or an array (first non-empty). Used only to read the feed/item
// title for the channel name + the empty-item filter.
function readString(value: unknown): string | null {
  if (isNonEmptyString(value)) return value;
  if (typeof value === "string") return null;
  if (isRecord(value)) return readStringFromRecord(value);
  if (Array.isArray(value)) return readStringFromArray(value);
  return null;
}

function readStringFromRecord(record: Record<string, unknown>): string | null {
  const text = record["#text"];
  if (isNonEmptyString(text)) return text;
  const cdata = record["#cdata"];
  if (isNonEmptyString(cdata)) return cdata;
  return null;
}

function readStringFromArray(array: readonly unknown[]): string | null {
  for (const entry of array) {
    const resolved = readString(entry);
    if (resolved !== null) return resolved;
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
