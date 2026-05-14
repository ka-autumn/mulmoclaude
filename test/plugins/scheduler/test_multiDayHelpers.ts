import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coversDay,
  eventColorClasses,
  eventRange,
  EVENT_PALETTE_SIZE,
  isMalformedRange,
  segmentPosition,
} from "../../../src/plugins/scheduler/multiDayHelpers.js";
import type { ScheduledItem } from "../../../src/plugins/scheduler/index.js";

function makeItem(props: ScheduledItem["props"]): ScheduledItem {
  return { id: "sched_test", title: "Test", createdAt: 0, props };
}

describe("eventRange", () => {
  it("returns null for an undated item", () => {
    assert.equal(eventRange(makeItem({})), null);
  });

  it("returns start===end for a single-day event with no endDate", () => {
    const range = eventRange(makeItem({ date: "2026-05-27" }));
    assert.deepEqual(range, { start: "2026-05-27", end: "2026-05-27" });
  });

  it("returns the explicit range when endDate is valid and after date", () => {
    const range = eventRange(makeItem({ date: "2026-05-27", endDate: "2026-05-29" }));
    assert.deepEqual(range, { start: "2026-05-27", end: "2026-05-29" });
  });

  it("collapses to a single day when endDate equals date", () => {
    const range = eventRange(makeItem({ date: "2026-05-27", endDate: "2026-05-27" }));
    assert.deepEqual(range, { start: "2026-05-27", end: "2026-05-27" });
  });

  it("treats endDate before date as a malformed range (falls back to single day)", () => {
    const range = eventRange(makeItem({ date: "2026-05-27", endDate: "2026-05-25" }));
    assert.deepEqual(range, { start: "2026-05-27", end: "2026-05-27" });
  });

  it("rejects non-ISO date strings", () => {
    assert.equal(eventRange(makeItem({ date: "May 27" })), null);
    assert.equal(eventRange(makeItem({ date: "2026/05/27" })), null);
    assert.equal(eventRange(makeItem({ date: "" })), null);
  });

  it("ignores non-string types in date / endDate", () => {
    assert.equal(eventRange(makeItem({ date: 20260527 })), null);
    const range = eventRange(makeItem({ date: "2026-05-27", endDate: 20260529 }));
    assert.deepEqual(range, { start: "2026-05-27", end: "2026-05-27" });
  });
});

describe("coversDay", () => {
  const item = makeItem({ date: "2026-05-27", endDate: "2026-05-29" });

  it("matches every day in the inclusive range", () => {
    assert.equal(coversDay(item, "2026-05-27"), true);
    assert.equal(coversDay(item, "2026-05-28"), true);
    assert.equal(coversDay(item, "2026-05-29"), true);
  });

  it("does not match the day before start or after end", () => {
    assert.equal(coversDay(item, "2026-05-26"), false);
    assert.equal(coversDay(item, "2026-05-30"), false);
  });

  it("matches a single day for an event with no endDate", () => {
    const single = makeItem({ date: "2026-05-27" });
    assert.equal(coversDay(single, "2026-05-27"), true);
    assert.equal(coversDay(single, "2026-05-28"), false);
  });

  it("never matches an undated item", () => {
    assert.equal(coversDay(makeItem({}), "2026-05-27"), false);
  });

  it("matches across a month boundary", () => {
    const crossMonth = makeItem({ date: "2026-05-30", endDate: "2026-06-02" });
    assert.equal(coversDay(crossMonth, "2026-05-31"), true);
    assert.equal(coversDay(crossMonth, "2026-06-01"), true);
    assert.equal(coversDay(crossMonth, "2026-06-02"), true);
    assert.equal(coversDay(crossMonth, "2026-06-03"), false);
  });
});

describe("segmentPosition", () => {
  const range = makeItem({ date: "2026-05-27", endDate: "2026-05-29" });

  it("returns 'start' for the first day of a range", () => {
    assert.equal(segmentPosition(range, "2026-05-27"), "start");
  });

  it("returns 'middle' for an interior day", () => {
    assert.equal(segmentPosition(range, "2026-05-28"), "middle");
  });

  it("returns 'end' for the last day of a range", () => {
    assert.equal(segmentPosition(range, "2026-05-29"), "end");
  });

  it("returns 'only' for a single-day event", () => {
    const single = makeItem({ date: "2026-05-27" });
    assert.equal(segmentPosition(single, "2026-05-27"), "only");
  });

  it("returns null for a day outside the range", () => {
    assert.equal(segmentPosition(range, "2026-05-26"), null);
    assert.equal(segmentPosition(range, "2026-05-30"), null);
  });

  it("returns null for an undated event", () => {
    assert.equal(segmentPosition(makeItem({}), "2026-05-27"), null);
  });

  it("treats a malformed range as a single-day on the start", () => {
    const malformed = makeItem({ date: "2026-05-27", endDate: "2026-05-25" });
    assert.equal(segmentPosition(malformed, "2026-05-27"), "only");
    assert.equal(segmentPosition(malformed, "2026-05-26"), null);
  });
});

describe("isMalformedRange", () => {
  it("returns false for a single-day event (no endDate)", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27" })), false);
  });

  it("returns false for a well-formed multi-day range", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: "2026-05-29" })), false);
  });

  it("returns false for an equal-day endDate", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: "2026-05-27" })), false);
  });

  it("returns true when endDate is before date", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: "2026-05-25" })), true);
  });

  it("returns true when endDate is a non-ISO string", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: "next Friday" })), true);
  });

  it("returns true when start date is missing but endDate is present", () => {
    assert.equal(isMalformedRange(makeItem({ endDate: "2026-05-29" })), true);
  });

  it("returns false for non-string endDate (sanitizeProps would have dropped it)", () => {
    // Defence in depth: storage shouldn't contain non-string
    // endDate, but if it leaks through, treat as 'not present'
    // rather than 'broken' — there's nothing to render.
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: 20260525 })), false);
  });

  it("returns false for empty-string endDate", () => {
    assert.equal(isMalformedRange(makeItem({ date: "2026-05-27", endDate: "" })), false);
  });
});

describe("eventColorClasses", () => {
  it("returns the same class string for the same id (stable hash)", () => {
    const first = eventColorClasses("sched_123_abc");
    const second = eventColorClasses("sched_123_abc");
    assert.equal(first, second);
  });

  it("each result is a non-empty bg-/text-/hover: triplet", () => {
    const cls = eventColorClasses("sched_xyz");
    assert.match(cls, /bg-\w+-100/);
    assert.match(cls, /text-\w+-900/);
    assert.match(cls, /hover:bg-\w+-200/);
  });

  it("covers every palette slot across a range of ids", () => {
    // Sample 200 random-ish ids; with 8 slots and a stable hash,
    // every slot should be hit by ~25 ids — `Set.size === palette
    // size` is a low-noise way to verify the distribution isn't
    // collapsed onto one bucket.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(eventColorClasses(`sched_${i}_${(i * 31).toString(16)}`));
    }
    assert.equal(seen.size, EVENT_PALETTE_SIZE);
  });

  it("returns a value even for an empty id (defensive fallback)", () => {
    const cls = eventColorClasses("");
    assert.match(cls, /bg-\w+-100/);
  });

  it("does not crash on non-string id (pre-sanitize legacy data)", () => {
    const numeric = eventColorClasses(123 as unknown as string);
    assert.match(numeric, /bg-\w+-100/);
    const nullish = eventColorClasses(null as unknown as string);
    assert.match(nullish, /bg-\w+-100/);
    const undef = eventColorClasses(undefined as unknown as string);
    assert.match(undef, /bg-\w+-100/);
  });
});
