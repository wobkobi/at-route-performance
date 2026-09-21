// src/lib/time.ts
// Auckland-timezone date helpers returning UTC half-open windows
// for calendar days, service days, weeks and months. Offsets are derived per
// instant via Intl so NZST/NZDT transitions are handled correctly rather than
// with a fixed offset. The key domain concept is the service day: a transit day
// runs from 4am to 4am, so a post-midnight run counts under the day it started,
// and a `YYYY-MM-DD` string is treated as a service date directly (for `?day=`).
// Rolling windows quantise to service-day boundaries so they cache by day rather
// than by the instant.
import { dmY } from "@/lib/format";
import { NZ_TZ } from "@/lib/nz-tz";

// Re-exported so callers take the timezone name and the helpers from one module.
export { NZ_TZ };

/** A UTC half-open window [start, end). */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Matches a `YYYY-MM-DD` date string, capturing year, month and day. */
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Matches a `YYYY-MM` month key, capturing year and month. */
const YM_RE = /^(\d{4})-(\d{2})$/;

/** Calendar date parts: year, month (1-12) and day of month. */
interface Ymd {
  y: number;
  mo: number;
  d: number;
}

/**
 * Parse a `YYYY-MM-DD` string into its calendar parts. Throws on any other
 * shape so a malformed date fails loudly here instead of flowing into
 * `Date.UTC` as NaN and surfacing later as an "Invalid time value".
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The year, month (1-12) and day of month.
 */
export function parseYmd(ymd: string): Ymd {
  const [, y, mo, d] = YMD_RE.exec(ymd) ?? [];
  if (y === undefined || mo === undefined || d === undefined) {
    throw new Error(`Malformed date "${ymd}": expected YYYY-MM-DD`);
  }
  return { y: Number(y), mo: Number(mo), d: Number(d) };
}

/**
 * Parse a `YYYY-MM` month key into its parts. Throws on any other shape, as
 * {@link parseYmd} does.
 * @param ym - Month as `YYYY-MM`.
 * @returns The year and month (1-12).
 */
function parseYm(ym: string): Pick<Ymd, "y" | "mo"> {
  const [, y, mo] = YM_RE.exec(ym) ?? [];
  if (y === undefined || mo === undefined) {
    throw new Error(`Malformed month "${ym}": expected YYYY-MM`);
  }
  return { y: Number(y), mo: Number(mo) };
}

/**
 * The Auckland-local calendar date of an instant (en-CA formats in ISO order).
 * @param at - The instant to convert.
 * @returns The local year, month (1-12) and day of month.
 */
function nzLocalYmd(at: Date): Ymd {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parseYmd(ymd);
}

/**
 * Auckland's UTC offset, in minutes, at a given instant (handles NZST/NZDT).
 * @param at - The instant to evaluate.
 * @returns Offset in minutes that, added to UTC, gives Auckland local time.
 */
function nzOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: NZ_TZ,
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
 * Midnight is exactly the case a single offset sample gets wrong on a DST-switch
 * day, so this shares {@link nzLocalToUtcAtHour}'s two-pass resolution.
 * @param y - Local full year.
 * @param mo - Local month (1-12).
 * @param d - Local day of month.
 * @returns The UTC Date for that Auckland local midnight.
 */
function nzLocalToUtc(y: number, mo: number, d: number): Date {
  return nzLocalToUtcAtHour(y, mo, d, 0);
}

/**
 * The Auckland-local calendar-day window containing an instant.
 * @param at - Any instant within the target day (defaults to now).
 * @returns UTC `{ start, end }` for that local day.
 */
export function nzDayRange(at: Date = new Date()): DateRange {
  const { y, mo, d } = nzLocalYmd(at);
  const start = nzLocalToUtc(y, mo, d);
  const end = nzLocalToUtc(y, mo, d + 1);
  return { start, end };
}

/** Hour the transit service day starts (Auckland local). */
export const SERVICE_START_HOUR = 4;

/**
 * How far past a service day's end the last reading of its last run can fall.
 * A run starting just before the boundary keeps reporting into the next day, so
 * anything that groups a run's readings has to reach this far. Over all 15,364
 * runs on 15 September 2026 the longest ran 104 minutes, the 99.9th percentile
 * 94 minutes, and none reached two hours; three hours is 1.73x the observed
 * maximum, which is the margin a bound only ever exercised by the outlier
 * wants. The failure modes are asymmetric: too small and a run's tail is
 * silently dropped from its own day, which is a wrong number on a board; too
 * large and some extra rows are scanned and then discarded.
 */
export const RUN_TAIL_HOURS = 3;

/**
 * Convert an Auckland-local wall-clock date + hour to the UTC instant.
 *
 * The offset depends on the instant and the instant on the offset, so it is
 * resolved in two passes: estimate with the offset at the wall-clock reading
 * taken as UTC, then re-sample at that estimate. On a DST-switch day the first
 * sample can sit on the wrong side of the 02:00/03:00 change (UTC midnight is
 * local noon, after the switch, while local midnight is before it); the second
 * sample lands on the right side. Two passes always agree for Auckland's single
 * annual switch.
 * @param y - Local full year.
 * @param mo - Local month (1-12).
 * @param d - Local day of month (may be out of range; normalised).
 * @param hour - Local hour (0-23).
 * @returns The UTC Date for that Auckland local time.
 */
