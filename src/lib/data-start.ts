// src/lib/data-start.ts
// The first day the archive covers. Nothing earlier is reachable: no day
// stepper, no week or month range, no fallback, no `?day=`. This is a hard
// floor, not the whole answer - it is correct until September 2036, when the
// ten-year retention starts pruning the oldest day nightly and the true
// earliest day begins moving forward. The constant governs clamping and copy,
// while the day stepper keeps reading a live floor that is the greater of the
// two. Deliberately free of `@/lib/db` so page nav stays pure and unit-testable.
//
// 2036 checklist, everything that has to change when the floor starts moving:
// DATA_START_DAY, DATA_START_LABEL and DATA_START_SHORT below; the footer's
// About line in src/app/layout.tsx; DayNav's "first day" hint; the "(from ...)"
// suffix on RangeControls' period label; and the home page's first-day line.
import { type DateRange, nzServiceDayRange, nzServiceDayString, serviceDayNoon } from "@/lib/time";

/** First service date with a full day of data. Readings before it do not exist. */
export const DATA_START_DAY = "2026-09-11";

/** Human form for page copy, kept beside the constant so the two never drift. */
export const DATA_START_LABEL = "11 September 2026";

/**
 * Short form for tight controls, e.g. the period label's "(from 11 Sep)" hint.
 * Written out rather than formatted from {@link DATA_START_DAY}: `en-NZ` renders
 * September as "Sept" under newer ICU data, so an `Intl` derivation is not
 * stable across Node versions. The unit test holds the three constants together.
 */
export const DATA_START_SHORT = "11 Sep";

/**
 * Whether a service date sits before the archive starts.
 * @param day - Service date (`YYYY-MM-DD`).
 * @returns True when nothing can exist on that day.
 */
export function isBeforeDataStart(day: string): boolean {
  return day < DATA_START_DAY;
}

/**
 * Clamp a service date into `[DATA_START_DAY, today]`. Both ends matter:
 * production serves `?day=2020-01-01` as a 200 with an empty board, and
 * `?day=2027-01-01` opens an endless empty corridor forward through a working
 * Next day chevron.
 * @param day - The requested service date (`YYYY-MM-DD`).
 * @param today - Today's service date (injectable for tests).
 * @returns The nearest reachable service date.
 */
export function clampServiceDate(day: string, today: string = nzServiceDayString()): string {
  if (day < DATA_START_DAY) return DATA_START_DAY;
  return day > today ? today : day;
}

/**
 * A Date inside the first service day (its local noon), for the nav helpers
 * that take an `earliestDay: Date`.
 * @returns Noon within the first service day.
 */
export function dataStartDate(): Date {
  return serviceDayNoon(DATA_START_DAY);
}

/**
 * Raise a range's start to the first service day's start; the end is untouched.
 * Clamps to exactly that instant, not one millisecond later:
 * `serviceDatesInRange` drops a leading service day whose start *precedes* the
 * window, so an exact match keeps the first day in the list.
 * @param range - The window to clamp.
 * @returns The clamped window.
 */
export function clampRangeToDataStart(range: DateRange): DateRange {
  const floor = nzServiceDayRange(DATA_START_DAY).start;
  return range.start < floor ? { start: floor, end: range.end } : range;
}

/**
 * Whether a clamped window covers nothing, so a caller can skip the query
 * rather than render every route as a new entry.
 * @param range - A window, usually one {@link clampRangeToDataStart} has raised.
 * @returns True when the window is empty.
 */
export function rangeIsEmpty(range: DateRange): boolean {
  return range.end <= range.start;
}
