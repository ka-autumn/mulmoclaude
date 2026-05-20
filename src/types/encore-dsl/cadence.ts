// Encore cadence math. Pure functions — no fs, no clock injection
// here (the caller passes `now` explicitly). Per the DSL spec each
// cadence shape determines:
//
//   - which slot "now" falls into (currentCycleSlot)
//   - the cycle's start date (cycleStart)
//   - the cycle's deadline date (cycleDeadline)
//   - the on-disk cycle id string (formatCycleId), used to name the
//     per-cycle file under obligations/<id>/<cycleId>.md
//
// The five v1 cadences are: annual, biannual, monthly, weekly, daily.
// Quarterly / one-shot / custom-cron are out of scope. Days are
// capped at 28 in validators to avoid February edge cases; the math
// here trusts validated input. ISO dates everywhere (YYYY-MM-DD).

import { z } from "zod";

// ── ISO date helpers ────────────────────────────────────────────

/** Format a Date as `YYYY-MM-DD` in the server's LOCAL timezone.
 *  Encore obligations are wall-clock obligations ("pay rent on the
 *  1st" means the 1st in the user's calendar, not the 1st in UTC),
 *  so cycle boundaries must follow the host's wall clock. Matches
 *  the journal subsystem's `toLocalIsoDate` convention in
 *  `server/utils/date.ts`. */
export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDate(year: number, monthZero: number, day: number): Date {
  return new Date(year, monthZero, day);
}

/** Parse a YYYY-MM-DD string to a local-midnight Date. */
function parseLocalIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Add N calendar days to an ISO date (returns ISO). */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return isoDate(localDate(year, month - 1, day + days));
}

/** Lexicographic ISO compare. -1 / 0 / 1. */
export function compareIsoDates(lhs: string, rhs: string): number {
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

// ── ISO week helpers (used by weekly cadence) ───────────────────

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** ISO 8601 week number for a date. The ISO week year matches the
 *  Thursday of the week — handy for the early-Jan / late-Dec edge
 *  cases where a date's calendar year and ISO-week year differ. */
function isoWeekYearAndNumber(date: Date): { year: number; week: number } {
  // Copy to avoid mutating caller.
  const thursdayOfWeek = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (thursdayOfWeek.getDay() + 6) % 7; // Mon=0 … Sun=6
  thursdayOfWeek.setDate(thursdayOfWeek.getDate() - dayNum + 3);
  const firstThursday = new Date(thursdayOfWeek.getFullYear(), 0, 4);
  const firstThursdayDayNum = (firstThursday.getDay() + 6) % 7;
  const firstThursdayWeekStart = new Date(firstThursday);
  firstThursdayWeekStart.setDate(firstThursday.getDate() - firstThursdayDayNum);
  const diffMs = thursdayOfWeek.getTime() - firstThursdayWeekStart.getTime();
  const week = 1 + Math.round(diffMs / MS_PER_WEEK);
  return { year: thursdayOfWeek.getFullYear(), week };
}

/** Monday of the given ISO week (returns ISO date). */
function isoWeekMonday(year: number, week: number): string {
  // Jan 4 is always in week 1.
  const jan4 = new Date(year, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setDate(jan4.getDate() - jan4DayNum);
  const target = new Date(mondayOfWeek1);
  target.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);
  return isoDate(target);
}

// ── Cadence Zod schema ──────────────────────────────────────────

const dayInMonth = z.number().int().min(1).max(28);
const monthOfYear = z.number().int().min(1).max(12);

const cycleEntry = z.object({ month: monthOfYear, day: dayInMonth });

const annual = z.object({
  type: z.literal("annual"),
  cycles: z.tuple([cycleEntry]),
});

const biannual = z.object({
  type: z.literal("biannual"),
  cycles: z.tuple([cycleEntry, cycleEntry]),
});

const monthly = z.object({
  type: z.literal("monthly"),
  day: dayInMonth,
});

const DAY_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayOfWeek = (typeof DAY_OF_WEEK)[number];

const weekly = z.object({
  type: z.literal("weekly"),
  dayOfWeek: z.enum(DAY_OF_WEEK),
});

const daily = z.object({
  type: z.literal("daily"),
});

export const CadenceSchema = z.discriminatedUnion("type", [annual, biannual, monthly, weekly, daily]).superRefine((cadence, ctx) => {
  if (cadence.type === "biannual") {
    const [first, second] = cadence.cycles;
    if (first.month > second.month || (first.month === second.month && first.day >= second.day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "biannual cycles must be in calendar order (first cycle before second)",
        path: ["cycles"],
      });
    }
  }
});

