// Repeat offenders on the day boards: how many days in a row a route has been
// on a board, and how many of those the board crowned it. Each earlier day is
// read through that board's own day reader, so a streak counts exactly what the
// board showed on those days, and a day board's cache serves both.
import { countBy } from "@/lib/collections";
import { TODAY_REVALIDATE } from "@/lib/data/revalidate";
import type { ShameFilter } from "@/lib/data/shame-filter";
import { getRouteBoardOfDay } from "@/lib/data/shame-routes";
import { getTripBoardOfDay } from "@/lib/data/shame-trips";
import { crownedRow } from "@/lib/page/shame";
import {
  type DateRange,
  nzServiceDayRange,
  nzServiceDayString,
  shiftDays,
} from "@/lib/time/service-day";

/** Which day board a streak is counted on. */
export type StreakBoard = "trip" | "route";

/** A route's run of days on a day board. */
export interface ShameStreak {
  /** Days in a row on the board, the shown day included (at least 1). */
  days: number;
  /** The route's hours on the board across the earlier days of that run. */
  prevHours: number;
  /** Days in a row, ending the day before, that the board crowned the route. */
  prevCrownedDays: number;
}

/** The furthest back a streak is followed, in earlier days. */
const STREAK_DAYS = 14;

/**
 * Earlier days read at once on a full walk. A cold day board is a full-day
 * scan (about half a second), so reading three together cuts a three-day walk
 * to one wait, at the cost of up to two days past where the walk stops.
 */
const STREAK_BATCH = 3;

/** As much of a day board's hour row as the walk reads; both boards' rows fit it. */
interface StreakHour {
  routeId: string;
  avg_abs_delay_sec: number;
}

/** Options for {@link getShameStreaks}. */
export interface StreakOptions {
  /**
   * Count only the crown run: stop at the first earlier day the board did not
   * crown any of the routes. `days` and `prevHours` then cover only that run,
   * so use it only where `prevCrownedDays` is all that is shown.
   */
  crownOnly?: boolean;
}

/**
 * Each route's streak on a day board, ending on the shown day. The shown day
 * counts as day 1 by definition: the caller passes the routes on that day's
 * board, and knows itself whether the route holds that day's crown.
 *
 * Walks back and stops once every route's run has broken, so a request reads
 * about as many days as the longest streak rather than the whole fortnight. A
 * full walk reads {@link STREAK_BATCH} days at a time; a crown-only walk reads one
 * at a time, since a crown run usually breaks on the first earlier day. A day
 * with nothing on the board (a gap in the data) ends every run rather than
 * being bridged. A crowned day is one the board crowned, by the same test it
 * crowns with ({@link crownedRow}), so a quiet day with nothing late enough to
 * crown breaks a crown run without breaking the board run.
 * @param board - The board the streak is counted on.
 * @param routeIds - The routes on the shown day's board.
 * @param range - The shown service day's window.
 * @param filter - The board's mode and school filter, as the page applies it.
 * @param options - See {@link StreakOptions}.
 * @returns Each route's streak, keyed by route id.
 */
export async function getShameStreaks(
  board: StreakBoard,
  routeIds: readonly string[],
  range: DateRange,
  filter: ShameFilter,
  options: StreakOptions = {},
): Promise<Map<string, ShameStreak>> {
  const readDay = board === "trip" ? getTripBoardOfDay : getRouteBoardOfDay;
  const batch = options.crownOnly ? 1 : STREAK_BATCH;
  const result = new Map<string, ShameStreak>(
    routeIds.map((id) => [id, { days: 1, prevHours: 0, prevCrownedDays: 0 }]),
  );
  // Routes whose run is unbroken so far, and those still on a crown run.
  let onBoard = new Set(routeIds);
  let crowned = new Set(routeIds);
  /**
   * Whether any run the walk is counting is still unbroken.
   * @returns True while there is a day worth reading.
   */
  const running = (): boolean => (options.crownOnly ? crowned.size : onBoard.size) > 0;
  // Step by date string, not 24h of milliseconds: a millisecond step drifts an
  // hour off the 4am boundary across a DST change and skips a day.
  const firstEarlier = shiftDays(nzServiceDayString(range.start), -1);
  walk: for (let d = 0; d < STREAK_DAYS && running(); d += batch) {
    const dates = Array.from({ length: Math.min(batch, STREAK_DAYS - d) }, (_, i) =>
      shiftDays(firstEarlier, -(d + i)),
    );
    const boards = await Promise.all(
      dates.map((date) => readDay(nzServiceDayRange(date), filter, TODAY_REVALIDATE)),
    );
    // Apply the batch's days newest first, stopping exactly where a one-day walk would.
    for (const board of boards) {
      const hours: StreakHour[] = board.hours;
      if (!running() || hours.length === 0) break walk;
      const hourCounts = countBy(hours, (h) => h.routeId);
      const crown = crownedRow(hours).row?.routeId;
      onBoard = new Set([...onBoard].filter((id) => hourCounts.has(id)));
      crowned = new Set([...crowned].filter((id) => onBoard.has(id) && id === crown));
      for (const id of onBoard) {
        const streak = result.get(id)!;
        streak.days++;
        streak.prevHours += hourCounts.get(id)!;
        if (crowned.has(id)) streak.prevCrownedDays++;
      }
    }
  }
  return result;
}
