// A route's recorded stop closures and detours for one day, read back from StopClosure for the
// route diagram (lib/strip-marks.ts places them) and for rule 26's filter, which keeps arrivals
// timed at a stop while it was closed out of its figures. The rows are only ever read here; a
// closure recorded by mistake costs nothing once it is corrected.
import { cachedForRange } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma, runCommand } from "@/lib/db";
import { closesStops, type DayClosure } from "@/lib/strip-marks";
import type { DateRange } from "@/lib/time";
import type { Prisma, StopClosure } from "@prisma/client";

/**
 * A stored row as the diagram reads it for one day: instants in epoch ms, which survive the
 * cache's JSON, the runs counted inside the day, and a trend or a dispute only once it was one by
 * the day's end.
 * @param row - The Prisma row.
 * @param range - The day.
 * @returns The closure.
 */
export function toDayClosure(row: StopClosure, range: DateRange): DayClosure {
  const start = range.start.getTime();
  const end = range.end.getTime();
  /**
   * Whether an instant fell before the day ended.
   * @param d - The instant, or null.
   * @returns True when it is set and inside or before the day.
   */
  const byEnd = (d: Date | null): boolean => d != null && d.getTime() < end;
  return {
    kind: row.kind as DayClosure["kind"],
    source: row.source as DayClosure["source"],
    directionId: row.directionId,
    stopIds: row.stopIds,
    fromStopId: row.fromStopId,
    toStopId: row.toStopId,
    alert: row.alert,
    runs: row.runs.filter((r) => r.at.getTime() >= start && r.at.getTime() < end).length,
    confirmed: byEnd(row.confirmedAt),
    disputed: byEnd(row.disputedAt),
    from: row.from.getTime(),
    to: row.to?.getTime() ?? null,
  };
}

/**
 * Rule 26's filter: a `$nor` over the arrivals timed at a stop while it was closed, each way it
 * was closed. A stop the diagram draws as one station (a train station's platforms, a busway
 * station's) closes as a whole, since the diagram marks the station, not the platform.
 * @param closures - The day's closures.
 * @param rawToCanon - Raw stop id > the station id the diagram draws it as.
 * @returns A `$match` stage body, or null when nothing was closed.
 */
export function closedArrivalsMatch(
  closures: readonly DayClosure[],
  rawToCanon: ReadonlyMap<string, string>,
): Prisma.InputJsonObject | null {
  const platforms = new Map<string, string[]>();
  for (const [raw, canon] of rawToCanon)
    platforms.set(canon, [...(platforms.get(canon) ?? []), raw]);
  const nor = closures.filter(closesStops).map((c) => {
    const ids = new Set<string>();
    for (const id of c.stopIds) {
      const canon = rawToCanon.get(id) ?? id;
      ids.add(id);
      for (const raw of platforms.get(canon) ?? []) ids.add(raw);
    }
    const actualAt: Record<string, { $date: string }> = {
      $gte: { $date: new Date(c.from).toISOString() },
    };
    if (c.to != null) actualAt.$lt = { $date: new Date(c.to).toISOString() };
    return {
      stopId: { $in: [...ids] },
      actualAt,
      ...(c.directionId == null ? {} : { "meta.directionId": c.directionId }),
    };
  });
  return nor.length > 0 ? { $nor: nor } : null;
}

/**
 * Read a route's closures that overlap a window, oldest first. Indexed on route and start, and a
 * route holds a handful a day.
 * @param routeIds - Every version's feed route id.
 * @param range - The window.
 * @returns The closures.
 */
export async function queryRouteClosures(
  routeIds: string[],
  range: DateRange,
): Promise<DayClosure[]> {
  const rows = await runCommand(() =>
    prisma.stopClosure.findMany({
      where: {
        routeId: { in: routeIds },
        from: { lt: range.end },
        OR: [{ to: null }, { to: { gt: range.start } }],
      },
      orderBy: { from: "asc" },
    }),
  );
  return rows.map((r) => toDayClosure(r, range));
}

/**
 * A route's closures for one day, cached like its other day figures: a finished day holds for a
 * week, today turns over with each ingest run.
 * @param slug - Route slug; every version's route id is read.
 * @param range - The day.
 * @returns The closures, for `stripMarks`.
 */
export function getRouteClosures(slug: string, range: DateRange): Promise<DayClosure[]> {
  return cachedForRange(
    async () => queryRouteClosures(await routeIdsForSlug(slug), range),
    ["route-closures", slug, range.start.toISOString(), range.end.toISOString()],
    range,
    300,
  );
}
