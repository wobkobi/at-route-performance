// src/lib/page/shame.ts
// Shared filters, cache settings and query helpers for the shame
// board pages. Parses the mode/school query params into the filter every board
// shares and the derived view state (week flag, preserved nav params, subtitle).
// A worst entry is only crowned when its average absolute deviation clears the
// on-time late bound, so quiet days where everything sits within the window
// crown nothing.
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { type DelayDirection, parseDelayDirection } from "@/lib/rankings";
import { parseSchoolFilter, type SchoolFilter, schoolFilterParam } from "@/lib/school-bus";
import { SERVICE_START_HOUR } from "@/lib/time/service-day";
import {
  type HourRange,
  hourRangeLabel,
  hourRangeParam,
  parseHourRange,
  singleHourRange,
} from "@/lib/time/time-of-day";
import { buildHref } from "@/lib/utils";

/** Cache TTL for the week boards (seconds). */
export const WEEK_REVALIDATE = 3600;
/**
 * Rows per column the day-board skeleton draws. The real board lists every
 * started hour of the service day, so a past day fills 12 rows per column.
 */
export const ITEMS_PER_COL = 12;

/** A transport mode the boards can filter by, or null for every mode. */
export type ShameMode = "BUS" | "TRAIN" | "FERRY" | null;

/**
 * Active filter shared by every shame board query. `direction` is read by the
 * stop board alone; the trip and route boards take the same object and ignore it.
 */
export interface ShameFilter {
  mode: ShameMode;
  schools: SchoolFilter;
  direction: DelayDirection;
}

/** Query params accepted by every shame board page. */
export interface ShameSearchParams {
  day?: string;
  mode?: string;
  school?: string;
  window?: string;
  period?: string;
  dir?: string;
  /**
   * Part of the day to rank on the day board (`7-9`, see src/lib/time/time-of-day.ts),
   * or `all` for the whole service day.
   */
  hours?: string;
}

/**
 * Every param the boards read in common, so `/shame` can carry exactly these
 * across and leave a previous page's sort and search behind. Keep it in step
 * with {@link ShameSearchParams}: a param missing here is one the redirect drops.
 *
 * `dir` is missing on purpose. `/shame` lands on the trips board, which ranks
 * whole runs and has no direction to narrow, so carrying it would put a param on
 * a page that cannot act on it - the same reason `site-nav.ts` leaves `dir`
 * behind between sections.
 */
export const SHAME_PARAMS = [
  "day",
  "mode",
  "school",
  "window",
  "period",
  "hours",
] as const satisfies ReadonlyArray<keyof ShameSearchParams>;

/** Human label for an active mode filter, used in the page subtitle. */
export const MODE_LABEL: Record<string, string> = {
  BUS: "Buses",
  TRAIN: "Trains",
  FERRY: "Ferries",
};

/**
 * Human label for an active direction filter, for the subtitle. "Only" is the
 * word that does the work: without it the subtitle would read as a description
 * of what the board found rather than of what it was asked for.
 */
export const DIRECTION_LABEL: Record<"late" | "early", string> = {
  late: "Late only",
  early: "Early only",
};

/**
 * Append the active direction to a board's subtitle. Only the board carrying the
 * switch calls this: the trips and routes boards read the same params through
 * {@link parseShameParams} but rank whole runs and whole routes, so naming a
 * direction there would describe a narrowing that was never applied.
 * @param subtitle - The subtitle {@link parseShameParams} composed.
 * @param direction - The active direction, or null for both.
 * @returns The subtitle, with the direction named when one is set.
 */
export function subtitleWithDirection(subtitle: string, direction: DelayDirection): string {
  return direction ? `${subtitle} · ${DIRECTION_LABEL[direction]}` : subtitle;
}

/** The `hours` param naming the whole service day on a day board. */
export const WHOLE_DAY_PARAM = "all";

/**
 * The whole 4am-to-4am service day as a range, for the ranked list a week or
 * month row opens. The route page and the time-of-day filters refuse a range
 * with the same hour at both ends, so this lives here, behind its own `all`
 * param, and never reaches them.
 */
export const WHOLE_DAY: HourRange = { from: SERVICE_START_HOUR, to: SERVICE_START_HOUR };

/**
 * Whether a range is {@link WHOLE_DAY}.
 * @param hours - The range.
 * @returns True for the whole service day.
 */
