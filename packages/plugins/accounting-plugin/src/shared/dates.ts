// Local-calendar date helpers for the accounting forms.
//
// Why not `new Date().toISOString().slice(0, 10)`? `toISOString` is
// UTC. In a negative-offset zone (US Pacific, Eastern, …) the UTC
// date crosses to "tomorrow" several hours before midnight local,
// so a naively prefilled date input would post entries into the
// wrong accounting day. Same mistake near month boundaries flips
// the default Balance Sheet period to the next month.
//
// All four helpers below are pure local-calendar formatters built
// from `getFullYear` / `getMonth` / `getDate`, which the JS engine
// resolves in the user's local timezone.

function pad2(num: number): string {
  return String(num).padStart(2, "0");
}

/** Today as `YYYY-MM-DD` in the user's local timezone. */
export function localDateString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Current month as `YYYY-MM` in the user's local timezone. */
export function localMonthString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** First day of the current calendar year as `YYYY-MM-DD`. */
export function localStartOfYearString(now: Date = new Date()): string {
  return `${now.getFullYear()}-01-01`;
}

/** Previous calendar month as `YYYY-MM` in the user's local timezone. */
export function previousMonthString(now: Date = new Date()): string {
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}`;
}

/** Last month of the previous calendar quarter as `YYYY-MM`. Calendar
 *  quarters: Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec. When the
 *  current month is in Q1, this rolls back to December of last year. */
export function lastMonthOfPreviousQuarterString(now: Date = new Date()): string {
  const firstMonthOfCurrentQuarter = Math.floor(now.getMonth() / 3) * 3;
  const target = new Date(now.getFullYear(), firstMonthOfCurrentQuarter - 1, 1);
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}`;
}

/** December of the previous calendar year as `YYYY-MM`. */
export function decemberOfPreviousYearString(now: Date = new Date()): string {
  return `${now.getFullYear() - 1}-12`;
}
