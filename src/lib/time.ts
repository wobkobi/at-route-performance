// src/lib/time.ts
/**
 * @description Auckland-timezone date helpers returning UTC half-open windows
 * for calendar days, service days, weeks and months. Offsets are derived per
 * instant via Intl so NZST/NZDT transitions are handled correctly rather than
 * with a fixed offset. The key domain concept is the service day: a transit day
 * runs from 5am to 5am, so a post-midnight run counts under the day it started,
 * and a `YYYY-MM-DD` string is treated as a service date directly (for `?day=`).
 * Rolling windows quantise to service-day boundaries so they cache by day rather
 * than by the instant.
 */
import { dmY } from "@/lib/format";

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

/** Hour the transit service day starts (Auckland local). */
export const SERVICE_START_HOUR = 5;

/**
 * Convert an Auckland-local wall-clock date + hour to the UTC instant.
 * @param y - Local full year.
 * @param mo - Local month (1-12).
 * @param d - Local day of month (may be out of range; normalised).
 * @param hour - Local hour (0-23).
 * @returns The UTC Date for that Auckland local time.
 */
function nzLocalToUtcAtHour(y: number, mo: number, d: number, hour: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, hour));
  const offset = nzOffsetMinutes(guess);
  return new Date(Date.UTC(y, mo - 1, d, hour) - offset * 60000);
}

/**
 * The Auckland-local **service day** window containing an instant: a transit day
 * runs from `startHour` (default 5am) to the same hour next day, so a post-
 * midnight run counts under the day it started. Accepts a `YYYY-MM-DD` string,
 * which is treated as the service date directly (for a `?day=` param).
 * @param at - An instant within the target service day, or its `YYYY-MM-DD` date.
 * @param startHour - Local hour the service day begins (default {@link SERVICE_START_HOUR}).
 * @returns UTC `{ start, end }` for that service day.
 */
export function nzServiceDayRange(
  at: Date | string = new Date(),
  startHour = SERVICE_START_HOUR,
): DateRange {
  let y: number;
  let mo: number;
  let d: number;
  const ymd = typeof at === "string" ? at.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (ymd) {
    y = Number(ymd[1]);
    mo = Number(ymd[2]);
    d = Number(ymd[3]);
  } else {
    const inst = typeof at === "string" ? new Date(at) : at;
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(dtf.formatToParts(inst).map((p) => [p.type, p.value]));
    y = Number(parts.year);
    mo = Number(parts.month);
    d = Number(parts.day);
    const hour = parts.hour === "24" ? 0 : Number(parts.hour);
    // Before the start hour, the instant belongs to the previous service day.
    if (hour < startHour) {
      const prev = new Date(Date.UTC(y, mo - 1, d - 1));
      y = prev.getUTCFullYear();
      mo = prev.getUTCMonth() + 1;
      d = prev.getUTCDate();
    }
  }
  return {
    start: nzLocalToUtcAtHour(y, mo, d, startHour),
    end: nzLocalToUtcAtHour(y, mo, d + 1, startHour),
  };
}

/**
 * The service date (`YYYY-MM-DD`) of the service day containing an instant.
 * @param at - The instant to label.
 * @param startHour - Local hour the service day begins.
 * @returns The service date as `YYYY-MM-DD`.
 */
export function nzServiceDayString(at: Date = new Date(), startHour = SERVICE_START_HOUR): string {
  const { start } = nzServiceDayRange(at, startHour);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
}

/**
 * The Monday that starts the Auckland-local week containing an instant.
 * Weeks reset on Monday (ISO).
 * @param at - The instant to label.
 * @returns The week's Monday as `YYYY-MM-DD`.
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
  // getUTCDay 0 = Sunday; shift so Monday is the week start.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * The Auckland-local week window (Monday 00:00 to the next Monday 00:00).
 * Any date snaps to its week's Monday; defaults to the week containing now.
 * @param weekStart - The week's Monday as `YYYY-MM-DD` (optional).
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
  base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7)); // snap back to Monday
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

/**
 * Month key like `2026-06` for an instant, in Auckland local time.
 * @param at - The instant to label (default now).
 * @returns The month as `YYYY-MM`.
 */
export function nzMonthKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
  }).format(at);
}