export function isWholeDay(hours: HourRange): boolean {
  return hours.from === hours.to;
}

/**
 * The `hours` param for a board link, `all` for {@link WHOLE_DAY}.
 * @param hours - The range, or null for the hourly board.
 * @returns The param value, or undefined to leave it off.
 */
export function shameHoursParam(hours: HourRange | null): string | undefined {
  return hours && isWholeDay(hours) ? WHOLE_DAY_PARAM : hourRangeParam(hours);
}

/**
 * A ranked list's part of the day in a heading: "8am hour", "Morning peak" or
 * "whole day".
 * @param hours - The range.
 * @returns The label.
 */
export function shameHoursLabel(hours: HourRange): string {
  return isWholeDay(hours) ? "whole day" : hourRangeLabel(hours);
}

/** Which board view is active: the hourly day board or a per-day range board. */
export type ShameView = "day" | "week" | "month";

/** Parsed shame-page params: the active filter plus its derived view state. */
export interface ParsedShameParams {
  mode: ShameMode;
  schools: SchoolFilter;
  direction: DelayDirection;
  filter: ShameFilter;
  view: ShameView;
  /**
   * The part of the day the day board ranks, or null for its hourly board;
   * {@link WHOLE_DAY} for a day opened from a week or month row. Always null off
   * the day view: the week and month boards have no hours.
   */
  hours: HourRange | null;
  /** Params to preserve on `DayNav` links (mode, school and direction). */
  preserved: Record<string, string>;
  /** Subtitle describing the active filter ("Buses" / "All services" / …). */
  subtitle: string;
}

/**
 * Parse and validate the shame-page query params into the active filter and the
 * derived view state shared by all three boards. The subtitle names every active
 * narrowing, so a reader who arrives on a filtered link can see what is being
 * left out without reading the URL.
 * @param sp - The raw search params.
 * @returns The filter, active view, preserved params, and subtitle.
 */
export function parseShameParams(sp: ShameSearchParams): ParsedShameParams {
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as ShameMode;
  const schools = parseSchoolFilter(sp.school);
  const direction = parseDelayDirection(sp.dir);
  const subtitle =
    schools === "only"
      ? "School buses"
      : mode
        ? (MODE_LABEL[mode] ?? mode)
        : schools === "include"
          ? "All services"
          : "Buses, trains & ferries";
  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  const schoolParam = schoolFilterParam(schools);
  if (schoolParam) preserved.school = schoolParam;
  if (direction) preserved.dir = direction;
  const view: ShameView = sp.window === "week" ? "week" : sp.window === "month" ? "month" : "day";
  const hours =
    view !== "day" ? null : sp.hours === WHOLE_DAY_PARAM ? WHOLE_DAY : parseHourRange(sp.hours);
  return {
    mode,
    schools,
    direction,
    filter: { mode, schools, direction },
    view,
    hours,
    preserved,
    subtitle,
  };
}

/**
 * Build a shame-board URL, preserving the active mode/school filter params.
 * @param base - Base path (e.g. "/shame/trip").
 * @param nav - Window/period/day params to include.
 * @param nav.window - `week` when in week view.
 * @param nav.period - ISO week-start date when `window` is `week`.
 * @param nav.day - ISO service date for past-day day-view links.
 * @param nav.hours - Part of the day the day board ranks, or null/undefined for every hour.
 * @param filter - Active mode/school filter.
 * @param extra - Further params for the one board that reads them (the stop
 *   board's `dir`); undefined values are left off.
 * @returns The href.
 */
export function buildShameHref(
  base: string,
  nav: { window?: string; period?: string; day?: string; hours?: HourRange | null },
  filter: ShameFilter,
  extra: Record<string, string | undefined> = {},
): string {
  return buildHref(base, {
    ...extra,
    window: nav.window,
    period: nav.period,
    day: nav.day,
    hours: shameHoursParam(nav.hours ?? null),
    mode: filter.mode,
    school: schoolFilterParam(filter.schools),
  });
}

/**
 * How a ranked board's copy names its part of the day, after "runs starting".
 * @param hours - The part of the day.
 * @returns "in this hour" for a single hour, "that day" for the whole day, else "in these hours".
 */
export function hoursNoun(hours: HourRange): string {
  if (isWholeDay(hours)) return "that day";
  return (hours.from + 1) % 24 === hours.to ? "in this hour" : "in these hours";
}

