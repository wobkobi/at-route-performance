// src/lib/trip-board.ts
// Row order for a route's "of the day" board: where cancelled trips sit among the
// running ones. A cancellation takes its place in departure order on the
// departure sort. On the delay sorts it ranks among the runs by the wait a rider
// had for the next trip (lib/rider-wait.ts), and one whose wait cannot be told
// falls below every ranked run rather than pinning to the top. A trip that
// recorded arrivals and was also flagged (cut short mid-trip, or cancelled and
// then reinstated) stays one ranked run carrying its stage, not a run plus a
// separate cancelled row.
import type { CancellationStage } from "@/lib/cancellation";
import type { CancelledTripRow } from "@/lib/data/cancelled";
import type { TripSort } from "@/lib/data/trips";
import type { PerTripStat } from "@/types/api";

/**
 * One row of the trip board: a ranked running trip (with its cancellation stage
 * when AT also flagged it) or a cancellation that recorded nothing, ranked by its
 * wait on the delay sorts when that is known.
 */
export type TripBoardRow =
  | { kind: "run"; trip: PerTripStat; rank: number; cancellation: CancellationStage | null }
  | {
      kind: "cancelled";
      trip: CancelledTripRow;
      /** Rank among the runs on a delay sort, when the wait for the next trip is known. */
      rank?: number;
      /** Seconds a rider waited for the next trip, when known. */
      waitSec?: number;
    };

/** A running-trip row of {@link TripBoardRow}. */
type RunRow = Extract<TripBoardRow, { kind: "run" }>;

/**
 * The route page params that say how its trip board is being read: the travel
 * direction, the part of the day, the on-time threshold, and the board's sort,
 * sort direction and page. A run's link carries them and the trip page's back
 * link hands them back, so returning from a run lands on the board as it was
 * left. Every param the route page narrows the board with belongs here; `hours`
 * narrows which runs are listed, so leaving it out returned the reader to an
 * all-day board and gave the trip page an all-day route to describe.
 */
export const TRIP_BOARD_VIEW_PARAMS = [
  "dir",
  "hours",
  "thresholdSec",
  "tsort",
  "trev",
  "tpage",
] as const;

/**
 * The trip board's view params that are set in a query, and nothing else.
 * @param params - Query params, as a page receives them.
 * @returns The set board params.
 */
export function tripBoardView(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const view: Record<string, string> = {};
  for (const key of TRIP_BOARD_VIEW_PARAMS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") view[key] = value;
  }
  return view;
}

/**
 * Compare two optional ISO instants, earliest first, with unknown times last.
 * @param a - First instant, or null.
 * @param b - Second instant, or null.
 * @returns Negative when `a` sorts first, positive when `b` does.
 */
function byStart(a: string | null, b: string | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return Date.parse(a) - Date.parse(b);
}

/**
 * The value a delay sort orders a run by: its average off-schedule on "off", its
 * signed average delay on "late" and "early".
 * @param trip - The run.
 * @param sort - A delay sort.
 * @returns The value, or null when the run has none.
 */
export function runSortValue(
  trip: PerTripStat,
  sort: Exclude<TripSort, "departure">,
): number | null {
  if (sort === "off") return trip.avg_abs_delay_sec;
  return trip.avg_delay_sec;
}

/**
 * Order runs for a delay sort, runs without a value last. "off" and "late" put
 * the largest first and "early" the smallest; reversing flips it. Runs on the
 * same average fall back to departure order and then to trip id, matching the
 * query's own tie-break so the board is the same board on every request.
 * @param runs - The runs.
 * @param sort - A delay sort.
 * @param isReversed - Whether the direction is reversed.
 * @returns A sorted copy.
 */
export function sortRuns(
  runs: readonly PerTripStat[],
  sort: Exclude<TripSort, "departure">,
  isReversed: boolean,
): PerTripStat[] {
  const sign = (sort === "early" ? 1 : -1) * (isReversed ? -1 : 1);
  return [...runs].sort((a, b) => {
    const va = runSortValue(a, sort);
    const vb = runSortValue(b, sort);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
    if (va !== vb) return sign * (va - vb);
    return byStart(a.scheduled_start, b.scheduled_start) || a.trip_id.localeCompare(b.trip_id);
  });
}

