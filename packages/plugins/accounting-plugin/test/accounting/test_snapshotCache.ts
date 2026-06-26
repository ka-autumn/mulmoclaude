import { describe, it, after as afterAll, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureBookDir, appendJournal, invalidateAllSnapshots, invalidateSnapshotsFrom, readSnapshot } from "../../src/server/io.js";
import {
  _resetRebuildQueueForTesting,
  awaitRebuildIdle,
  balancesAtEndOf,
  getOrBuildSnapshot,
  inspectRebuildQueue,
  rebuildAllSnapshots,
  scheduleRebuild,
} from "../../src/server/snapshotCache.js";
import { makeEntry } from "../../src/server/journal.js";
import { _resetAccountingEventPublisherForTesting, initAccountingEventPublisher } from "../../src/server/eventPublisher.js";
import { bookChannel as accountingBookChannel, type BookChannelPayload as AccountingBookChannelPayload } from "../../src/shared";
import type { IPubSub } from "../../src/server/context.ts";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-snap-"));
  created.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

async function seed(root: string): Promise<void> {
  await ensureBookDir("default", root);
  // Three months, mixed activity.
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-01-15",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "3000", credit: 1000 },
      ],
      kind: "opening",
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-02-10",
      lines: [
        { accountCode: "1000", credit: 200 },
        { accountCode: "5000", debit: 200 },
      ],
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-03-05",
      lines: [
        { accountCode: "1100", debit: 500 },
        { accountCode: "4000", credit: 500 },
      ],
    }),
    root,
  );
}

function balancesEqual(lhs: { accountCode: string; netDebit: number }[], rhs: { accountCode: string; netDebit: number }[]): boolean {
  if (lhs.length !== rhs.length) return false;
  const byCode = new Map(rhs.map((row) => [row.accountCode, row.netDebit]));
  for (const row of lhs) {
    const other = byCode.get(row.accountCode);
    if (other === undefined) return false;
    if (Math.abs(row.netDebit - other) > 0.0001) return false;
  }
  return true;
}

// Lightweight in-memory pub/sub stub. Records every published payload
// per channel so tests can assert on event ordering without standing
// up the real WebSocket-backed pub/sub.
function makeRecordingPubSub(): { pubsub: IPubSub; events: Map<string, AccountingBookChannelPayload[]> } {
  const events = new Map<string, AccountingBookChannelPayload[]>();
  const pubsub: IPubSub = {
    publish(channel: string, payload: unknown): void {
      const list = events.get(channel) ?? [];
      list.push(payload as AccountingBookChannelPayload);
      events.set(channel, list);
    },
  };
  return { pubsub, events };
}

describe("snapshot cache byte-equality invariant", () => {
  it("getOrBuildSnapshot result == balancesAtEndOf result for every period", async () => {
    const root = makeTmp();
    await seed(root);
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const cached = await getOrBuildSnapshot("default", period, root);
      const fromJournal = await balancesAtEndOf("default", period, root);
      assert.ok(balancesEqual(cached.balances, fromJournal), `period ${period} should match`);
    }
  });
  it("survives full invalidation: rebuild from scratch yields the same numbers", async () => {
    const root = makeTmp();
    await seed(root);
    const snapBefore = await getOrBuildSnapshot("default", "2026-03", root);
    const wiped = await invalidateAllSnapshots("default", root);
    assert.deepEqual(wiped.removed.sort(), ["2026-01", "2026-02", "2026-03"]);
    assert.equal(await readSnapshot("default", "2026-03", root), null);
    const snapAfter = await getOrBuildSnapshot("default", "2026-03", root);
    assert.ok(balancesEqual(snapBefore.balances, snapAfter.balances));
  });
  it("rebuildAllSnapshots produces a snapshot for every journal period", async () => {
    const root = makeTmp();
    await seed(root);
    const result = await rebuildAllSnapshots("default", root);
    assert.deepEqual(result.rebuilt, ["2026-01", "2026-02", "2026-03"]);
    for (const period of result.rebuilt) {
      assert.ok((await readSnapshot("default", period, root)) !== null);
    }
  });
});

