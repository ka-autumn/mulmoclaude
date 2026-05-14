import type { ScheduledItem } from "./index";

export type SegmentPosition = "only" | "start" | "middle" | "end";

export interface EventRange {
  start: string;
  end: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoDate(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

export function eventRange(item: ScheduledItem): EventRange | null {
  const start = asIsoDate(item.props.date);
  if (!start) return null;
  const endRaw = asIsoDate(item.props.endDate);
  if (!endRaw) return { start, end: start };
  if (endRaw < start) return { start, end: start };
  return { start, end: endRaw };
}

// True when the event has an `endDate` set but it doesn't form
// a valid forward range: malformed ISO string, end-before-start,
// or no usable `date` to anchor against. Drives the "broken"
// chip style so the user notices and can fix the typo instead
// of silently losing the multi-day intent.
export function isMalformedRange(item: ScheduledItem): boolean {
  if (item.props.endDate === undefined || item.props.endDate === null) return false;
  if (typeof item.props.endDate !== "string" || item.props.endDate.length === 0) return false;
  const start = asIsoDate(item.props.date);
  const end = asIsoDate(item.props.endDate);
  if (!start || !end) return true;
  return end < start;
}

export function coversDay(item: ScheduledItem, dateStr: string): boolean {
  const range = eventRange(item);
  if (!range) return false;
  return range.start <= dateStr && dateStr <= range.end;
}

export function segmentPosition(item: ScheduledItem, dateStr: string): SegmentPosition | null {
  const range = eventRange(item);
  if (!range) return null;
  if (dateStr < range.start || dateStr > range.end) return null;
  if (range.start === range.end) return "only";
  if (dateStr === range.start) return "start";
  if (dateStr === range.end) return "end";
  return "middle";
}

// Per-event color so adjacent multi-day events read as distinct
// bars instead of one indistinguishable blue block. Full class
// strings (not template-built) so Tailwind's content scanner can
// find every variant.
//
// Covers all 17 of Tailwind's chromatic hues at bg-100/text-900
// (legible on white) with hover:bg-200. The wide palette keeps
// collisions rare even when 10+ events stack near each other.
const EVENT_PALETTE = [
  "bg-red-100 text-red-900 hover:bg-red-200",
  "bg-orange-100 text-orange-900 hover:bg-orange-200",
  "bg-amber-100 text-amber-900 hover:bg-amber-200",
  "bg-yellow-100 text-yellow-900 hover:bg-yellow-200",
  "bg-lime-100 text-lime-900 hover:bg-lime-200",
  "bg-green-100 text-green-900 hover:bg-green-200",
  "bg-emerald-100 text-emerald-900 hover:bg-emerald-200",
  "bg-teal-100 text-teal-900 hover:bg-teal-200",
  "bg-cyan-100 text-cyan-900 hover:bg-cyan-200",
  "bg-sky-100 text-sky-900 hover:bg-sky-200",
  "bg-blue-100 text-blue-900 hover:bg-blue-200",
  "bg-indigo-100 text-indigo-900 hover:bg-indigo-200",
  "bg-violet-100 text-violet-900 hover:bg-violet-200",
  "bg-purple-100 text-purple-900 hover:bg-purple-200",
  "bg-fuchsia-100 text-fuchsia-900 hover:bg-fuchsia-200",
  "bg-pink-100 text-pink-900 hover:bg-pink-200",
  "bg-rose-100 text-rose-900 hover:bg-rose-200",
];

export function eventColorClasses(eventId: string): string {
  // Defensive on non-string input: handlers sanitize ids at write,
  // but pre-existing on-disk items may pre-date that guard and
  // shouldn't crash the render.
  const safe = typeof eventId === "string" ? eventId : "";
  let hash = 0;
  for (let i = 0; i < safe.length; i++) {
    hash = (hash * 31 + safe.charCodeAt(i)) | 0;
  }
  return EVENT_PALETTE[Math.abs(hash) % EVENT_PALETTE.length] ?? EVENT_PALETTE[0] ?? "";
}

export const EVENT_PALETTE_SIZE = EVENT_PALETTE.length;
