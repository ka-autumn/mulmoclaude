// Retrieval engine: fetch a feed, upsert its records into the
// collection's data dir (keyed by primaryKey, so re-fetches replace in
// place / accumulate by id), and persist per-feed state. Per-feed
// failures are isolated — `refreshOne` never throws; `refreshDue`
// processes feeds sequentially to stay gentle on remote hosts (the
// fetch client does no rate-limiting yet).

import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { deleteItem, listItems, writeItem, type CollectionItem, type CollectionSchema, type LoadedCollection } from "../collections/index.js";
import { ONE_HOUR_MS, ONE_DAY_MS } from "../../utils/time.js";
import { getRetriever } from "./retrievers/index.js";
import "./retrievers/registerAll.js";
import { listFeeds } from "./registry.js";
import { readFeedState, writeFeedState, type FeedState } from "./state.js";
import { DEFAULT_FEED_MAX_ITEMS, type FeedSchedule, type IngestSpec } from "./ingestTypes.js";

/** Feed schemas carry the rich `IngestSpec` (validated at discovery —
 *  `source === "feed"` requires `ingest`), but the canonical
 *  `CollectionSchema.ingest` only promises the minimal `CollectionIngest`.
 *  Narrow here so the engine can read the retrieval fields type-safely. */
function feedIngest(schema: CollectionSchema): IngestSpec | undefined {
  return schema.ingest as IngestSpec | undefined;
}

export interface RefreshResult {
  slug: string;
  written: number;
  /** Old records deleted by the maxItems cap this run. */
  removed: number;
  errors: string[];
}

async function upsertItems(workspaceRoot: string, feed: LoadedCollection, items: CollectionItem[]): Promise<number> {
  let written = 0;
  for (const item of items) {
    const itemId = item[feed.schema.primaryKey];
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    const result = await writeItem(feed.dataDir, itemId, item, { refuseOverwrite: false, workspaceRoot });
    if (result.kind === "ok") written += 1;
    else log.warn("feeds", "feed item write skipped", { slug: feed.slug, itemId, kind: result.kind });
  }
  return written;
}

/** The schema's first `date` field, used to order records for the
 *  maxItems cap. Null when the schema declares none. */
function firstDateField(schema: CollectionSchema): string | null {
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (spec.type === "date") return key;
  }
  return null;
}

// Epoch ms for a record's date value; missing / unparseable sorts oldest.
function recordTime(item: CollectionItem, field: string): number {
  const value = item[field];
  const millis = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? millis : Number.NEGATIVE_INFINITY;
}

/** Enforce `ingest.maxItems` (default 100): keep the newest N records by
 *  the schema's date field, delete the rest. No-op when the cap is 0/absent
 *  of a date field, or when under the cap. Returns the number deleted. */
async function pruneFeed(workspaceRoot: string, feed: LoadedCollection): Promise<number> {
  const cap = feedIngest(feed.schema)?.maxItems ?? DEFAULT_FEED_MAX_ITEMS;
  if (cap <= 0) return 0;
  const dateField = firstDateField(feed.schema);
  if (!dateField) {
    log.warn("feeds", "maxItems prune skipped: schema has no date field to order by", { slug: feed.slug });
    return 0;
  }
  const items = await listItems(feed.dataDir, { workspaceRoot });
  if (items.length <= cap) return 0;
  const stale = [...items].sort((left, right) => recordTime(right, dateField) - recordTime(left, dateField)).slice(cap);
  let removed = 0;
  for (const item of stale) {
    const itemId = item[feed.schema.primaryKey];
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    if ((await deleteItem(feed.dataDir, itemId, { workspaceRoot })).kind === "ok") removed += 1;
  }
  if (removed > 0) log.info("feeds", "pruned old feed records", { slug: feed.slug, removed, cap });
  return removed;
}

/** Fetch one feed now, upsert its records, then enforce the maxItems cap.
 *  Failure-isolated: returns an errors array rather than throwing. */
export async function refreshOne(workspaceRoot: string, feed: LoadedCollection): Promise<RefreshResult> {
  const { slug } = feed;
  const ingest = feedIngest(feed.schema);
  if (!ingest) return { slug, written: 0, removed: 0, errors: ["collection has no ingest config"] };
  const retriever = getRetriever(ingest.kind);
  if (!retriever) return { slug, written: 0, removed: 0, errors: [`no retriever registered for kind '${ingest.kind}'`] };
  const state = await readFeedState(workspaceRoot, slug);
  try {
    const result = await retriever(ingest, feed.schema, state);
    const written = await upsertItems(workspaceRoot, feed, result.items);
    await writeFeedState(workspaceRoot, slug, { ...state, lastFetchedAt: new Date().toISOString(), cursor: result.cursor, consecutiveFailures: 0 });
    const removed = await pruneFeed(workspaceRoot, feed);
    log.info("feeds", "feed refreshed", { slug, written, removed, fetched: result.items.length });
    return { slug, written, removed, errors: [] };
  } catch (error) {
    await writeFeedState(workspaceRoot, slug, { ...state, consecutiveFailures: state.consecutiveFailures + 1 });
    const message = String(error);
    log.warn("feeds", "feed refresh failed", { slug, error: message });
    return { slug, written: 0, removed: 0, errors: [message] };
  }
}

function dueIntervalMs(schedule: FeedSchedule): number {
  switch (schedule) {
    case "daily":
      return ONE_DAY_MS;
    case "weekly":
      return 7 * ONE_DAY_MS;
    default:
      return ONE_HOUR_MS;
  }
}

/** True iff a feed is due to refresh given its schedule + last fetch.
 *  `on-demand` feeds are never auto-due. */
function isFeedDue(feed: LoadedCollection, state: FeedState): boolean {
  const schedule = feedIngest(feed.schema)?.schedule;
  if (!schedule || schedule === "on-demand") return false;
  if (!state.lastFetchedAt) return true;
  const elapsed = Date.now() - Date.parse(state.lastFetchedAt);
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= dueIntervalMs(schedule);
}

/** Refresh every feed whose schedule says it's due. Called by the
 *  hourly system task. Sequential + failure-isolated. */
export async function refreshDue(workspaceRoot: string = workspacePath): Promise<RefreshResult[]> {
  const feeds = await listFeeds(workspaceRoot);
  const results: RefreshResult[] = [];
  for (const feed of feeds) {
    const state = await readFeedState(workspaceRoot, feed.slug);
    if (!isFeedDue(feed, state)) continue;
    results.push(await refreshOne(workspaceRoot, feed));
  }
  return results;
}
