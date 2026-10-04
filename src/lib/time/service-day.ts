// src/lib/time/service-day.ts
// Auckland-timezone date helpers returning UTC half-open windows for service
// days, weeks and months. Offsets are derived per instant via Intl so NZST/NZDT
// transitions are handled correctly rather than with a fixed offset. The key
// domain concept is the service day: a transit day runs from 4am to 4am, so a
// post-midnight run counts under the day it started, and a `YYYY-MM-DD` string
// is treated as a service date directly (for `?day=`). Weeks and months are
// runs of whole service days, and rolling windows quantise to service-day
// boundaries so they cache by day rather than by the instant.
import {
  NZ_DATE,
  NZ_DATE_HOUR_PARTS,
  NZ_HOUR_PARTS,
  NZ_WALL_PARTS,
  UTC_WEEKDAY,
} from "@/lib/time/format";
import { NZ_TZ } from "@/lib/time/nz-tz";

// Re-exported so callers take the timezone name and the helpers from one module.
export { NZ_TZ };

/** A UTC half-open window [start, end). */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Seconds in an hour. */
export const SEC_PER_HOUR = 3600;

/** Seconds in a day: a GTFS time past this is a post-midnight run. */
export const SEC_PER_DAY = 86_400;

/** Milliseconds in an hour. */
export const MS_PER_HOUR = 3_600_000;

/**
 * Milliseconds in a calendar day. Not a service day across a daylight-saving
 * switch (23 or 25 hours): step dates with {@link shiftDays}, not this.
 */
export const MS_PER_DAY = 86_400_000;

/** Matches a `YYYY-MM-DD` date string, capturing year, month and day. */
export const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Matches a `YYYY-MM` month key with a real month number, capturing year and month. */
export const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

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
export function parseYm(ym: string): Pick<Ymd, "y" | "mo"> {
  const [, y, mo] = YM_RE.exec(ym) ?? [];
  if (y === undefined || mo === undefined) {
    throw new Error(`Malformed month "${ym}": expected YYYY-MM`);
  }
  return { y: Number(y), mo: Number(mo) };
}

/**
 * Whether a `YYYY-MM-DD` string is a real calendar date. `Date.UTC` silently
 * normalises an impossible one (2026-02-31 onto 3 March), so the parts must
 * round-trip unchanged.
 * @param ymd - The candidate date.
 * @returns True for a well-formed, real date.
 */
