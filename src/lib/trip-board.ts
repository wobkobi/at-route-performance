// src/lib/trip-board.ts
// Row order for a route's "of the day" board: where cancelled trips sit among the
// running ones. A cancellation has a scheduled start but no delay, so it takes
// its place in departure order and falls below every ranked run on the delay
// sorts instead of pinning to the top of whichever sort is active.
import type { CancelledTripRow } from "@/lib/data/cancelled";
import type { TripSort } from "@/lib/data/trips";
import type { PerTripStat } from "@/types/api";

/** One row of the trip board: a ranked running trip or an unranked cancellation. */
export type TripBoardRow =
  { kind: "run"; trip: PerTripStat; rank: number } | { kind: "cancelled"; trip: CancelledTripRow };

/** A running-trip row of {@link TripBoardRow}. */
type RunRow = Extract<TripBoardRow, { kind: "run" }>;

/** GTFS `HH:MM:SS`; hours run past 23 for post-midnight trips. */
const GTFS_TIME_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;

/** Latest start a GTFS time can sensibly carry (48h covers any extended time). */
const MAX_GTFS_SEC = 48 * 3600;

/**
 * Seconds past the GTFS reference for a `HH:MM:SS` schedule time.
 * @param hms - GTFS time string, e.g. "07:30:00" or "24:15:00".
 * @returns The seconds, or null when the string is missing or malformed.
 */
export function gtfsTimeSeconds(hms: string | null | undefined): number | null {
  const m = hms ? GTFS_TIME_RE.exec(hms) : null;
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return sec < MAX_GTFS_SEC ? sec : null;
}

/**
 * Start seconds encoded in an AT trip id. AT ids read
 * `{block}-{service}-{startSeconds}-{variant}-{hash}` (e.g.
 * "1060-14804-82800-2-efb6f52a" starts at 23:00:00), with a sixth segment on
 * some. Only a fallback for cancellations recorded before ingest captured the
 * feed's own `start_time`.
 * @param tripId - AT GTFS trip id.
 * @returns The start in seconds past the GTFS reference, or null when the id has another shape.
 */
export function tripIdStartSeconds(tripId: string): number | null {
  const seg = tripId.split("-")[2];
  if (!seg || !/^\d+$/.test(seg)) return null;
  const sec = Number(seg);
  return sec < MAX_GTFS_SEC ? sec : null;
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
 * Lay out the board: running trips keep the order they arrive in and are ranked
 * 1..n, and cancellations join them. On the departure sort a cancellation slots
 * in at its scheduled start (following the reversed direction too); on the
 * delay sorts, where it has nothing to rank by, cancellations follow the last
 * run in departure order. A cancellation with no known start always goes last.
 * @param runs - The running trips, already in the active sort and direction.
 * @param cancelled - The day's cancelled trips, any order.
 * @param sort - The active ordering.
 * @param isReversed - Whether the active direction is reversed.
 * @returns The board rows in display order.
 */
export function buildTripBoardRows(
  runs: PerTripStat[],
  cancelled: CancelledTripRow[],
  sort: TripSort,
  isReversed: boolean,
): TripBoardRow[] {
  const ranked: RunRow[] = runs.map((trip, i) => ({ kind: "run", trip, rank: i + 1 }));
  const known = cancelled.filter((c) => c.scheduled_start !== null);
  const unknown = cancelled.filter((c) => c.scheduled_start === null);
  const direction = sort === "departure" && isReversed ? -1 : 1;
  known.sort((a, b) => direction * byStart(a.scheduled_start, b.scheduled_start));
  const tail: TripBoardRow[] = unknown.map((trip) => ({ kind: "cancelled", trip }));

  if (sort !== "departure") {
    return [
      ...ranked,
      ...known.map((trip): TripBoardRow => ({ kind: "cancelled", trip })),
      ...tail,
    ];
  }

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
  return [...out, ...tail];
}
