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
 * Rolling "last 7 days" window, quantised to service-day boundaries so it caches
 * by day rather than by the instant. Covers the seven service days ending with
 * the given day's service day.
 * @param at - Anchor instant (default now).
 * @returns The seven-service-day window.
 */
export function nzLast7DaysRange(at: Date = new Date()): DateRange {
  const day = nzServiceDayRange(at);
  return { start: new Date(day.end.getTime() - 604_800_000), end: day.end };
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
 * Label an hour-of-day (0-23) as a 12-hour clock hour, e.g. 0 -> "12am",
 * 13 -> "1pm". Used for the Shame board's per-hour headings.
 * @param hour - Hour of day, 0-23.
 * @returns The hour label.
 */
export function nzHourLabel(hour: number): string {
  const h = ((hour % 12) + 12) % 12 || 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}
