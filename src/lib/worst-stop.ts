// src/lib/worst-stop.ts
// Merge a stop ranking's platform rows into one row per station, and apply the
// floor a row has to clear before a place is named the worst of a day. Pure, so
// the rule is testable without the database; the aggregations that feed it live
// in src/lib/data/stops.ts.

import type { DelayDirection } from "@/lib/rankings";
import {
  stationId,
  stationNameOf,
  stationPartsOf,
  type StationParts,
  type StationRow,
} from "@/lib/station";
import type { WorstStop } from "@/types/dashboard";

/**
 * Fewest events - so, calling services - a stop needs before it can be named
 * the worst of a whole day. At a stop each calling trip contributes exactly one
 * event, so this reads directly as twenty services: a platform served three
 * times can average an extreme figure off noise, and naming a place for it is a
 * claim the sample does not support. The hourly board keeps its own, smaller
 * floor, because an hour cannot hold twenty.
 */
export const MIN_STOP_EVENTS = 20;

/** A per-stop row from a ranking aggregation, before platforms are merged. */
export interface RankedStopRow extends StationRow {
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  /** Route ids that served the stop, kept so a merged row can resolve its mode. */
  routeIds: string[];
}

/** One row per station, carrying the route ids of every platform merged into it. */
export type MergedStopRow = Omit<WorstStop, "mode"> & { routeIds: string[] };

/**
 * Merge each station's platform rows into one row, re-averaging both figures by
 * event weight, and sort worst-first. Mirrors {@link stationId} and
 * {@link stationNameOf} so a board row names the station a reader would name,
 * rather than one of its platforms competing with its siblings.
 * @param rows - Raw per-stop rows for a single day.
 * @returns One row per station, off-schedule magnitude descending.
 */
export function mergeStationPlatforms(rows: readonly RankedStopRow[]): MergedStopRow[] {
  const acc = new Map<
    string,
    {
      row: MergedStopRow;
      absSum: number;
      signedSum: number;
      routeIds: Set<string>;
      /** Every platform's name, so the station's own name does not depend on row order. */
      platforms: (StationParts & { name: string })[];
    }
  >();
  for (const r of rows) {
    const parts = stationPartsOf(r);
    const id = stationId(r.stop_id, r.name, parts);
    const absSum = r.avg_abs_delay_sec * r.events;
    const signedSum = (r.avg_delay_sec ?? 0) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.absSum += absSum;
      cur.signedSum += signedSum;
      cur.platforms.push({ ...parts, name: r.name });
      for (const routeId of r.routeIds) cur.routeIds.add(routeId);
    } else {
      acc.set(id, {
        row: {
          stop_id: id,
          name: r.name,
          events: r.events,
          avg_delay_sec: r.avg_delay_sec,
          avg_abs_delay_sec: r.avg_abs_delay_sec,
          routeIds: [],
        },
        absSum,
        signedSum,
        routeIds: new Set(r.routeIds),
        platforms: [{ ...parts, name: r.name }],
      });
    }
  }
  return [...acc.values()]
    .map(({ row, absSum, signedSum, routeIds, platforms }) => ({
      ...row,
      name: stationNameOf(platforms),
      routeIds: [...routeIds],
      avg_abs_delay_sec: Math.round((absSum / row.events) * 10) / 10,
      avg_delay_sec: Math.round((signedSum / row.events) * 10) / 10,
    }))
    .sort((a, b) => b.avg_abs_delay_sec - a.avg_abs_delay_sec);
}

/**
 * Whether a row belongs on a board narrowed to one direction. Tested on the
 * merged signed average, already rounded to the figure the row prints, so the
 * Late board cannot hold a station whose own row reads as on time. A station
 * whose platforms disagree is judged on the station's total, which is the number
 * the row shows.
 * @param row - A merged station row.
 * @param direction - The direction to keep, or null to keep both.
 * @returns True when the row belongs on that board.
 */
export function matchesDelayDirection(
  row: Pick<MergedStopRow, "avg_delay_sec">,
  direction: DelayDirection,
): boolean {
  if (direction === null) return true;
  const signed = row.avg_delay_sec ?? 0;
  return direction === "late" ? signed > 0 : signed < 0;
}

/** Which rows {@link worstStopOfDay} will consider. */
export interface WorstStopOptions {
  /** Fewest events a station needs to qualify (default {@link MIN_STOP_EVENTS}). */
  minEvents?: number;
  /** Keep only stations running late or early on average; null keeps both. */
  direction?: DelayDirection;
}

/**
 * The worst station in one day's rows. Platforms merge first and the floor
 * applies second, so a station clears it on all its platforms' services
 * together rather than on whichever platform happened to be busiest - and a
 * station cannot be named on one platform's thin sample while its own total was
 * ordinary. A direction filter runs after the merge for the same reason: a
 * station's direction is the one its merged row prints.
 * @param rows - Raw per-stop rows for a single day.
 * @param options - The floor and the direction to keep.
 * @returns The day's worst station, or null when none qualifies.
 */
export function worstStopOfDay(
  rows: readonly RankedStopRow[],
  options: WorstStopOptions = {},
): MergedStopRow | null {
  const { minEvents = MIN_STOP_EVENTS, direction = null } = options;
  return (
    mergeStationPlatforms(rows).find(
      (r) => r.events >= minEvents && matchesDelayDirection(r, direction),
    ) ?? null
  );
}
