// List the registered data-source feeds. Feeds are CREATED / REMOVED by
// the agent writing / deleting `feeds/<slug>/schema.json` directly (see
// config/helps/feeds.md) — the host only discovers + retrieves them.
// icon / dataPath defaults for agent-authored feed schemas are applied in
// `collections/discovery.ts` (source === "feed").

import { rm } from "node:fs/promises";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { discoverCollections, type LoadedCollection } from "../collections/index.js";
import { safeSlugName } from "../collections/paths.js";
import { feedDir } from "./paths.js";

/** Every registered feed, as a discovered collection (carrying its
 *  validated schema, `ingest`, and resolved `dataDir`). */
export async function listFeeds(workspaceRoot: string = workspacePath): Promise<LoadedCollection[]> {
  const all = await discoverCollections({ workspaceRoot });
  return all.filter((collection) => collection.source === "feed");
}

/** Delete a feed's `feeds/<slug>/` directory (schema + state). Records
 *  under the schema's `dataPath` are intentionally retained. Idempotent.
 *  Host-side only (backs the UI delete button); the agent removes a feed
 *  by deleting the directory with its own file tools. */
export async function removeFeed(workspaceRoot: string, slug: string): Promise<boolean> {
  const safe = safeSlugName(slug);
  if (safe === null) return false;
  try {
    await rm(feedDir(safe, workspaceRoot), { recursive: true, force: true });
    log.info("feeds", "feed removed (records retained)", { slug: safe });
    return true;
  } catch (error) {
    log.warn("feeds", "feed remove failed", { slug: safe, error: String(error) });
    return false;
  }
}