export function isRealDate(ymd: string): boolean {
  const [, ys, ms, ds] = YMD_RE.exec(ymd) ?? [];
  if (ys === undefined || ms === undefined || ds === undefined) return false;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * AT's compact `YYYYMMDD` date in the dashed form the rest of the site uses.
 * @param compact - AT's date string, or whatever the field actually held.
 * @returns The dashed date, or null when the value is not eight digits.
 */
export function dashedDate(compact: unknown): string | null {
  if (typeof compact !== "string" || !/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

/**
 * A month key from its parts.
 * @param y - Full year.
 * @param mo - Month, 1-12.
 * @returns The key as `YYYY-MM`.
 */
export function ymKey(y: number, mo: number): string {
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/**
 * Auckland's UTC offset, in minutes, at a given instant (handles NZST/NZDT).
 * @param at - The instant to evaluate.
 * @returns Offset in minutes that, added to UTC, gives Auckland local time.
 */
function nzOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(NZ_WALL_PARTS.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
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
    const parts = Object.fromEntries(
      NZ_DATE_HOUR_PARTS.formatToParts(inst).map((p) => [p.type, p.value]),
    );
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
 * Widen a service-day-aligned window to hold the tail of a run that started
 * just before its end. A query that filters on the stored service date has to
 * reach this far past the boundary or it drops the last readings of the day's
 * last run, and the equality then throws away the extra rows the pad let in.
 * @param range - The service-day-aligned window.
 * @returns The same window with {@link RUN_TAIL_HOURS} added to its end.
 */
export function padScanRange(range: DateRange): DateRange {
  return { start: range.start, end: new Date(range.end.getTime() + RUN_TAIL_HOURS * MS_PER_HOUR) };
}

/**
 * The `scheduledAt` window that holds every reading of one service day's runs.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The day's window, padded for the run tail.
 */
export function serviceDayScanRange(date: string): DateRange {
  return padScanRange(nzServiceDayRange(date));
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
 * @param startHour - The boundary hour `serviceDayStart` was built with; a
 *   migration working in another hour passes its own.
 * @returns The UTC instant of that schedule time.
 */
export function serviceDayClockInstant(
  serviceDayStart: Date,
  seconds: number,
  startHour = SERVICE_START_HOUR,
): Date {
  const startSec = startHour * SEC_PER_HOUR;
  const offset = seconds < startSec ? seconds + SEC_PER_DAY : seconds;
  return new Date(serviceDayStart.getTime() + (offset - startSec) * 1000);
}

/**
 * Seconds of the GTFS clock an instant inside a service day falls at: the exact
 * inverse of {@link serviceDayClockInstant}, so a reading stored against its own
 * schedule reads back the seconds its trip id encodes. A post-midnight instant
 * gives a value past 86,400 and is left unwrapped, because the caller decides
 * whether to compare it plainly or circularly (see `anchorGapSec` in
 * cron/ghost-pass.ts).
 * @param serviceDayStart - The service day's start instant, as stored.
 * @param at - An instant inside that service day.
 * @returns Seconds since the GTFS reference for that instant.
 */
export function serviceDayClockSeconds(serviceDayStart: Date, at: Date): number {
  const startSec = SERVICE_START_HOUR * SEC_PER_HOUR;
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
  return NZ_DATE.format(start);
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
 * The Monday that starts the week containing an instant's service day. Weeks
 * reset on Monday (ISO) at 4am, so 1am on a Monday is still the week before.
 * @param at - The instant to label.
 * @returns The week's Monday as `YYYY-MM-DD`.
 */
export function nzWeekStart(at: Date): string {
  return mondayOf(nzServiceDayString(at));
}

/**
 * A week of service days: Monday 4am to the next Monday 4am, so a week holds
 * exactly the runs of its seven service days. Any date snaps to its week's
 * Monday; defaults to the week holding the current service day.
 * @param weekStart - The week's Monday as `YYYY-MM-DD` (optional).
 * @returns UTC `{ start, end }` spanning that week.
 */
export function nzWeekRange(weekStart?: string): DateRange {
  const { y, mo, d } = parseYmd(
    mondayOf(weekStart && YMD_RE.test(weekStart) ? weekStart : nzServiceDayString()),
  );
  return {
    start: nzLocalToUtcAtHour(y, mo, d, SERVICE_START_HOUR),
    end: nzLocalToUtcAtHour(y, mo, d + 7, SERVICE_START_HOUR),
  };
}

/**
 * A month of service days: the 1st's 4am to the next month's 1st at 4am.
 * Defaults to the month holding the current service day.
 * @param ym - Month like `2026-06` (optional).
 * @returns UTC `{ start, end }` spanning that month.
 */
export function nzMonthRange(ym?: string): DateRange {
  const { y, mo } = parseYm(ym?.match(YM_RE) ? ym : nzMonthKey());
  return {
    start: nzLocalToUtcAtHour(y, mo, 1, SERVICE_START_HOUR),
    end: nzLocalToUtcAtHour(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, SERVICE_START_HOUR),
  };
}

/**
 * Month key like `2026-06` for an instant's service day, so 1am on the 1st is
 * still the month before.
 * @param at - The instant to label (default now).
 * @returns The month as `YYYY-MM`.
 */
export function nzMonthKey(at: Date = new Date()): string {
  return monthOf(nzServiceDayString(at));
}

/**
 * The month key a date falls in.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The month as `YYYY-MM`.
 */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
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
  return ymKey(Math.floor(total / 12), (total % 12) + 1);
}

/**
 * Human month label like `June 2026` for a month range.
 * @param range - Half-open month range from {@link nzMonthRange}.
 * @returns The formatted label.
 */
export function monthRangeLabel(range: DateRange): string {
  // The start instant is the 1st's own service day, so its key is the month's.
  return monthLabel(nzMonthKey(range.start));
}

/**
 * Read a `?d=` link param as an instant. Trip links carry either an ISO instant
 * (the run's departure) or a bare service date; a service date reads as its
 * local noon, safely inside its own service day.
 * @param value - The raw param.
 * @returns The instant, or null when absent or unparseable.
 */
export function parseInstantParam(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (YMD_RE.test(value)) return isRealDate(value) ? serviceDayNoon(value) : null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
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
  const start = nzServiceDayRange(shiftDays(nzServiceDayString(at), -6)).start;
  return { start, end: day.end };
}

/**
 * The Auckland service dates (`YYYY-MM-DD`) whose service days start inside a
 * half-open window, earliest first. A service day is included only when its
 * 4am start lies inside `[start, end)`, so a window that does not sit on a
 * service-day edge (a caller's own `from`/`to`) never drags in the day its
 * start falls in. Lets the week boards resolve one day at a time.
 * @param range - A half-open UTC window.
 * @returns The service dates in the window, earliest first.
 */
export function serviceDatesInRange(range: DateRange): string[] {
  // The service day containing range.start; when its 4am start precedes the
  // window, it belongs to the previous window > skip.
  let date = nzServiceDayString(range.start);
  if (nzServiceDayRange(date).start < range.start) date = shiftDays(date, 1);
  const last = nzServiceDayString(new Date(range.end.getTime() - 1));
  const dates: string[] = [];
  while (date <= last) {
    dates.push(date);
    date = shiftDays(date, 1);
  }
  return dates;
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
 * The Auckland-local hour of day (0-23) of an instant. Some engines print
 * midnight as "24" under `hour12: false`, so that reads back as 0.
 * @param at - The instant.
 * @returns The local hour.
 */
export function nzLocalHour(at: Date): number {
  const hour = NZ_HOUR_PARTS.formatToParts(at).find((p) => p.type === "hour")?.value;
  return hour === "24" ? 0 : Number(hour);
}

/**
 * Whether an instant falls between midnight and the {@link SERVICE_START_HOUR}
 * start, so it counts towards the service day before its calendar date.
 * @param at - The instant.
 * @returns True for a post-midnight instant.
 */
export function isAfterMidnight(at: Date): boolean {
  return nzLocalHour(at) < SERVICE_START_HOUR;
}

/**
 * Seconds into a service day's GTFS clock for a schedule time ("HH:MM:SS"),
 * for ordering a day's departures. AT writes a post-midnight run both as
 * "24:30:00" and as "00:30:00" (see {@link serviceDayClockInstant}), so a time
 * before the start hour moves past 24h and sorts after "23:50:00".
 * @param hms - The GTFS time.
 * @returns The seconds, or null when the time does not parse.
 */
export function gtfsServiceSeconds(hms: string): number | null {
  const [h, m, s] = hms.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  const seconds = h * SEC_PER_HOUR + m * 60 + (s && !Number.isNaN(s) ? s : 0);
  return h < SERVICE_START_HOUR ? seconds + SEC_PER_DAY : seconds;
}

/**
 * What a service day covers, for the day stepper's tooltip: "Tue 22 Sep runs
 * from 4am to 4am Wed 23 Sep, so a trip after midnight still counts towards it."
 * @param ymd - Service date as `YYYY-MM-DD`.
 * @returns The sentence.
 */
export function serviceDayWindowText(ymd: string): string {
  const start = nzHourLabel(SERVICE_START_HOUR);
  return `${serviceDayLabel(ymd)} runs from ${start} to ${start} ${serviceDayLabel(shiftDays(ymd, 1))}, so a trip after midnight still counts towards it.`;
}

/**
 * The note an after-midnight time carries, naming the service day it counts
 * towards: "After midnight, still counted in Tue 22 Sep".
 * @param ymd - The service date the time belongs to.
 * @returns The note.
 */
export function afterMidnightNote(ymd: string): string {
  return `After midnight, still counted in ${serviceDayLabel(ymd)}`;
}

/**
 * Shift a `YYYY-MM-DD` date string by whole days. Calendar arithmetic in UTC,
 * so a daylight-saving switch never moves it off the date.
 * @param ymd - Source date.
 * @param days - Days to add (negative steps back).
 * @returns The shifted `YYYY-MM-DD`.
 */
export function shiftDays(ymd: string, days: number): string {
  const { y, mo, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The weekday of a calendar date, 0 for Sunday to 6 for Saturday. The date is
 * read as a calendar date in UTC, not as an Auckland instant, which would land
 * on the next local day.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The weekday number.
 */
export function weekdayOf(ymd: string): number {
  const { y, mo, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/**
 * The Monday of the week holding a date, weeks running Monday to Sunday as the
 * site's week view does.
 * @param ymd - The date.
 * @returns That week's Monday.
 */
export function mondayOf(ymd: string): string {
  return shiftDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

/**
 * Short weekday label ("Mon") for a `YYYY-MM-DD` date string.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The short weekday label, e.g. "Mon".
 */
export function weekdayShort(ymd: string): string {
  return UTC_WEEKDAY.format(new Date(`${ymd}T00:00:00Z`));
}

/** Month names, indexed 0-11; the first three letters are each one's short name. */
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A month's short name, "Sep".
 * @param mo - Month, 1-12.
 * @returns The name.
 */
export function monthShortName(mo: number): string {
  return (MONTHS[mo - 1] ?? "").slice(0, 3);
}

/**
 * A month key as "September 2026".
 * @param ym - Month as `YYYY-MM`.
 * @returns The label.
 */
export function monthLabel(ym: string): string {
  const { y, mo } = parseYm(ym);
  return `${MONTHS[mo - 1] ?? ""} ${y}`;
}

/**
 * The last date of a month.
 * @param ym - Month as `YYYY-MM`.
 * @returns Its last day as `YYYY-MM-DD`.
 */
export function monthLastDay(ym: string): string {
  return shiftDays(`${shiftMonth(ym, 1)}-01`, -1);
}

/**
 * A service date as `Sun 13 Sep`, the label the day stepper, the cancellation
 * list and the trip page all use for one day.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The label.
 */
export function serviceDayLabel(ymd: string): string {
  const { mo, d } = parseYmd(ymd);
  return `${weekdayShort(ymd)} ${d} ${monthShortName(mo)}`;
}

/**
 * A service date as `17 Sep 2026`, for naming a date far enough from today that
 * its weekday is no help and its year is.
 * @param ymd - Date as `YYYY-MM-DD`.
 * @returns The label.
 */
export function serviceDateLabel(ymd: string): string {
  const { y, mo, d } = parseYmd(ymd);
  return `${d} ${monthShortName(mo)} ${y}`;
}

/**
 * A run of service dates as `21 to 27 Sep`, naming the month on both ends only
 * when it changes (`28 Sep to 4 Oct`) and the year on both ends only when the
 * run straddles New Year (`29 Dec 2025 to 4 Jan 2026`). One date reads `21 Sep`.
 * @param first - First date as `YYYY-MM-DD`.
 * @param last - Last date as `YYYY-MM-DD`, inclusive.
 * @returns The label.
 */
export function dayRangeLabel(first: string, last: string): string {
  const a = parseYmd(first);
  const b = parseYmd(last);
  if (first === last) return `${a.d} ${monthShortName(a.mo)}`;
  if (a.y !== b.y) return `${serviceDateLabel(first)} to ${serviceDateLabel(last)}`;
  if (a.mo !== b.mo) return `${a.d} ${monthShortName(a.mo)} to ${b.d} ${monthShortName(b.mo)}`;
  return `${a.d} to ${b.d} ${monthShortName(b.mo)}`;
}

/**
 * Label a week, or any run of whole service days, by its first and last day
 * (see {@link dayRangeLabel}).
 * @param range - Half-open range (`end` is exclusive).
 * @returns The label.
 */
export function weekLabel(range: DateRange): string {
  const days = serviceDatesInRange(range);
  const first = days[0] ?? nzServiceDayString(range.start);
  return dayRangeLabel(first, days.at(-1) ?? first);
}