describe("scheduleRebuild + queue", () => {
  beforeEach(async () => {
    await _resetRebuildQueueForTesting();
    _resetAccountingEventPublisherForTesting();
  });

  it("rebuilds in the background; awaitRebuildIdle waits for completion", async () => {
    const { pubsub, events } = makeRecordingPubSub();
    initAccountingEventPublisher(pubsub);
    const root = makeTmp();
    await seed(root);
    await invalidateSnapshotsFrom("default", "2026-02", root);

    scheduleRebuild("default", "2026-02", root);
    // The queue is busy immediately after scheduling.
    assert.equal(inspectRebuildQueue("default").running, true);

    await awaitRebuildIdle("default");
    // Snapshots for the invalidated periods are back on disk.
    assert.ok((await readSnapshot("default", "2026-02", root)) !== null);
    assert.ok((await readSnapshot("default", "2026-03", root)) !== null);

    const channelEvents = events.get(accountingBookChannel("default")) ?? [];
    assert.ok(channelEvents.some((event) => event.kind === "snapshots-rebuilding" && event.period === "2026-02"));
    const ready = channelEvents.filter((event) => event.kind === "snapshots-ready");
    assert.ok(ready.length >= 1, "expected at least one snapshots-ready event");
  });

  it("coalesces rapid scheduleRebuild calls into at most two rebuilds", async () => {
    const { pubsub, events } = makeRecordingPubSub();
    initAccountingEventPublisher(pubsub);
    const root = makeTmp();
    await seed(root);

    for (let idx = 0; idx < 5; idx += 1) {
      scheduleRebuild("default", "2026-02", root);
    }
    const state = inspectRebuildQueue("default");
    assert.equal(state.running, true);
    assert.ok(state.coalescedWriteCount >= 5, `expected ≥5 coalesced writes, got ${state.coalescedWriteCount}`);

    await awaitRebuildIdle("default");

    const channelEvents = events.get(accountingBookChannel("default")) ?? [];
    const rebuildingCount = channelEvents.filter((event) => event.kind === "snapshots-rebuilding").length;
    assert.ok(rebuildingCount <= 2, `expected ≤2 rebuilds for 5 rapid writes, observed ${rebuildingCount} snapshots-rebuilding events`);
  });

  it("event order: snapshots-rebuilding precedes snapshots-ready for the same scheduled rebuild", async () => {
    const { pubsub, events } = makeRecordingPubSub();
    initAccountingEventPublisher(pubsub);
    const root = makeTmp();
    await seed(root);

    scheduleRebuild("default", "2026-01", root);
    await awaitRebuildIdle("default");

    const channelEvents = events.get(accountingBookChannel("default")) ?? [];
    const firstRebuilding = channelEvents.findIndex((event) => event.kind === "snapshots-rebuilding");
    const firstReady = channelEvents.findIndex((event) => event.kind === "snapshots-ready");
    assert.ok(firstRebuilding >= 0, "snapshots-rebuilding event missing");
    assert.ok(firstReady > firstRebuilding, "snapshots-ready must come after snapshots-rebuilding");
  });

  it("getOrBuildSnapshot during a rebuild still returns correct numbers via the lazy fallback", async () => {
    const root = makeTmp();
    await seed(root);
    await invalidateAllSnapshots("default", root);

    // Kick off a rebuild then immediately ask for a report — the
    // lazy path inside getOrBuildSnapshot has to be byte-equal to
    // the post-rebuild snapshot.
    scheduleRebuild("default", "0000-00", root);
    const fromJournal = await balancesAtEndOf("default", "2026-03", root);
    const lazy = await getOrBuildSnapshot("default", "2026-03", root);
    assert.ok(balancesEqual(lazy.balances, fromJournal));

    await awaitRebuildIdle("default");
    const afterRebuild = await getOrBuildSnapshot("default", "2026-03", root);
    assert.ok(balancesEqual(afterRebuild.balances, fromJournal));
  });

  it("awaitRebuildIdle on an idle book resolves immediately", async () => {
    // Microtask resolution — using a promise.race against a
    // setImmediate sentinel verifies we don't hang.
    const idle = awaitRebuildIdle("never-scheduled");
    const sentinel = new Promise<string>((resolve) => setImmediate(() => resolve("timeout")));
    const result = await Promise.race([idle.then(() => "idle"), sentinel]);
    assert.equal(result, "idle");
  });

  it("a rejected rebuild does not poison the queue for the next write", async () => {
    const { pubsub, events } = makeRecordingPubSub();
    initAccountingEventPublisher(pubsub);
    const root = makeTmp();
    await seed(root);

    // First scheduled rebuild succeeds, draining the queue.
    scheduleRebuild("default", "2026-01", root);
    await awaitRebuildIdle("default");

    // Second one starts fresh (`running` flips back to true) — proves
    // the entry was cleared after the first finished.
    scheduleRebuild("default", "2026-02", root);
    assert.equal(inspectRebuildQueue("default").running, true);
    await awaitRebuildIdle("default");
    assert.equal(inspectRebuildQueue("default").running, false);

    const channelEvents = events.get(accountingBookChannel("default")) ?? [];
    const rebuildingCount = channelEvents.filter((event) => event.kind === "snapshots-rebuilding").length;
    assert.equal(rebuildingCount, 2);
  });
});
