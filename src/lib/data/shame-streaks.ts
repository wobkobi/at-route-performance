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
 * Each route's streak on a day board, ending on the shown day. The shown day
 * counts as day 1 by definition: the caller passes the routes on that day's
 * board, and knows itself whether the route holds that day's crown.
 *
 * Walks back a day at a time and stops once every route's run has broken, so a
 * request reads as many days as the longest streak rather than the whole
 * fortnight. A day with nothing on the board (a gap in the data) ends every run
 * rather than being bridged. A crowned day is one the board crowned, by the
 * same test it crowns with ({@link crownedRow}), so a quiet day with nothing
 * late enough to crown breaks a crown run without breaking the board run.
 * @param board - The board the streak is counted on.
 * @param routeIds - The routes on the shown day's board.
 * @param range - The shown service day's window.
 * @param filter - The board's mode and school filter, as the page applies it.
 * @returns Each route's streak, keyed by route id.
 */
export async function getShameStreaks(
  board: StreakBoard,
  routeIds: readonly string[],
  range: DateRange,
  filter: ShameFilter,
): Promise<Map<string, ShameStreak>> {
  const readDay = board === "trip" ? getTripBoardOfDay : getRouteBoardOfDay;
  const result = new Map<string, ShameStreak>(
    routeIds.map((id) => [id, { days: 1, prevHours: 0, prevCrownedDays: 0 }]),
  );
  // Routes whose run is unbroken so far, and those still on a crown run.
  let onBoard = new Set(routeIds);
  let crowned = new Set(routeIds);
  // Step by date string, not 24h of milliseconds: a millisecond step drifts an
  // hour off the 4am boundary across a DST change and skips a day.
  let date = shiftDays(nzServiceDayString(range.start), -1);
  for (let d = 0; d < STREAK_DAYS && onBoard.size > 0; d++) {
    const hours: { routeId: string; avg_abs_delay_sec: number }[] = (
      await readDay(nzServiceDayRange(date), filter, TODAY_REVALIDATE)
    ).hours;
    if (hours.length === 0) break;
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
    date = shiftDays(date, -1);
  }
  return result;
}
