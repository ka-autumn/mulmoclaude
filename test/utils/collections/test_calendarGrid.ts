// Unit tests for the pure calendar-grid helpers
// (src/utils/collections/calendarGrid.ts). The month-grid construction
// and record→day bucketing are pure so their edge cases (leap Feb, month
// boundaries, multi-day spans, invalid/inverted dates) are pinned here,
// independently from the Vue rendering layer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseIsoDate,
  parseIsoDateTime,
  dateOf,
  parseTimeRange,
  ymdKey,
  compareYmd,
  buildMonthGrid,
  recordSpan,
  spanCoversDay,
  bucketRecords,
  daySlice,
  assignLanes,
  MINUTES_PER_DAY,
} from "../../../src/utils/collections/calendarGrid.js";

describe("parseIsoDate", () => {
  it("parses a valid YYYY-MM-DD", () => {
    assert.deepEqual(parseIsoDate("2026-06-02"), { year: 2026, month: 6, day: 2 });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(parseIsoDate("  2026-06-02 "), { year: 2026, month: 6, day: 2 });
  });

  it("rejects impossible calendar days", () => {
    assert.equal(parseIsoDate("2026-02-30"), null);
    assert.equal(parseIsoDate("2026-13-01"), null);
    assert.equal(parseIsoDate("2026-00-10"), null);
    assert.equal(parseIsoDate("2026-06-31"), null);
  });

  it("accepts a real leap day and rejects a non-leap one", () => {
    assert.deepEqual(parseIsoDate("2024-02-29"), { year: 2024, month: 2, day: 29 });
    assert.equal(parseIsoDate("2026-02-29"), null);
  });

  it("rejects non-strings and malformed shapes", () => {
    assert.equal(parseIsoDate(undefined), null);
    assert.equal(parseIsoDate(null), null);
    assert.equal(parseIsoDate(20260602), null);
    assert.equal(parseIsoDate("2026/06/02"), null);
    assert.equal(parseIsoDate("2026-6-2"), null);
    assert.equal(parseIsoDate(""), null);
  });
});

describe("parseIsoDateTime", () => {
  it("parses date + clock into ymd and minutes-of-day", () => {
    assert.deepEqual(parseIsoDateTime("2026-06-02T09:30"), { ymd: { year: 2026, month: 6, day: 2 }, minutes: 9 * 60 + 30 });
  });

  it("tolerates an appended :SS", () => {
    assert.deepEqual(parseIsoDateTime("2026-06-02T09:30:00"), { ymd: { year: 2026, month: 6, day: 2 }, minutes: 570 });
  });

  it("rejects a bad clock or bad date", () => {
    assert.equal(parseIsoDateTime("2026-06-02T24:00"), null);
    assert.equal(parseIsoDateTime("2026-06-02T09:60"), null);
    assert.equal(parseIsoDateTime("2026-02-30T09:00"), null);
    assert.equal(parseIsoDateTime("2026-06-02"), null);
  });
});

describe("dateOf", () => {
  it("reads the civil date from both date-only and datetime values", () => {
    assert.deepEqual(dateOf("2026-06-02"), { year: 2026, month: 6, day: 2 });
    assert.deepEqual(dateOf("2026-06-02T18:45"), { year: 2026, month: 6, day: 2 });
    assert.equal(dateOf("nope"), null);
  });
});

describe("parseTimeRange", () => {
  it("parses a start-end range into a block", () => {
    assert.deepEqual(parseTimeRange("14:00-17:00"), { startMin: 840, endMin: 1020 });
  });

  it("treats an open end as a point in time (start only)", () => {
    assert.deepEqual(parseTimeRange("17:00-"), { startMin: 1020, endMin: null });
  });

  it("treats a bare clock as a point in time", () => {
    assert.deepEqual(parseTimeRange("16:30"), { startMin: 990, endMin: null });
  });

  it("tolerates wave-dash and en-dash separators", () => {
    assert.deepEqual(parseTimeRange("9:00〜10:30"), { startMin: 540, endMin: 630 });
    assert.deepEqual(parseTimeRange("9:00–10:30"), { startMin: 540, endMin: 630 });
  });

  it("returns null for clock-less or empty values", () => {
    assert.equal(parseTimeRange("終日"), null);
    assert.equal(parseTimeRange(""), null);
    assert.equal(parseTimeRange(undefined), null);
  });
});

