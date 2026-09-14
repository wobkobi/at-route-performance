// src/lib/rankings-page.ts
// Window, filter and href helpers for the rankings page. Ranges are anchored to
// the latest day with data rather than the wall clock, so a quiet "today" still
// opens on a populated period. The week view defaults to the rolling last 7
// days; an explicit `period` is a calendar week reached by stepping back. A
// matching previous range is resolved alongside each window so the table can
// show rank movement.
import { type DelayDirection } from "@/lib/rankings";
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
} from "@/lib/time";
import { buildHref } from "@/lib/utils";

/** Active rankings window. */
export type RankWindow = "week" | "month";
/** Active mode filter, or null for every mode. */
export type RankMode = "BUS" | "TRAIN" | "FERRY" | null;
/** The active mode / school / direction filters. */
export interface RankFilters {
  mode: string | null;
  school: boolean;
  dir: string | null;
}

/** Query params for the rankings page. */
export interface RankingsSearchParams {
  window?: string;
  period?: string;
  mode?: string;
  school?: string;
  dir?: string;
}

/** Parsed rankings params: validated controls plus the combined filter struct. */
export interface ParsedRankingsParams {
  window: RankWindow;
  mode: RankMode;
  dir: DelayDirection;
  includeSchool: boolean;
  filters: RankFilters;
}

/**
 * Parse and validate the rankings query params.
 * @param sp - The raw search params.
 * @returns The validated window/mode/direction plus the combined filters.
 */
export function parseRankingsParams(sp: RankingsSearchParams): ParsedRankingsParams {
  const window: RankWindow = sp.window === "month" ? "month" : "week";
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as RankMode;
  const dir = (["late", "early"].includes(sp.dir ?? "") ? sp.dir : null) as DelayDirection;
  const includeSchool = sp.school === "1";
  return {
    window,
    mode,
    dir,
    includeSchool,
    filters: { mode, school: includeSchool, dir },
  };
}

/**
 * Resolve the active range + label, anchored to the latest day with data so a
 * quiet "today" still shows a populated period. The week view opens on the
 * rolling last 7 days; an explicit `period` is a calendar week (reached by
 * stepping back). Month defaults to the anchor's calendar month.
 * @param window - "week" or "month".
 * @param period - Explicit period (`YYYY-MM-DD` Monday or `YYYY-MM`), optional.
 * @param anchor - The latest day with data (or now).
 * @returns The range and a human label.
 */
export function resolveRange(
  window: RankWindow,
  period: string | undefined,
  anchor: Date,
): { range: DateRange; label: string } {
  if (window === "month") {
    const range = nzMonthRange(period ?? nzMonthKey(anchor));
    return { range, label: monthRangeLabel(range) };
  }
  if (period) {
    const range = nzWeekRange(period);
    return { range, label: weekRangeLabel(range) };
  }
  return { range: nzLast7DaysRange(anchor), label: "Last 7 days" };
}

/**
 * Range for the period immediately before the given window/period, used for
 * rank-movement comparison.
 * @param window - "week" or "month".
 * @param period - Explicit period key, or undefined for the rolling default.
 * @param anchor - Latest day with data.
 * @returns The previous period's half-open date range.
 */
export function resolvePrevRange(
  window: RankWindow,
  period: string | undefined,
  anchor: Date,
): DateRange {
  if (window === "month") {
    return nzMonthRange(shiftMonth(period ?? nzMonthKey(anchor), -1));
  }
  if (period) return nzWeekRange(shiftWeek(period, -7));
  // Step by service date rather than a fixed 7 * 24 h of milliseconds, which
  // lands an hour off the 5am boundary when the two windows straddle a DST switch.
  const prevDay = shiftWeek(nzServiceDayString(anchor), -7);
  return nzLast7DaysRange(nzServiceDayRange(prevDay).start);
}

/**
 * Build a rankings URL for a window/period, preserving the active filters.
 * @param window - The window.
 * @param period - The period (Monday `YYYY-MM-DD`), or null for the rolling default.
 * @param filters - The active mode / school / direction filters.
 * @returns The href.
 */
export function rankHref(window: RankWindow, period: string | null, filters: RankFilters): string {
  return buildHref("/rankings", {
    window,
    period: period ?? undefined,
    mode: filters.mode ?? undefined,
    school: filters.school ? "1" : undefined,
    dir: filters.dir ?? undefined,
  });
}