/**
 * A ranked board's empty state when none of its hours has started yet today.
 * @param hours - The part of the day.
 * @returns The message.
 */
export function notStartedMessage(hours: HourRange): string {
  if (isWholeDay(hours)) return "This day has not started yet.";
  return hoursNoun(hours) === "in this hour"
    ? "This hour has not started yet."
    : "These hours have not started yet.";
}

/**
 * The link an hourly board's hour opens: the same board, ranked in full for that hour.
 * @param base - The board's path.
 * @param day - The shown day's param, or undefined for today.
 * @param hour - Auckland clock hour, 0-23.
 * @param filter - Active mode/school filter.
 * @param extra - Further params the board reads (see {@link buildShameHref}).
 * @returns The href.
 */
export function shameHourHref(
  base: string,
  day: string | undefined,
  hour: number,
  filter: ShameFilter,
  extra: Record<string, string | undefined> = {},
): string {
  return buildShameHref(base, { day, hours: singleHourRange(hour) }, filter, extra);
}

/**
 * The link a week or month board's day opens: the same board's day view, ranked
 * over that whole day.
 * @param base - The board's path.
 * @param day - The day's param, or undefined for today.
 * @param filter - Active mode/school filter.
 * @param extra - Further params the board reads (see {@link buildShameHref}).
 * @returns The href.
 */
export function shameDayListHref(
  base: string,
  day: string | undefined,
  filter: ShameFilter,
  extra: Record<string, string | undefined> = {},
): string {
  return buildShameHref(base, { day, hours: WHOLE_DAY }, filter, extra);
}

/**
 * The most off-schedule entry of a list (highest average absolute deviation).
 * @param rows - The candidate rows (hours or days).
 * @returns The worst row, or null when the list is empty.
 */
export function pickWorst<H extends { avg_abs_delay_sec: number }>(rows: H[]): H | null {
  return rows.reduce<H | null>(
    (worst, row) =>
      worst == null || row.avg_abs_delay_sec > worst.avg_abs_delay_sec ? row : worst,
    null,
  );
}

/**
 * Whether the worst row is bad enough to crown - its average absolute deviation
 * is beyond the on-time late bound. On quiet days every entry is within the
 * on-time window, so nothing is crowned.
 * @param worst - The worst row, or null.
 * @returns True when the row clears the on-time late threshold.
 */
export function isCrownable(worst: { avg_abs_delay_sec: number } | null): boolean {
  return worst != null && worst.avg_abs_delay_sec > ON_TIME_LATE_SEC;
}

/** What a board crowns, for the home card that names the same thing. */
export interface CrownedRow<T> {
  /** The crowned row, or null when nothing was bad enough to crown. */
  row: T | null;
  /**
   * Whether the board ranked anything at all, which keeps "nothing was bad" and
   * "nothing recorded" apart on the card.
   */
  ranked: boolean;
}

/**
 * The row a day board crowns, from the rows it shows: its worst, and only when
 * that clears the late bound, which is the test the board's own badge uses. A
 * home card takes its subject from here so it never names a run, route or stop
 * the board it opens does not crown.
 * @param rows - The rows the board shows (past `filterLiveHours` on a live day).
 * @returns The crowned row and whether anything ranked.
 */
export function crownedRow<T extends { avg_abs_delay_sec: number }>(rows: T[]): CrownedRow<T> {
  const worst = pickWorst(rows);
  return { row: isCrownable(worst) ? worst : null, ranked: rows.length > 0 };
}

/**
 * The row a part-of-day board crowns, from its ranked list: the first row, which
 * the query sorted worst first, and only when it clears the late bound. The
 * boards test `rows[0]` rather than re-picking, so a tie on the rounded figure
 * crowns the same row here as there.
 * @param rows - The board's ranked rows, worst first.
 * @returns The crowned row and whether anything ranked.
 */
export function crownedTop<T extends { avg_abs_delay_sec: number }>(rows: T[]): CrownedRow<T> {
  const top = rows[0] ?? null;
  return { row: isCrownable(top) ? top : null, ranked: rows.length > 0 };
}

/**
 * Count rows by a derived key (e.g. how many hourly slots a route appears in).
 * @param rows - The rows to tally.
 * @param keyOf - Derives the grouping key for a row.
 * @returns A map of key to occurrence count.
 */
export function countById<T>(rows: T[], keyOf: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