describe("ymdKey / compareYmd", () => {
  it("zero-pads the key", () => {
    assert.equal(ymdKey({ year: 2026, month: 6, day: 2 }), "2026-06-02");
    assert.equal(ymdKey({ year: 26, month: 12, day: 31 }), "0026-12-31");
  });

  it("orders dates chronologically", () => {
    assert.ok(compareYmd({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 }) < 0);
    assert.equal(compareYmd({ year: 2026, month: 5, day: 9 }, { year: 2026, month: 5, day: 9 }), 0);
    assert.ok(compareYmd({ year: 2027, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }) > 0);
  });
});

describe("buildMonthGrid", () => {
  it("always returns 42 cells", () => {
    assert.equal(buildMonthGrid(2026, 6).length, 42);
    assert.equal(buildMonthGrid(2026, 2).length, 42);
  });

  it("marks the current-month days and greys the rest", () => {
    // June 2026: the 1st is a Monday. Sunday-start grid → one leading day
    // (May 31), then June 1-30, then trailing July days.
    const grid = buildMonthGrid(2026, 6, 0);
    assert.equal(grid[0].key, "2026-05-31");
    assert.equal(grid[0].inMonth, false);
    assert.equal(grid[1].key, "2026-06-01");
    assert.equal(grid[1].inMonth, true);
    const inMonth = grid.filter((cell) => cell.inMonth);
    assert.equal(inMonth.length, 30);
    assert.equal(inMonth[0].key, "2026-06-01");
    assert.equal(inMonth[29].key, "2026-06-30");
  });

  it("honours a Monday week start", () => {
    // June 1 2026 is a Monday → no leading days with weekStartsOn=1.
    const grid = buildMonthGrid(2026, 6, 1);
    assert.equal(grid[0].key, "2026-06-01");
    assert.equal(grid[0].inMonth, true);
  });

  it("handles a leap February", () => {
    const inMonth = buildMonthGrid(2024, 2).filter((cell) => cell.inMonth);
    assert.equal(inMonth.length, 29);
    assert.equal(inMonth[28].key, "2024-02-29");
  });

  it("produces 42 contiguous days with no gaps or repeats", () => {
    const grid = buildMonthGrid(2026, 3);
    const keys = grid.map((cell) => cell.key);
    assert.equal(new Set(keys).size, 42);
  });
});

describe("recordSpan", () => {
  it("returns a single-day span when there is no end field", () => {
    const span = recordSpan({ on: "2026-06-10" }, "on");
    assert.deepEqual(span?.start, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(span?.end, { year: 2026, month: 6, day: 10 });
  });

  it("spans start→end inclusive when an end field is given", () => {
    const span = recordSpan({ on: "2026-06-10", until: "2026-06-12" }, "on", "until");
    assert.deepEqual(span?.start, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(span?.end, { year: 2026, month: 6, day: 12 });
  });

  it("collapses an inverted or invalid end to a single day", () => {
    assert.deepEqual(recordSpan({ on: "2026-06-10", until: "2026-06-01" }, "on", "until")?.end, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(recordSpan({ on: "2026-06-10", until: "nonsense" }, "on", "until")?.end, { year: 2026, month: 6, day: 10 });
  });

  it("returns null when the anchor date is missing or invalid", () => {
    assert.equal(recordSpan({ on: "" }, "on"), null);
    assert.equal(recordSpan({ on: "2026-02-30" }, "on"), null);
    assert.equal(recordSpan({}, "on"), null);
  });
});

describe("spanCoversDay", () => {
  const span = recordSpan({ on: "2026-06-10", until: "2026-06-12" }, "on", "until");
  if (!span) throw new Error("fixture span must parse");

  it("covers the inclusive endpoints and interior", () => {
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 10 }));
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 11 }));
    assert.ok(spanCoversDay(span, { year: 2026, month: 6, day: 12 }));
  });

  it("excludes days outside the span", () => {
    assert.equal(spanCoversDay(span, { year: 2026, month: 6, day: 9 }), false);
    assert.equal(spanCoversDay(span, { year: 2026, month: 6, day: 13 }), false);
  });
});

describe("recordSpan — times", () => {
  it("reads clock from a datetime anchor/end pair", () => {
    const span = recordSpan({ on: "2026-06-10T09:00", end: "2026-06-10T10:30" }, "on", "end");
    assert.equal(span?.startMin, 540);
    assert.equal(span?.endMin, 630);
  });

  it("falls back to a separate time-string field for a date-only anchor", () => {
    const span = recordSpan({ date: "2026-06-11", time: "14:00-17:00" }, "date", undefined, "time");
    assert.deepEqual(span?.start, { year: 2026, month: 6, day: 11 });
    assert.equal(span?.startMin, 840);
    assert.equal(span?.endMin, 1020);
  });

  it("leaves a clock-less record all-day (null,null)", () => {
    const span = recordSpan({ date: "2026-06-15", time: "終日" }, "date", undefined, "time");
    assert.equal(span?.startMin, null);
    assert.equal(span?.endMin, null);
  });

  it("renders an open-ended time as start-only", () => {
    const span = recordSpan({ date: "2026-06-12", time: "17:00-" }, "date", undefined, "time");
    assert.equal(span?.startMin, 1020);
    assert.equal(span?.endMin, null);
  });
});

