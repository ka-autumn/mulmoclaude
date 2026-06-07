// Pure, deterministic helpers for the collection calendar view: parse
// `date`-field values, build a month grid, and bucket records onto the
// days they cover. No `Date.now()` / `new Date()` (argless) here — every
// function takes its inputs explicitly so the logic is unit-testable
// without faking the clock. All internal arithmetic runs in UTC (which
// has no DST), so fixed 86_400_000 ms steps never skip or double a day.

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A two-digit field (hours / minutes / seconds) of a clock value.
const TWO_DIGIT_RE = /^\d{2}$/;
// A single clock token inside a free-form `time` string field (e.g. the
// "14:00-17:00" / "17:00-" / "16:30" / "終日" shapes seen in user data).
const CLOCK_RE = /(\d{1,2}):(\d{2})/g;
// Range separators we tolerate between two clock tokens: ASCII hyphen, en/em
// dash, tilde, and the Japanese wave dashes.
const RANGE_SEP_RE = /[-–—~〜～]/;

/** Minutes in a full day — the timeline's vertical extent. */
export const MINUTES_PER_DAY = 1440;

/** A civil date triple. `month` is 1-12 (NOT the 0-based `Date` month). */
export interface Ymd {
  year: number;
  month: number;
  day: number;
}

/** One cell of the 6×7 month grid. */
export interface DayCell {
  ymd: Ymd;
  /** False for the leading/trailing days that belong to the adjacent
   *  month (rendered greyed). */
  inMonth: boolean;
  /** Canonical `YYYY-MM-DD` key for this cell. */
  key: string;
}

/** A record placed on the calendar: the inclusive `[start, end]` span of
 *  days it covers. `end === start` for a single-day record. `startMin` /
 *  `endMin` are minutes-of-day for the time-allocation (day) view, resolved
 *  from either a `datetime` field's clock or a separate time-string field.
 *  `null` means "no clock" — `startMin === null && endMin === null` is an
 *  all-day record; a non-null `startMin` with a null `endMin` is a
 *  point-in-time record (rendered as a single line). */