function nzLocalToUtcAtHour(y: number, mo: number, d: number, hour: number): Date {
  const wall = Date.UTC(y, mo - 1, d, hour);
  const first = nzOffsetMinutes(new Date(wall));
  const estimate = new Date(wall - first * 60000);
  const second = nzOffsetMinutes(estimate);
  return new Date(wall - second * 60000);
}

/**
 * The Auckland-local **service day** window containing an instant: a transit day
 * runs from `startHour` (default 4am) to the same hour next day, so a post-
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
  const ymd = typeof at === "string" ? at.match(YMD_RE) : null;
  if (ymd) {
    y = Number(ymd[1]);
    mo = Number(ymd[2]);
    d = Number(ymd[3]);
  } else {
    const inst = typeof at === "string" ? new Date(at) : at;
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: NZ_TZ,
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
 * The instant a GTFS schedule time falls at within a service day. GTFS measures
 * times from "noon minus 12h" of the service date, which is local midnight
 * except on a DST-switch day; the service day's 4am start minus four real hours
 * is that same instant, because the 02:00/03:00 switch sits before both 4am and
 * noon. A time earlier than the start hour is a post-midnight run filed under
 * this service day but written against the next calendar date ("00:30:00"
 * rather than "24:30:00"), so it moves forward a day.
 * @param serviceDayStart - The service day's start instant (its 4am, as stored).
 * @param seconds - Seconds since the GTFS reference; may exceed 24h for post-midnight runs.
 * @returns The UTC instant of that schedule time.
 */
export function serviceDayClockInstant(serviceDayStart: Date, seconds: number): Date {
  const startSec = SERVICE_START_HOUR * 3600;
  const offset = seconds < startSec ? seconds + 86_400 : seconds;
  return new Date(serviceDayStart.getTime() + (offset - startSec) * 1000);
}

/**
 * Seconds of the GTFS clock an instant inside a service day falls at: the exact
 * inverse of {@link serviceDayClockInstant}, so a reading stored against its own
 * schedule reads back the seconds its trip id encodes. A post-midnight instant
 * gives a value past 86,400 and is left unwrapped, because the caller decides
 * whether to compare it plainly or circularly (see `anchorGapSec` in
 * ghost-pass.ts).
 * @param serviceDayStart - The service day's start instant, as stored.
 * @param at - An instant inside that service day.
 * @returns Seconds since the GTFS reference for that instant.
 */
export function serviceDayClockSeconds(serviceDayStart: Date, at: Date): number {
  const startSec = SERVICE_START_HOUR * 3600;
  return startSec + Math.round((at.getTime() - serviceDayStart.getTime()) / 1000);
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
    timeZone: NZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
}

/**
 * Local noon inside a service day, as a marker instant for a day the boards
 * step through. Resolved from the wall clock rather than by adding hours to the
 * day's start, so it stays noon whatever {@link SERVICE_START_HOUR} becomes and
 * whichever side of a daylight-saving switch the day falls.
 * @param day - Service date, `YYYY-MM-DD`.
 * @returns The instant of 12:00 Auckland local on that date.
 */
export function serviceDayNoon(day: string): Date {
  const { y, mo, d } = parseYmd(day);
  return nzLocalToUtcAtHour(y, mo, d, 12);
}

/**
 * The Monday that starts the Auckland-local week containing an instant.
 * Weeks reset on Monday (ISO).
 * @param at - The instant to label.
 * @returns The week's Monday as `YYYY-MM-DD`.
 */
export function nzWeekStart(at: Date): string {
  const { y, mo, d } = nzLocalYmd(at);
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
  const m = weekStart?.match(YMD_RE);
  if (m) {
    base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  } else {
    const { y, mo, d } = nzLocalYmd(new Date());
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
  const m = ym?.match(YM_RE);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
  } else {
    ({ y, mo } = parseYm(nzMonthKey()));
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
    timeZone: NZ_TZ,
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
  const { y, mo } = parseYm(ym);
  const total = y * 12 + (mo - 1) + months;
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
    timeZone: NZ_TZ,
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
  // 7 * 24h of milliseconds, which lands an hour off the 4am boundary when the
  // window straddles a DST transition.
  const start = nzServiceDayRange(shiftWeek(nzServiceDayString(at), -6)).start;
  return { start, end: day.end };
}

/**
 * The Auckland service dates (`YYYY-MM-DD`) whose service days start inside a
 * half-open window, earliest first. Handles both midnight-aligned calendar
 * ranges ({@link nzWeekRange}, {@link nzMonthRange}) and 4am service-day-aligned
 * ranges ({@link nzLast7DaysRange}): a service day is included only when its
 * 4am start lies inside `[start, end)`, so a midnight week start no longer
 * drags in the previous service day. Lets the week boards resolve one day at
 * a time.
 * @param range - A half-open UTC window.
 * @returns The service dates in the window, earliest first.
 */
export function serviceDatesInRange(range: DateRange): string[] {
  // The service day containing range.start; when its 4am start precedes the
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
    timeZone: NZ_TZ,
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
  const { y, mo, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
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
