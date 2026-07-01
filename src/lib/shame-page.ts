// src/lib/shame-page.ts
/**
 * @description Shared filters, cache settings and query helpers for the shame
 * board pages. Parses the mode/school query params into the filter every board
 * shares and the derived view state (week flag, preserved nav params, subtitle).
 * A worst entry is only crowned when its average absolute deviation clears the
 * on-time late bound, so quiet days where everything sits within the window
 * crown nothing.
 */
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { buildHref } from "@/lib/utils";

/** Cache TTL for the live day boards (seconds). */
export const TODAY_REVALIDATE = 300;
/** Cache TTL for the week boards (seconds). */
export const WEEK_REVALIDATE = 3600;
/** Rows per column in the desktop two-column board grid. */
export const ITEMS_PER_COL = 10;

/** A transport mode the boards can filter by, or null for every mode. */
export type ShameMode = "BUS" | "TRAIN" | "FERRY" | null;

/** Active mode/school filter shared by every shame board query. */
export interface ShameFilter {
  mode: ShameMode;
  includeSchool: boolean;
}

/** Query params accepted by every shame board page. */
export interface ShameSearchParams {
  day?: string;
  mode?: string;
  school?: string;
  window?: string;
  period?: string;
}

/** Human label for an active mode filter, used in the page subtitle. */
export const MODE_LABEL: Record<string, string> = {
  BUS: "Buses",
  TRAIN: "Trains",
  FERRY: "Ferries",
};

/** Parsed shame-page params: the active filter plus its derived view state. */
export interface ParsedShameParams {
  mode: ShameMode;
  includeSchool: boolean;
  filter: ShameFilter;
  isWeekView: boolean;
  /** Params to preserve on `DayNav` links (mode/school only). */
  preserved: Record<string, string>;
  /** Subtitle describing the active filter ("Buses" / "All services" / …). */
  subtitle: string;
}

/**
 * Parse and validate the shame-page query params into the active filter and the
 * derived view state shared by all three boards.
 * @param sp - The raw search params.
 * @returns The mode/school filter, week-view flag, preserved params, and subtitle.
 */
export function parseShameParams(sp: ShameSearchParams): ParsedShameParams {
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as ShameMode;
  const includeSchool = sp.school === "1";
  const subtitle = mode
    ? MODE_LABEL[mode]
    : includeSchool
      ? "All services"
      : "Buses, trains & ferries";
  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  if (includeSchool) preserved.school = "1";
  return {
    mode,
    includeSchool,
    filter: { mode, includeSchool },
    isWeekView: sp.window === "week",
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
