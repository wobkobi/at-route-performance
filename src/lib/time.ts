// src/lib/time.ts

/** A UTC half-open window [start, end). */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Auckland's UTC offset, in minutes, at a given instant (handles NZST/NZDT).
 * @param at - The instant to evaluate.
 * @returns Offset in minutes that, added to UTC, gives Auckland local time.
 */
function nzOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - at.getTime()) / 60000);
}

/**
 * Convert an Auckland-local wall-clock date (midnight) to the UTC instant.
 * @param y - Local full year.
 * @param mo - Local month (1-12).
 * @param d - Local day of month.
 * @returns The UTC Date for that Auckland local midnight.
 */
function nzLocalToUtc(y: number, mo: number, d: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d));
  const offset = nzOffsetMinutes(guess);
  return new Date(Date.UTC(y, mo - 1, d) - offset * 60000);
}

/**
 * The Auckland-local calendar-day window containing an instant.
 * @param at - Any instant within the target day (defaults to now).
 * @returns UTC `{ start, end }` for that local day.
 */
export function nzDayRange(at: Date = new Date()): DateRange {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, mo, d] = dtf.format(at).split("-").map(Number);
  const start = nzLocalToUtc(y, mo, d);
  const end = nzLocalToUtc(y, mo, d + 1);
  return { start, end };
}

/**
 * The Sunday that starts the Auckland-local week containing an instant.
 * Weeks reset on Sunday.
 * @param at - The instant to label.
 * @returns The week's Sunday as `YYYY-MM-DD`.
 */
export function nzWeekStart(at: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, mo, d] = dtf.format(at).split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay()); // getUTCDay 0 = Sunday
  return date.toISOString().slice(0, 10);
}

/**
 * The Auckland-local week window (Sunday 00:00 to the next Sunday 00:00).
 * Any date snaps to its week's Sunday; defaults to the week containing now.
 * @param weekStart - The week's Sunday as `YYYY-MM-DD` (optional).
 * @returns UTC `{ start, end }` spanning that local week.
 */
export function nzWeekRange(weekStart?: string): DateRange {
  let base: Date;
  const m = weekStart?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  } else {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [y, mo, d] = dtf.format(new Date()).split("-").map(Number);
    base = new Date(Date.UTC(y, mo - 1, d));
  }
  base.setUTCDate(base.getUTCDate() - base.getUTCDay()); // snap back to Sunday
  const y = base.getUTCFullYear();
  const mo = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  return { start: nzLocalToUtc(y, mo, d), end: nzLocalToUtc(y, mo, d + 7) };
}

/**
 * The Auckland-local calendar-month window. Defaults to the current month.
 * @param ym - Month like `2026-06` (optional).
 * @returns UTC `{ start, end }` spanning that local month.
 */
export function nzMonthRange(ym?: string): DateRange {
  let y: number;
  let mo: number;
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
  } else {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
    });
    [y, mo] = dtf.format(new Date()).split("-").map(Number);
  }
  const start = nzLocalToUtc(y, mo, 1);
  const end = nzLocalToUtc(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1);
  return { start, end };
}