export type Cadence = z.infer<typeof CadenceSchema>;

// ── Slot identification ─────────────────────────────────────────

export type CycleSlot =
  | { kind: "annual"; year: number }
  | { kind: "biannual"; year: number; half: 1 | 2 }
  | { kind: "monthly"; year: number; month: number }
  | { kind: "weekly"; year: number; week: number }
  | { kind: "daily"; iso: string };

/** Find the cycle slot a given date falls into for this cadence.
 *  "Falls into" = the slot whose [start, deadline] range contains
 *  `now`; for annual / biannual we pick the slot whose deadline is
 *  the next upcoming one (so the cycle is "active" until its
 *  deadline passes; the day AFTER the deadline rolls into the next
 *  cycle, matching the spec's cycle-start = day-after-prev-deadline
 *  rule). */
export function currentCycleSlot(cadence: Cadence, now: Date): CycleSlot {
  // Compare as ISO date strings — the deadline is date-only, and
  // comparing `now` (a full timestamp) against a midnight Date
  // would roll over one day early on the deadline day. ISO-string
  // lexical compare is calendar-correct for YYYY-MM-DD.
  const todayIso = isoDate(now);
  const year = now.getFullYear();
  if (cadence.type === "annual") {
    const [{ month, day }] = cadence.cycles;
    const thisYearDeadlineIso = isoDate(localDate(year, month - 1, day));
    return { kind: "annual", year: todayIso <= thisYearDeadlineIso ? year : year + 1 };
  }
  if (cadence.type === "biannual") {
    const [first, second] = cadence.cycles;
    const firstDeadlineIso = isoDate(localDate(year, first.month - 1, first.day));
    const secondDeadlineIso = isoDate(localDate(year, second.month - 1, second.day));
    if (todayIso <= firstDeadlineIso) return { kind: "biannual", year, half: 1 };
    if (todayIso <= secondDeadlineIso) return { kind: "biannual", year, half: 2 };
    return { kind: "biannual", year: year + 1, half: 1 };
  }
  if (cadence.type === "monthly") {
    const monthZero = now.getMonth();
    const deadlineThisMonthIso = isoDate(localDate(year, monthZero, cadence.day));
    if (todayIso <= deadlineThisMonthIso) {
      return { kind: "monthly", year, month: monthZero + 1 };
    }
    const next = localDate(year, monthZero + 1, 1);
    return { kind: "monthly", year: next.getFullYear(), month: next.getMonth() + 1 };
  }
  if (cadence.type === "weekly") {
    const targetIdx = DAY_OF_WEEK.indexOf(cadence.dayOfWeek);
    const { year: isoYear, week } = isoWeekYearAndNumber(now);
    const monday = isoWeekMonday(isoYear, week);
    const deadlineThisWeek = addDays(monday, targetIdx);
    if (isoDate(now) <= deadlineThisWeek) {
      return { kind: "weekly", year: isoYear, week };
    }
    const nextMondayIso = addDays(monday, 7);
    const next = isoWeekYearAndNumber(parseLocalIsoDate(nextMondayIso));
    return { kind: "weekly", year: next.year, week: next.week };
  }
  // daily
  return { kind: "daily", iso: isoDate(now) };
}