export interface RecordSpan<T> {
  item: T;
  start: Ymd;
  end: Ymd;
  startMin: number | null;
  endMin: number | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Canonical `YYYY-MM-DD` string for a civil date. */
export function ymdKey(ymd: Ymd): string {
  return `${String(ymd.year).padStart(4, "0")}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

/** Strictly parse a `YYYY-MM-DD` string into a civil date, rejecting
 *  anything that isn't a real calendar day (e.g. `2026-02-30`, `2026-13-01`).
 *  Returns null for non-strings and malformed values so callers can route
 *  records with no usable date into the "no date" tray rather than crash. */
export function parseIsoDate(value: unknown): Ymd | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through a UTC Date to reject impossible days: a value the
  // Date constructor rolls over (Feb 30 → Mar 2) won't match back.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Minutes-of-day for an `HH:MM` pair, or null when out of range. */
function clockToMinutes(hours: number, minutes: number): number | null {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Strictly parse a `YYYY-MM-DDTHH:MM` (optional `:SS`) datetime into its
 *  civil date and minutes-of-day. Returns null for anything that isn't a real
 *  calendar day or a valid 24h clock. */
export function parseIsoDateTime(value: unknown): { ymd: Ymd; minutes: number } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const tIndex = trimmed.indexOf("T");
  if (tIndex === -1) return null;
  const ymd = parseIsoDate(trimmed.slice(0, tIndex));
  if (!ymd) return null;
  // `HH:MM` with an optional `:SS` the browser appends for non-zero seconds.
  const parts = trimmed.slice(tIndex + 1).split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => TWO_DIGIT_RE.test(part))) return null;
  const minutes = clockToMinutes(Number(parts[0]), Number(parts[1]));
  if (minutes === null) return null;
  return { ymd, minutes };
}

/** Civil date from either a `YYYY-MM-DD` or a `YYYY-MM-DDTHH:MM` value, so the
 *  month grid buckets date-only and datetime anchors alike. */
export function dateOf(value: unknown): Ymd | null {
  return parseIsoDate(value) ?? parseIsoDateTime(value)?.ymd ?? null;
}

/** Minutes-of-day from a datetime value, or null for date-only / invalid. */
function timeOf(value: unknown): number | null {
  return parseIsoDateTime(value)?.minutes ?? null;
}

/** Parse a free-form time-string field into start/end minutes-of-day.
 *  Handles the common shapes in user data:
 *    "14:00-17:00" → { start: 840, end: 1020 }   (range → block)
 *    "17:00-"      → { start: 1020, end: null }   (open end → single line)
 *    "16:30"       → { start: 990, end: null }    (point in time → single line)
 *    "終日" / ""   → null                          (no clock → all-day)
 *  Returns null when no clock token is parseable. */
export function parseTimeRange(value: unknown): { startMin: number | null; endMin: number | null } | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const tokens = [...text.matchAll(CLOCK_RE)];
  if (tokens.length === 0) return null;
  const minutesOf = (match: RegExpMatchArray): number | null => clockToMinutes(Number(match[1]), Number(match[2]));
  // No separator → a single point in time (start only).
  if (!RANGE_SEP_RE.test(text)) {
    const startMin = minutesOf(tokens[0]);
    return startMin === null ? null : { startMin, endMin: null };
  }
  // Separator present → assign each token to the side of the first separator.
  const sepIndex = text.search(RANGE_SEP_RE);
  let startMin: number | null = null;
  let endMin: number | null = null;
  for (const token of tokens) {
    if ((token.index ?? 0) < sepIndex) startMin = minutesOf(token);
    else endMin = minutesOf(token);
  }
  if (startMin === null && endMin === null) return null;
  return { startMin, endMin };
}

function ymdToUtcMs(ymd: Ymd): number {
  return Date.UTC(ymd.year, ymd.month - 1, ymd.day);
}

function utcMsToYmd(epochMs: number): Ymd {
  const date = new Date(epochMs);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Chronological comparison: negative if `left` precedes `right`, 0 if the
 *  same day, positive if after. */
export function compareYmd(left: Ymd, right: Ymd): number {
  return ymdToUtcMs(left) - ymdToUtcMs(right);
}

/** True iff `day` falls within the inclusive span `[span.start, span.end]`. */
export function spanCoversDay<T>(span: RecordSpan<T>, day: Ymd): boolean {
  return compareYmd(span.start, day) <= 0 && compareYmd(day, span.end) <= 0;
}

/** Build the 6×7 (42-cell) grid for the given month, including the
 *  leading/trailing days of the adjacent months so every week is full.
 *  `month` is 1-12. `weekStartsOn` is 0 (Sunday) … 6 (Saturday). */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 0): DayCell[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const startMs = Date.UTC(year, month - 1, 1) - lead * MS_PER_DAY;
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const ymd = utcMsToYmd(startMs + i * MS_PER_DAY);
    cells.push({ ymd, inMonth: ymd.year === year && ymd.month === month, key: ymdKey(ymd) });
  }
  return cells;
}

/** Resolve a record's calendar span from its date/datetime fields. Returns
 *  null when the anchor date is missing/invalid (→ the caller's "no date"
 *  tray). An end date that is missing, invalid, or earlier than the start
 *  collapses to a single-day span — never an inverted range.
 *
 *  Times for the day (time-allocation) view come from, in priority order:
 *    1. the clock on a `datetime` anchor/end value, else
 *    2. `timeField` — a separate free-form time-string column (e.g. "14:00-17:00").
 *  A record with no resolvable clock has `startMin === endMin === null`. */
export function recordSpan<T extends Record<string, unknown>>(item: T, anchorField: string, endField?: string, timeField?: string): RecordSpan<T> | null {
  const startRaw = item[anchorField];
  const start = dateOf(startRaw);
  if (!start) return null;
  let end = start;
  let startMin = timeOf(startRaw);
  let endMin: number | null = null;
  if (endField) {
    const endRaw = item[endField];
    const parsedEnd = dateOf(endRaw);
    if (parsedEnd && compareYmd(parsedEnd, start) >= 0) {
      end = parsedEnd;
      endMin = timeOf(endRaw);
    }
  }
  // Fall back to a separate time-string field only when the date fields
  // carried no clock (the date-only anchor + `time` column shape).
  if (timeField && startMin === null && endMin === null) {
    const range = parseTimeRange(item[timeField]);
    if (range) {
      ({ startMin, endMin } = range);
    }
  }
  return { item, start, end, startMin, endMin };
}

/** Split records into those that land on the calendar (with their spans)
 *  and those with no usable anchor date (the "no date" tray). Spans are
 *  sorted by start day so same-day stacking is stable across renders. */
export function bucketRecords<T extends Record<string, unknown>>(
  items: readonly T[],
  anchorField: string,
  endField?: string,
  timeField?: string,
): { spans: RecordSpan<T>[]; noDate: T[] } {
  const spans: RecordSpan<T>[] = [];
  const noDate: T[] = [];
  for (const item of items) {
    const span = recordSpan(item, anchorField, endField, timeField);
    if (span) spans.push(span);
    else noDate.push(item);
  }
  spans.sort((left, right) => compareYmd(left.start, right.start));
  return { spans, noDate };
}

/** Geometry for one record on one day of the time-allocation view.
 *  `kind`:
 *    "allDay" — no clock anywhere → render in the bottom all-day strip.
 *    "line"   — a single point in time → a 1px marker at `startMin`.
 *    "block"  — a [startMin, endMin) span, clamped to this day's [0, 1440).
 *  `bleedsBefore` / `bleedsAfter` flag a multi-day span that began on an
 *  earlier day or continues onto a later one (so the view can show arrows). */
export interface DaySlice {
  kind: "allDay" | "line" | "block";
  startMin: number;
  endMin: number;
  bleedsBefore: boolean;
  bleedsAfter: boolean;
}

/** Project a record's span onto a single day for the time-allocation view, or
 *  null when the span doesn't cover that day. */
export function daySlice<T>(span: RecordSpan<T>, day: Ymd): DaySlice | null {
  if (!spanCoversDay(span, day)) return null;
  const hasStart = span.startMin !== null;
  const hasEnd = span.endMin !== null;
  if (!hasStart && !hasEnd) {
    return { kind: "allDay", startMin: 0, endMin: MINUTES_PER_DAY, bleedsBefore: false, bleedsAfter: false };
  }
  const singleDay = compareYmd(span.start, span.end) === 0;
  const isStartDay = compareYmd(day, span.start) === 0;
  const isEndDay = compareYmd(day, span.end) === 0;
  // A point in time: a start clock with no end, all on one day.
  if (singleDay && hasStart && !hasEnd) {
    return { kind: "line", startMin: span.startMin as number, endMin: span.startMin as number, bleedsBefore: false, bleedsAfter: false };
  }
  const startMin = isStartDay && hasStart ? (span.startMin as number) : 0;
  const endMin = isEndDay && hasEnd ? (span.endMin as number) : MINUTES_PER_DAY;
  // Zero-length or inverted same-day range → degrade to a line.
  if (singleDay && endMin <= startMin) {
    return { kind: "line", startMin, endMin: startMin, bleedsBefore: false, bleedsAfter: false };
  }
  return { kind: "block", startMin, endMin, bleedsBefore: !isStartDay, bleedsAfter: !isEndDay };
}

/** Side-by-side lane assignment for overlapping timeline blocks. Each input
 *  is an `[startMin, endMin)` interval; the result (parallel to the input)
 *  gives each item its `lane` (column index) and the `lanes` total of its
 *  overlap cluster, so a renderer can size every block to `1 / lanes` width
 *  and offset it by `lane / lanes`. Non-overlapping items get `lanes === 1`. */
export interface LaneSpan {
  startMin: number;
  endMin: number;
}
export interface LaneAssignment {
  lane: number;
  lanes: number;
}

export function assignLanes(blocks: readonly LaneSpan[]): LaneAssignment[] {
  const order = [...blocks.keys()].sort((left, right) => blocks[left].startMin - blocks[right].startMin || blocks[left].endMin - blocks[right].endMin);
  const result: LaneAssignment[] = blocks.map(() => ({ lane: 0, lanes: 1 }));
  let cluster: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const laneEnds: number[] = [];
  const flush = (): void => {
    for (const index of cluster) result[index].lanes = laneEnds.length;
    cluster = [];
    laneEnds.length = 0;
    clusterEnd = Number.NEGATIVE_INFINITY;
  };
  for (const index of order) {
    const block = blocks[index];
    if (cluster.length > 0 && block.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMin);
    } else {
      laneEnds[lane] = block.endMin;
    }
    result[index].lane = lane;
    cluster.push(index);
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  flush();
  return result;
}

/** Month label key inputs — returns the 1st of the month as a `Date` so the
 *  component can feed it to `Intl.DateTimeFormat(locale, …)` for a localized
 *  "April 2026" header without this module taking a locale dependency. */
export function monthAnchorDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}
