// src/lib/shame-page.ts
// Shared filters, cache settings and query helpers for the shame
// board pages. Parses the mode/school query params into the filter every board
// shares and the derived view state (week flag, preserved nav params, subtitle).
// A worst entry is only crowned when its average absolute deviation clears the
// on-time late bound, so quiet days where everything sits within the window
// crown nothing.
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { type DelayDirection, parseDelayDirection } from "@/lib/rankings";
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
  includeSchool: boolean;
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

/** Which board view is active: the hourly day board or a per-day range board. */
export type ShameView = "day" | "week" | "month";

/** Parsed shame-page params: the active filter plus its derived view state. */
export interface ParsedShameParams {
  mode: ShameMode;
  includeSchool: boolean;
  direction: DelayDirection;
  filter: ShameFilter;
  view: ShameView;
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
  const includeSchool = sp.school === "1";
  const direction = parseDelayDirection(sp.dir);
  const subtitle = mode
    ? (MODE_LABEL[mode] ?? mode)
    : includeSchool
      ? "All services"
      : "Buses, trains & ferries";
  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  if (includeSchool) preserved.school = "1";
  if (direction) preserved.dir = direction;
  const view: ShameView = sp.window === "week" ? "week" : sp.window === "month" ? "month" : "day";
  return {
    mode,
    includeSchool,
    direction,
    filter: { mode, includeSchool, direction },
    view,
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
 * @param filter - Active mode/school filter.
 * @returns The href.
 */
export function buildShameHref(
  base: string,
  nav: { window?: string; period?: string; day?: string },
  filter: ShameFilter,
): string {
  return buildHref(base, {
    window: nav.window,
    period: nav.period,
    day: nav.day,
    mode: filter.mode,
    school: filter.includeSchool ? "1" : undefined,
  });
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
