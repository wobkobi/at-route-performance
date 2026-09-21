// src/lib/stop-sums.ts
// Per-stop deviation sums for one service day, and the merge that ranks a
// multi-day window from them without scanning the window's raw arrivals.

/**
 * One stop's figures for one service day, kept as sums so days add exactly: an
 * average of daily averages would weight a quiet day like a busy one. Short
 * keys because a day holds ~5,500 stops (~490KB) and the Data Cache refuses an
 * entry over 2MB.
 */
export interface StopDaySum {
  /** Stop id. */
  s: string;
  /** Arrivals. */
  e: number;
  /** Sum of signed deviation, seconds. */
  d: number;
  /** Sum of absolute deviation, seconds. */
  a: number;
  /** Route ids that served the stop that day. */
  r: string[];
}

/** One stop's figures over a whole window. */
export interface StopSum {
  stopId: string;
  events: number;
  signedSum: number;
  absSum: number;
  routeIds: string[];
}

/**
 * Add the days' per-stop sums into one row per stop, taking the union of the
 * routes that served it.
 * @param days - Each day's rows.
 * @returns One row per stop, in no particular order.
 */
export function mergeStopDays(days: readonly (readonly StopDaySum[])[]): StopSum[] {
  const acc = new Map<string, { sum: StopSum; routes: Set<string> }>();
  for (const day of days) {
    for (const r of day) {
      const cur = acc.get(r.s);
      if (cur) {
        cur.sum.events += r.e;
        cur.sum.signedSum += r.d;
        cur.sum.absSum += r.a;
        for (const id of r.r) cur.routes.add(id);
      } else {
        acc.set(r.s, {
          sum: { stopId: r.s, events: r.e, signedSum: r.d, absSum: r.a, routeIds: [] },
          routes: new Set(r.r),
        });
      }
    }
  }
  return [...acc.values()].map(({ sum, routes }) => ({ ...sum, routeIds: [...routes] }));
}

/**
 * The stops with at least `minEvents` arrivals, furthest off schedule on
 * average first: the same filter and order the single-window pipeline applies
 * before its platform collapse.
 * @param sums - Merged per-stop rows.
 * @param minEvents - Fewest arrivals a stop needs to rank.
 * @param limit - How many to keep.
 * @returns The top rows.
 */
export function rankStopSums(
  sums: readonly StopSum[],
  minEvents: number,
  limit: number,
): StopSum[] {
  return sums
    .filter((s) => s.events >= minEvents)
    .sort((a, b) => b.absSum / b.events - a.absSum / a.events)
    .slice(0, limit);
}