/**
 * Lay out the board: running trips keep the order they arrive in, and
 * cancellations join them. On the departure sort a cancellation slots in at its
 * scheduled start (following the reversed direction too), unranked. On the
 * delay sorts a cancellation with a known wait for the next trip ranks among the
 * runs as a delay of that wait (see lib/rider-wait.ts); one without follows the
 * last run in departure order, unranked. A cancellation with no known start
 * always goes last. A cancellation whose trip is also among the runs is folded
 * into that run.
 * @param runs - The running trips, already in the active sort and direction.
 * @param cancelled - The day's cancelled trips, any order.
 * @param sort - The active ordering.
 * @param isReversed - Whether the active direction is reversed.
 * @param waits - Seconds a rider waited for the next trip, by cancelled trip id.
 * @returns The board rows in display order.
 */
export function buildTripBoardRows(
  runs: PerTripStat[],
  cancelled: CancelledTripRow[],
  sort: TripSort,
  isReversed: boolean,
  waits: Readonly<Record<string, number>> = {},
): TripBoardRow[] {
  const stageByTrip = new Map(cancelled.map((c) => [c.trip_id, c.stage]));
  // A flagged trip that never ran can still appear among the runs through a
  // leftover first-stop prediction; it belongs with the cancellations.
  const kept = runs.filter((trip) => stageByTrip.get(trip.trip_id) !== "before");
  const keptIds = new Set(kept.map((r) => r.trip_id));
  const unran = cancelled.filter((c) => !keptIds.has(c.trip_id));
  /**
   * A run's board row.
   * @param trip - The run.
   * @param rank - Its rank.
   * @returns The row.
   */
  const runRow = (trip: PerTripStat, rank: number): RunRow => ({
    kind: "run",
    trip,
    rank,
    cancellation: stageByTrip.get(trip.trip_id) ?? null,
  });

  if (sort !== "departure") {
    // Cancellations with a wait merge in by value, runs keeping their order: a
    // cancellation goes ahead of the first run it outranks.
    const desc = (sort === "early") === isReversed;
    const waited = unran
      .filter((c) => waits[c.trip_id] !== undefined)
      .sort((a, b) => (desc ? -1 : 1) * ((waits[a.trip_id] ?? 0) - (waits[b.trip_id] ?? 0)));
    const rest = unran
      .filter((c) => waits[c.trip_id] === undefined)
      .sort((a, b) => byStart(a.scheduled_start, b.scheduled_start));
    const out: TripBoardRow[] = [];
    let c = 0;
    /**
     * Whether a wait ranks ahead of a run's value.
     * @param wait - The cancellation's wait.
     * @param value - The run's value, or null.
     * @returns True when the cancellation goes first.
     */
    const ahead = (wait: number, value: number | null): boolean =>
      value === null || (desc ? wait >= value : wait <= value);
    for (const trip of kept) {
      while (c < waited.length && ahead(waits[waited[c]!.trip_id] ?? 0, runSortValue(trip, sort))) {
        const w = waited[c++]!;
        out.push({ kind: "cancelled", trip: w, rank: out.length + 1, waitSec: waits[w.trip_id] });
      }
      out.push(runRow(trip, out.length + 1));
    }
    for (; c < waited.length; c++) {
      const w = waited[c]!;
      out.push({ kind: "cancelled", trip: w, rank: out.length + 1, waitSec: waits[w.trip_id] });
    }
    return [...out, ...rest.map((trip): TripBoardRow => ({ kind: "cancelled", trip }))];
  }

  const ranked = kept.map((trip, i) => runRow(trip, i + 1));
  const known = unran.filter((c) => c.scheduled_start !== null);
  const unknown = unran.filter((c) => c.scheduled_start === null);
  const direction = isReversed ? -1 : 1;
  known.sort((a, b) => direction * byStart(a.scheduled_start, b.scheduled_start));

  // Two-way merge of lists already sorted in the same direction. A cancellation
  // due at the same instant as a run goes first.
  const out: TripBoardRow[] = [];
  let c = 0;
  for (const row of ranked) {
    const start = row.trip.scheduled_start;
    while (c < known.length && direction * byStart(known[c]!.scheduled_start, start) <= 0) {
      out.push({ kind: "cancelled", trip: known[c++]! });
    }
    out.push(row);
  }
  for (; c < known.length; c++) out.push({ kind: "cancelled", trip: known[c]! });
  return [...out, ...unknown.map((trip): TripBoardRow => ({ kind: "cancelled", trip }))];
}
