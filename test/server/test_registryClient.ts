import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  fetchRegistryIndex,
  resetRegistryCache,
  CACHE_TTL_MS,
  STALE_RETRY_BACKOFF_MS,
  type FetchIndexResult,
} from "../../server/workspace/collectionsRegistry/client.js";
import type { RegistryIndex } from "../../server/workspace/collectionsRegistry/registryIndex.js";

const okIndex: RegistryIndex = { schemaVersion: 1, generatedAt: "t", registry: "r", collections: [] };
const okResult: FetchIndexResult = { ok: true, index: okIndex, stale: false };
const failResult: FetchIndexResult = { ok: false, status: 503, error: "down" };

function makeLoader(results: FetchIndexResult[]) {
  let index = 0;
  let calls = 0;
  const load = (): Promise<FetchIndexResult> => {
    calls += 1;
    return Promise.resolve(results[Math.min(index++, results.length - 1)]);
  };
  return { load, calls: () => calls };
}

describe("fetchRegistryIndex caching + backoff", () => {
  beforeEach(() => resetRegistryCache());

  it("serves from cache within the TTL without re-loading", async () => {
    const loader = makeLoader([okResult]);
    const first = await fetchRegistryIndex({ nowMs: 0, loader: loader.load });
    assert.ok(first.ok && !first.stale);
    const second = await fetchRegistryIndex({ nowMs: 1000, loader: loader.load });
    assert.ok(second.ok && !second.stale);
    assert.equal(loader.calls(), 1);
  });

  it("errors when the load fails and no cache exists", async () => {
    const loader = makeLoader([failResult]);
    const result = await fetchRegistryIndex({ nowMs: 0, loader: loader.load });
    assert.equal(result.ok, false);
  });

  it("throttles network retries during an outage, serving stale in between", async () => {
    const loader = makeLoader([okResult, failResult, failResult, failResult]);
    await fetchRegistryIndex({ nowMs: 0, loader: loader.load }); // seed cache (call 1)

    const stale1 = await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 1, loader: loader.load });
    assert.ok(stale1.ok && stale1.stale, "past TTL + failing upstream → stale");
    assert.equal(loader.calls(), 2, "network attempted once on first stale serve");

    const stale2 = await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 1000, loader: loader.load });
    assert.ok(stale2.ok && stale2.stale);
    assert.equal(loader.calls(), 2, "within backoff → no network attempt");

    const stale3 = await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 1 + STALE_RETRY_BACKOFF_MS, loader: loader.load });
    assert.ok(stale3.ok && stale3.stale);
    assert.equal(loader.calls(), 3, "after backoff window → network retried");
  });

  it("clears the backoff after a successful reload", async () => {
    const loader = makeLoader([okResult, failResult, okResult]);
    await fetchRegistryIndex({ nowMs: 0, loader: loader.load }); // cache (1)
    await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 1, loader: loader.load }); // fail → stale + backoff (2)
    const recovered = await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 1 + STALE_RETRY_BACKOFF_MS, loader: loader.load }); // ok (3)
    assert.ok(recovered.ok && !recovered.stale);
    const cached = await fetchRegistryIndex({ nowMs: CACHE_TTL_MS + 2 + STALE_RETRY_BACKOFF_MS, loader: loader.load });
    assert.ok(cached.ok && !cached.stale);
    assert.equal(loader.calls(), 3, "fresh cache hit, no extra load");
  });
});