/**
 * Shift a `YYYY-MM` month key by whole months.
 * @param ym - Source month key.
 * @param months - Months to add (negative steps back).
 * @returns The shifted `YYYY-MM`.
 */
export function shiftMonth(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Human month label like `June 2026` for a month range.
 * @param range - Half-open month range from {@link nzMonthRange}.
 * @returns The formatted label.
 */
export function monthRangeLabel(range: DateRange): string {
  // The start instant is local midnight on the 1st; nudge a day in so the
  // formatter can never land in the previous month.
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    month: "long",
    year: "numeric",
  }).format(new Date(range.start.getTime() + 86_400_000));
}

/**
 * Rolling "last 7 days" window, quantised to service-day boundaries so it caches
 * by day rather than by the instant. Covers the seven service days ending with
 * the given day's service day.
 * @param at - Anchor instant (default now).
 * @returns The seven-service-day window.
 */
export function nzLast7DaysRange(at: Date = new Date()): DateRange {
  const day = nzServiceDayRange(at);
  // Step back six service days by date string rather than subtracting a fixed
  // 7 * 24h of milliseconds, which lands an hour off the 5am boundary when the
  // window straddles a DST transition.
  const start = nzServiceDayRange(shiftWeek(nzServiceDayString(at), -6)).start;
  return { start, end: day.end };
}

/**
 * The Auckland service dates (`YYYY-MM-DD`) whose service days start inside a
 * half-open window, earliest first. Handles both midnight-aligned calendar
 * ranges ({@link nzWeekRange}, {@link nzMonthRange}) and 5am service-day-aligned
 * ranges ({@link nzLast7DaysRange}): a service day is included only when its
 * 5am start lies inside `[start, end)`, so a midnight week start no longer
 * drags in the previous service day. Lets the week boards resolve one day at
 * a time.
 * @param range - A half-open UTC window.
 * @returns The service dates in the window, earliest first.
 */
export function serviceDatesInRange(range: DateRange): string[] {
  // The service day containing range.start; when its 5am start precedes the
  // window (a midnight-aligned range), it belongs to the previous window > skip.
  let date = nzServiceDayString(range.start);
  if (nzServiceDayRange(date).start < range.start) date = shiftWeek(date, 1);
  const last = nzServiceDayString(new Date(range.end.getTime() - 1));
  const dates: string[] = [];
  while (date <= last) {
    dates.push(date);
    date = shiftWeek(date, 1);
  }
  return dates;
}

/**
 * Auckland-local clock time (e.g. "7:24am") for an ISO instant.
 * @param iso - ISO instant string.
 * @returns The local 12-hour time label.
 */
export function nzClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Label an hour-of-day (0-23) as a 12-hour clock hour, e.g. 0 > "12am",
 * 13 > "1pm". Used for the Shame board's per-hour headings.
 * @param hour - Hour of day, 0-23.
 * @returns The hour label.
 */
export function nzHourLabel(hour: number): string {
  const h = ((hour % 12) + 12) % 12 || 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

/**
 * Shift a `YYYY-MM-DD` date string by whole days (UTC arithmetic). Shared
 * across the shame and route pages for week stepping.
 * @param ymd - Source date.
 * @param days - Days to add (negative steps back).
 * @returns The shifted `YYYY-MM-DD`.
 */
export function shiftWeek(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Short weekday label ("Mon") for a `YYYY-MM-DD` date string. Formats the
 * calendar date itself at UTC midnight in the UTC zone; formatting an
 * NZ-noon-UTC instant in Pacific/Auckland lands on the NEXT local day and
 * shifts every label one weekday ahead.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The short weekday label, e.g. "Mon".
 */
export function weekdayShort(ymd: string): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

/**
 * Week label as `DD/MM to DD/MM`, adding the year on both ends only when the
 * week straddles New Year.
 * @param range - Half-open week range (`end` is the exclusive next Monday).
 * @returns The range label.
 */
export function weekRangeLabel(range: DateRange): string {
  const first = dmY(range.start);
  const last = dmY(new Date(range.end.getTime() - 86_400_000));
  return first.y === last.y
    ? `${first.dm} to ${last.dm}`
    : `${first.dm}/${first.y} to ${last.dm}/${last.y}`;
}
