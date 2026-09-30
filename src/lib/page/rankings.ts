// src/lib/page/rankings.ts
// Window and filter helpers for the week and month home page. Ranges are anchored to
// the latest day with data rather than the wall clock, so a quiet "today" still
// opens on a populated period. The week view defaults to the rolling last 7
// days; an explicit `period` is a calendar week reached by stepping back. A
// matching previous range is resolved alongside each window so the table can
// show rank movement.
import { parseMode, type Mode } from "@/lib/mode";
import type { PeriodWindow } from "@/lib/page/range";
import { parseDelayDirection, type DelayDirection } from "@/lib/rankings";
import { parseSchoolFilter, type SchoolFilter } from "@/lib/school-bus";
import { clampRangeToDataStart } from "@/lib/time/data-start";
import {
  monthRangeLabel,
  nzLast7DaysRange,
  nzMonthKey,
  nzMonthRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  shiftMonth,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time/service-day";

/** Query params for the rankings page. */
export interface RankingsSearchParams {
  window?: string;
  period?: string;
  mode?: string;
  school?: string;
  dir?: string;
}

/** Parsed rankings params. */
export interface ParsedRankingsParams {
  window: PeriodWindow;
  mode: Mode | null;
  dir: DelayDirection;
  schools: SchoolFilter;
}

/**
 * Parse and validate the rankings query params.
 * @param sp - The raw search params.
 * @returns The validated window, mode, direction and school toggle.
 */
export function parseRankingsParams(sp: RankingsSearchParams): ParsedRankingsParams {
  const window: PeriodWindow = sp.window === "month" ? "month" : "week";
  const mode = parseMode(sp.mode);
  const dir = parseDelayDirection(sp.dir);
  const schools = parseSchoolFilter(sp.school);
  return { window, mode, dir, schools };
}

/**
 * Resolve the active range + label, anchored to the latest day with data so a
 * quiet "today" still shows a populated period. The week view opens on the
 * rolling last 7 days; an explicit `period` is a calendar week (reached by
 * stepping back). Month defaults to the anchor's calendar month. The range is
 * raised to the archive floor while the label keeps naming the calendar period,
 * so a partial first week still reads as that week; `WeekNav.partial` is what
 * says the coverage is short.
 * @param window - "week" or "month".
 * @param period - Explicit period (`YYYY-MM-DD` Monday or `YYYY-MM`), optional.
 * @param anchor - The latest day with data (or now).
 * @returns The range and a human label.
 */
export function resolveRange(
  window: PeriodWindow,
  period: string | undefined,
  anchor: Date,
): { range: DateRange; label: string } {
  if (window === "month") {
    const range = nzMonthRange(period ?? nzMonthKey(anchor));
    return { range: clampRangeToDataStart(range), label: monthRangeLabel(range) };
  }
  if (period) {
    const range = nzWeekRange(period);
    return { range: clampRangeToDataStart(range), label: weekRangeLabel(range) };
  }
  return { range: clampRangeToDataStart(nzLast7DaysRange(anchor)), label: "Last 7 days" };
}

/**
 * Range for the period immediately before the given window/period, used for
 * rank-movement comparison. Clamped to the archive floor, so the period before
 * the first one comes back as an empty window; the caller checks it with
 * `rangeIsEmpty` and skips the comparison rather than ranking every route as new.
 * @param window - "week" or "month".
 * @param period - Explicit period key, or undefined for the rolling default.
 * @param anchor - Latest day with data.
 * @returns The previous period's half-open date range, possibly empty.
 */
export function resolvePrevRange(
  window: PeriodWindow,
  period: string | undefined,
  anchor: Date,
): DateRange {
  if (window === "month") {
    return clampRangeToDataStart(nzMonthRange(shiftMonth(period ?? nzMonthKey(anchor), -1)));
  }
  if (period) return clampRangeToDataStart(nzWeekRange(shiftWeek(period, -7)));
  // Step by service date rather than a fixed 7 * 24 h of milliseconds, which
  // lands an hour off the 4am boundary when the two windows straddle a DST switch.
  const prevDay = shiftWeek(nzServiceDayString(anchor), -7);
  return clampRangeToDataStart(nzLast7DaysRange(nzServiceDayRange(prevDay).start));
}