describe("daySlice", () => {
  const day = { year: 2026, month: 6, day: 11 };

  // recordSpan returns `RecordSpan | null`; the fixtures here always parse, so
  // narrow with a throwing helper rather than a non-null assertion.
  const mustSpan = (item: Record<string, unknown>, anchor: string, end?: string, time?: string) => {
    const span = recordSpan(item, anchor, end, time);
    if (!span) throw new Error("fixture span must parse");
    return span;
  };

  it("classifies a clock-less record as all-day", () => {
    assert.equal(daySlice(mustSpan({ date: "2026-06-11" }, "date", undefined, "time"), day)?.kind, "allDay");
  });

  it("classifies a point in time as a line", () => {
    const slice = daySlice(mustSpan({ date: "2026-06-11", time: "16:30" }, "date", undefined, "time"), day);
    assert.equal(slice?.kind, "line");
    assert.equal(slice?.startMin, 990);
  });

  it("classifies a range as a block", () => {
    const span = mustSpan({ date: "2026-06-11", time: "14:00-17:00" }, "date", undefined, "time");
    assert.deepEqual(daySlice(span, day), { kind: "block", startMin: 840, endMin: 1020, bleedsBefore: false, bleedsAfter: false });
  });

  it("clamps a multi-day datetime span to each day with bleed flags", () => {
    const span = mustSpan({ on: "2026-06-10T22:00", end: "2026-06-12T06:00" }, "on", "end");
    const d10 = daySlice(span, { year: 2026, month: 6, day: 10 });
    assert.deepEqual(d10, { kind: "block", startMin: 1320, endMin: MINUTES_PER_DAY, bleedsBefore: false, bleedsAfter: true });
    const d11 = daySlice(span, { year: 2026, month: 6, day: 11 });
    assert.deepEqual(d11, { kind: "block", startMin: 0, endMin: MINUTES_PER_DAY, bleedsBefore: true, bleedsAfter: true });
    const d12 = daySlice(span, { year: 2026, month: 6, day: 12 });
    assert.deepEqual(d12, { kind: "block", startMin: 0, endMin: 360, bleedsBefore: true, bleedsAfter: false });
  });

  it("returns null for a day the span does not cover", () => {
    const span = mustSpan({ date: "2026-06-11", time: "14:00-17:00" }, "date", undefined, "time");
    assert.equal(daySlice(span, { year: 2026, month: 6, day: 12 }), null);
  });
});

describe("assignLanes", () => {
  it("gives non-overlapping blocks a single lane each", () => {
    const lanes = assignLanes([
      { startMin: 540, endMin: 600 },
      { startMin: 600, endMin: 660 },
    ]);
    assert.deepEqual(lanes, [
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("splits two overlapping blocks into two lanes", () => {
    const lanes = assignLanes([
      { startMin: 540, endMin: 660 },
      { startMin: 600, endMin: 720 },
    ]);
    assert.deepEqual(lanes, [
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ]);
  });

  it("reuses a freed lane after a block ends", () => {
    // A 9-11 and B 9-10 overlap (2 lanes); C 10-11 reuses B's freed lane but
    // still overlaps A, so the cluster stays 2 lanes wide. B sorts first (it
    // ends earliest) so it takes lane 0; A spills to lane 1; C reuses lane 0.
    const lanes = assignLanes([
      { startMin: 540, endMin: 660 },
      { startMin: 540, endMin: 600 },
      { startMin: 600, endMin: 660 },
    ]);
    assert.deepEqual(lanes, [
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });
});

describe("bucketRecords", () => {
  it("separates dated records from undated ones and sorts by start", () => {
    const items = [
      { id: "c", on: "2026-06-20" },
      { id: "a", on: "2026-06-01" },
      { id: "x", on: "" },
      { id: "b", on: "2026-06-10" },
      { id: "y", on: "not-a-date" },
    ];
    const { spans, noDate } = bucketRecords(items, "on");
    assert.deepEqual(
      spans.map((span) => span.item.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      noDate.map((item) => item.id),
      ["x", "y"],
    );
  });
});
