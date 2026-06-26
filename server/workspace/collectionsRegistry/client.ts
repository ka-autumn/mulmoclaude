// Server-side client for the curated collection registry's published index.json
// (receptron/mulmoclaude-collections via GitHub Pages). Fetches over HTTPS with
// a timeout, validates against the index contract, and memo-caches the last good
// result so the Discover tab doesn't hammer the upstream. On a transient upstream
// failure it serves the last good index rather than erroring.

import { fetchWithTimeout } from "../../utils/fetch.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { parseRegistryIndex, type RegistryIndex } from "./registryIndex.js";

const DEFAULT_REGISTRY_URL = "https://receptron.github.io/mulmoclaude-collections/index.json";
export const CACHE_TTL_MS = 5 * 60 * ONE_SECOND_MS;
// During an outage (cache past TTL + failing upstream) don't re-hit the network
// more than once per this window — serve stale immediately in between, so a down
// upstream can't add its full timeout to every request.
export const STALE_RETRY_BACKOFF_MS = 60 * ONE_SECOND_MS;
const FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;
const STATUS_BAD_GATEWAY = 502;
const STATUS_UNAVAILABLE = 503;

export type FetchIndexResult = { ok: true; index: RegistryIndex; stale: boolean } | { ok: false; status: number; error: string };

interface CacheEntry {
  index: RegistryIndex;
  atMs: number;
}

let cache: CacheEntry | null = null;
let lastFailureMs: number | null = null;

export function registryIndexUrl(): string {
  return process.env.COLLECTIONS_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
}

async function loadFromNetwork(): Promise<FetchIndexResult> {
  const url = registryIndexUrl();
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: "application/json" } });
  } catch (err) {
    log.warn("collections-registry", "index fetch failed", { url, error: errorMessage(err) });
    return { ok: false, status: STATUS_UNAVAILABLE, error: "registry unreachable" };
  }
  if (!res.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry responded ${res.status}` };
  const json: unknown = await res.json().catch(() => null);
  const parsed = parseRegistryIndex(json);
  if (!parsed.ok) {
    log.warn("collections-registry", "index invalid", { url, error: parsed.error });
    return { ok: false, status: STATUS_BAD_GATEWAY, error: `registry index invalid: ${parsed.error}` };
  }
  return { ok: true, index: parsed.index, stale: false };
}

export type IndexLoader = () => Promise<FetchIndexResult>;

/** Fetch the registry index, served from cache within the TTL. On upstream
 *  failure, falls back to the last good index (marked `stale`). After a failure
 *  the network is not retried for `STALE_RETRY_BACKOFF_MS` while a stale cache can
 *  be served, so a down upstream can't add its timeout to every request. `loader`
 *  is injectable for tests; `force` bypasses both the TTL and the backoff. */
export async function fetchRegistryIndex(opts: { force?: boolean; nowMs?: number; loader?: IndexLoader } = {}): Promise<FetchIndexResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const loader = opts.loader ?? loadFromNetwork;
  if (!opts.force && cache && nowMs - cache.atMs < CACHE_TTL_MS) {
    return { ok: true, index: cache.index, stale: false };
  }
  if (!opts.force && cache && lastFailureMs !== null && nowMs - lastFailureMs < STALE_RETRY_BACKOFF_MS) {
    return { ok: true, index: cache.index, stale: true };
  }
  const fresh = await loader();
  if (fresh.ok) {
    cache = { index: fresh.index, atMs: nowMs };
    lastFailureMs = null;
    return { ok: true, index: fresh.index, stale: false };
  }
  lastFailureMs = nowMs;
  if (cache) return { ok: true, index: cache.index, stale: true };
  return fresh;
}

/** Test seam: reset the module cache + failure backoff state. */
export function resetRegistryCache(): void {
  cache = null;
  lastFailureMs = null;
}