/** ISO date of the cycle's deadline. */
export function cycleDeadline(cadence: Cadence, slot: CycleSlot): string {
  if (cadence.type === "annual" && slot.kind === "annual") {
    const [{ month, day }] = cadence.cycles;
    return isoDate(localDate(slot.year, month - 1, day));
  }
  if (cadence.type === "biannual" && slot.kind === "biannual") {
    const entry = cadence.cycles[slot.half - 1];
    return isoDate(localDate(slot.year, entry.month - 1, entry.day));
  }
  if (cadence.type === "monthly" && slot.kind === "monthly") {
    return isoDate(localDate(slot.year, slot.month - 1, cadence.day));
  }
  if (cadence.type === "weekly" && slot.kind === "weekly") {
    const monday = isoWeekMonday(slot.year, slot.week);
    const targetIdx = DAY_OF_WEEK.indexOf(cadence.dayOfWeek);
    return addDays(monday, targetIdx);
  }
  if (cadence.type === "daily" && slot.kind === "daily") {
    return slot.iso;
  }
  throw new Error(`cadence/slot mismatch: cadence.type=${cadence.type} slot.kind=${slot.kind}`);
}

/** ISO date of the cycle's start. For annual/biannual that's the
 *  day after the previous slot's deadline; for monthly the 1st of
 *  the month; weekly the Monday of the ISO week; daily same as
 *  deadline. */
export function cycleStart(cadence: Cadence, slot: CycleSlot): string {
  if (cadence.type === "annual" && slot.kind === "annual") {
    const [{ month, day }] = cadence.cycles;
    const prevDeadline = isoDate(localDate(slot.year - 1, month - 1, day));
    return addDays(prevDeadline, 1);
  }
  if (cadence.type === "biannual" && slot.kind === "biannual") {
    if (slot.half === 1) {
      const [, second] = cadence.cycles;
      const prevDeadline = isoDate(localDate(slot.year - 1, second.month - 1, second.day));
      return addDays(prevDeadline, 1);
    }
    const [first] = cadence.cycles;
    const prevDeadline = isoDate(localDate(slot.year, first.month - 1, first.day));
    return addDays(prevDeadline, 1);
  }
  if (cadence.type === "monthly" && slot.kind === "monthly") {
    return isoDate(localDate(slot.year, slot.month - 1, 1));
  }
  if (cadence.type === "weekly" && slot.kind === "weekly") {
    return isoWeekMonday(slot.year, slot.week);
  }
  if (cadence.type === "daily" && slot.kind === "daily") {
    return slot.iso;
  }
  throw new Error(`cadence/slot mismatch: cadence.type=${cadence.type} slot.kind=${slot.kind}`);
}

/** On-disk cycle id string. Stable / deterministic — used as the
 *  per-cycle markdown file name under obligations/<id>/<cycleId>.md. */
export function formatCycleId(slot: CycleSlot): string {
  if (slot.kind === "annual") return `${slot.year}`;
  if (slot.kind === "biannual") return `${slot.year}-h${slot.half}`;
  if (slot.kind === "monthly") return `${slot.year}-${String(slot.month).padStart(2, "0")}`;
  if (slot.kind === "weekly") return `${slot.year}-W${String(slot.week).padStart(2, "0")}`;
  return slot.iso;
}

/** Advance to the next slot after `current` for this cadence. Used
 *  by next-cycle provisioning when a cycle closes. */
export function nextSlot(cadence: Cadence, current: CycleSlot): CycleSlot {
  if (cadence.type === "annual" && current.kind === "annual") {
    return { kind: "annual", year: current.year + 1 };
  }
  if (cadence.type === "biannual" && current.kind === "biannual") {
    if (current.half === 1) return { kind: "biannual", year: current.year, half: 2 };
    return { kind: "biannual", year: current.year + 1, half: 1 };
  }
  if (cadence.type === "monthly" && current.kind === "monthly") {
    const next = localDate(current.year, current.month, 1);
    return { kind: "monthly", year: next.getFullYear(), month: next.getMonth() + 1 };
  }
  if (cadence.type === "weekly" && current.kind === "weekly") {
    const monday = isoWeekMonday(current.year, current.week);
    const nextMondayIso = addDays(monday, 7);
    const { year, week } = isoWeekYearAndNumber(parseLocalIsoDate(nextMondayIso));
    return { kind: "weekly", year, week };
  }
  if (cadence.type === "daily" && current.kind === "daily") {
    return { kind: "daily", iso: addDays(current.iso, 1) };
  }
  throw new Error(`cadence/slot mismatch: cadence.type=${cadence.type} current.kind=${current.kind}`);
}
