// Fiscal-year arithmetic for the accounting plugin.
//
// Each book stores a `fiscalYearEnd` token (Q1..Q4) that says which
// calendar-quarter end is the book's fiscal year end:
//
//   Q1 → fiscal year ends March 31     (FY runs Apr 1 → Mar 31)
//   Q2 → fiscal year ends June 30      (FY runs Jul 1 → Jun 30)
//   Q3 → fiscal year ends September 30 (FY runs Oct 1 → Sep 30)
//   Q4 → fiscal year ends December 31  (FY runs Jan 1 → Dec 31; default)
//
// "Current quarter" / "current year" everywhere in the UI refer to
// the *fiscal* quarter / *fiscal* year that contains today, under the
// active book's `fiscalYearEnd`. For Q4 books fiscal quarters and
// fiscal years coincide with calendar quarters / calendar years; for
// the other three a shift applies.
//
// All helpers return `YYYY-MM-DD` strings in the user's local
// timezone — same convention as `dates.ts`.

export const FISCAL_YEAR_ENDS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type FiscalYearEnd = (typeof FISCAL_YEAR_ENDS)[number];

export const DEFAULT_FISCAL_YEAR_END: FiscalYearEnd = "Q4";

export function isFiscalYearEnd(value: unknown): value is FiscalYearEnd {
  return typeof value === "string" && (FISCAL_YEAR_ENDS as readonly string[]).includes(value);
}

/** Books written before the field existed are treated as Q4 in code
 *  but never auto-rewritten on disk. The settings UI persists through
 *  the field the next time the user saves anything on the book. */
export function resolveFiscalYearEnd(value: FiscalYearEnd | undefined): FiscalYearEnd {
  return value ?? DEFAULT_FISCAL_YEAR_END;
}

/** Last calendar month (1-12) of the fiscal year for the given Q. */
export function fiscalYearEndMonth(end: FiscalYearEnd): 3 | 6 | 9 | 12 {
  if (end === "Q1") return 3;
  if (end === "Q2") return 6;
  if (end === "Q3") return 9;
  return 12;
}

export interface DateRange {
  /** Inclusive lower bound (YYYY-MM-DD). Empty string = unbounded. */
  from: string;
  /** Inclusive upper bound (YYYY-MM-DD). Empty string = unbounded. */
  to: string;
}

function pad2(num: number): string {
  return String(num).padStart(2, "0");
}

function lastDayOfMonth(year: number, monthZeroBased: number): number {
  // Day 0 of next month = last day of this month, all in local time.
  return new Date(year, monthZeroBased + 1, 0).getDate();
}

function ymd(year: number, monthOneBased: number, day: number): string {
  return `${year}-${pad2(monthOneBased)}-${pad2(day)}`;
}

/** Fiscal quarter index (0..3) of the given local date under `end`,
 *  where 0 is the first quarter of the fiscal year (right after the
 *  prior year's close) and 3 is the closing quarter. */
function fiscalQuarterIndex(end: FiscalYearEnd, today: Date): number {
  const closingMonth = fiscalYearEndMonth(end); // 1-based
  const month = today.getMonth() + 1; // 1-based local month
  // Months past the close of the prior fiscal year, mod 12.
  const offset = (month - closingMonth - 1 + 12) % 12;
  return Math.floor(offset / 3);
}

/** Calendar (year, monthOneBased) of the *first* month of the fiscal
 *  quarter at index `index` in the fiscal year that *contains*
 *  `today`. Returned both as the first day of that month and as the
 *  count of months covered (always 3 — exposed as a constant). */
function fiscalQuarterStart(end: FiscalYearEnd, today: Date, index: number): { year: number; month: number } {
  const closingMonth = fiscalYearEndMonth(end);
  const todayMonth = today.getMonth() + 1;
  const todayYear = today.getFullYear();
  // Month after the close of the prior fiscal year — fiscal-year start month.
  const startMonth = (closingMonth % 12) + 1;
  // The fiscal year that contains `today` started in the calendar
  // year ≤ today's year. Specifically: if today's calendar month is
  // ≥ startMonth (or startMonth is 1, which is the Q4 case), the FY
  // started this calendar year; otherwise it started last year.
  const fyStartYear = todayMonth >= startMonth ? todayYear : todayYear - 1;
  // Month of the requested fiscal quarter's first month, expressed
  // as a 1-based offset from January of fyStartYear.
  const flatMonth = startMonth + index * 3; // 1-based, may exceed 12
  const year = fyStartYear + Math.floor((flatMonth - 1) / 12);
  const month = ((flatMonth - 1) % 12) + 1;
  return { year, month };
}

function quarterRangeAt(end: FiscalYearEnd, today: Date, index: number): DateRange {
  const start = fiscalQuarterStart(end, today, index);
  // Quarter spans 3 calendar months starting at `start`.
  const lastMonthFlat = start.month - 1 + 2; // 0-based offset of the third month
  const lastMonthYear = start.year + Math.floor(lastMonthFlat / 12);
  const lastMonth = (lastMonthFlat % 12) + 1; // 1-based
  const lastDay = lastDayOfMonth(lastMonthYear, lastMonth - 1);
  return {
    from: ymd(start.year, start.month, 1),
    to: ymd(lastMonthYear, lastMonth, lastDay),
  };
}

export function currentQuarterRange(end: FiscalYearEnd, today: Date = new Date()): DateRange {
  return quarterRangeAt(end, today, fiscalQuarterIndex(end, today));
}

export function previousQuarterRange(end: FiscalYearEnd, today: Date = new Date()): DateRange {
  const idx = fiscalQuarterIndex(end, today);
  if (idx > 0) return quarterRangeAt(end, today, idx - 1);
  // Wrap to Q4 of the prior fiscal year. Step `today` back 3 months
  // — that lands inside the prior fiscal year regardless of `end`,
  // and Q4 (closing) is index 3 within whichever FY contains it.
  const stepped = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  return quarterRangeAt(end, stepped, 3);
}

/** Current fiscal year — Q0 start through Q3 close. */
export function currentFiscalYearRange(end: FiscalYearEnd, today: Date = new Date()): DateRange {
  const first = quarterRangeAt(end, today, 0);
  const last = quarterRangeAt(end, today, 3);
  return { from: first.from, to: last.to };
}

export function previousFiscalYearRange(end: FiscalYearEnd, today: Date = new Date()): DateRange {
  // Step a year back so `quarterRangeAt` resolves the prior FY.
  const stepped = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return currentFiscalYearRange(end, stepped);
}
