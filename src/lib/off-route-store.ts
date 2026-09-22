// src/lib/off-route-store.ts
// The realtime ingest's off-route step: measure each in-progress vehicle against
// its trip's road path (lib/off-route.ts) and store the readings well off it.
// Best-effort by design - the caller catches any failure, so a shape load or an
// alerts outage never costs a poll its arrival events.

import type { AtTripUpdates } from "@/lib/at";
import {
  alertsForTrip,
  cleanAlertHeader,
  extractText,
  getServiceAlerts,
  REROUTE_EFFECTS,
  type ServiceAlert,
} from "@/lib/at-alerts";
import { getRouteModeMap } from "@/lib/data/routes";
import { DUPLICATE_KEY, prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { memCache } from "@/lib/mem-cache";
import {
  findOffRoute,
  inProgressTrips,
  shapePrefix,
  type OffRouteReading,
  type VehicleReading,
} from "@/lib/off-route";

/** A road path as stored, `[lon, lat]` pairs. */
type Path = [number, number][];

/**
 * Every stored shape by id and by trip-id prefix, held in process for six hours.
 * About a thousand shapes, loaded once per warm instance rather than per poll.
 * @returns The shape indexes.
 */
function shapeIndex(): Promise<{ byId: Map<string, Path>; byPrefix: Map<string, Path[]> }> {
  return memCache("off-route-shapes", 6 * 3600, async () => {
    const shapes = await prisma.shape.findMany({ select: { id: true, points: true } });
    const byId = new Map<string, Path>();
    const byPrefix = new Map<string, Path[]>();
    for (const s of shapes) {
      const path = s.points as unknown as Path;
      byId.set(s.id, path);
      const prefix = shapePrefix(s.id);
      if (prefix) byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), path]);
    }
    return { byId, byPrefix };
  });
}

/**
 * The header of an active reroute-type alert covering a trip, when one exists:
 * one on its route, or one naming the trip itself. A cancellation of another
 * run on the route does not explain this vehicle being off its path.
 * @param alerts - The active alerts.
 * @param routeId - The versioned route id the vehicle reports.
 * @param tripId - The trip the vehicle is running.
 * @returns The cleaned header, or null.
 */
function rerouteAlertFor(
  alerts: readonly ServiceAlert[],
  routeId: string,
  tripId: string,
): string | null {
  const alert = alertsForTrip(alerts, routeId, tripId).find(
    (a) => a.effect !== undefined && REROUTE_EFFECTS.has(a.effect),
  );
  const header = alert ? extractText(alert.header_text) : null;
  return header ? cleanAlertHeader(header) : null;
}

/**
 * Store this poll's off-route readings. Ferries are left out: a sailing's shape
 * is a rough line between wharves, so the boat is routinely hundreds of metres
 * from it. A trip is measured against its exact shape once the shapes sync has
 * stored `shapeId`, and against the shapes sharing its id prefix until then.
 * Alerts are only fetched when there is something to store.
 * @param readings - Vehicle positions on trips, from the vehicle feed.
 * @param feed - This poll's trip updates, to tell which trips are under way.
 * @returns How many new readings were stored.
 */
export async function recordOffRouteSightings(
  readings: readonly VehicleReading[],
  feed: AtTripUpdates,
): Promise<number> {
  const [modes, shapes] = await Promise.all([getRouteModeMap(), shapeIndex()]);
  const candidates = readings.filter((r) => modes.get(r.routeId) !== "FERRY");
  if (candidates.length === 0) return 0;
  const metas = await prisma.tripMeta.findMany({
    where: { id: { in: [...new Set(candidates.map((r) => r.tripId))] } },
    select: { id: true, shapeId: true },
  });
  const shapeIdByTrip = new Map(metas.map((m) => [m.id, m.shapeId]));

  /**
   * The candidate road paths for a trip: its exact shape when known, else the
   * shapes sharing its id prefix.
   * @param tripId - The trip.
   * @returns The paths, empty when none match.
   */
  const pathsFor = (tripId: string): Path[] => {
    const exact = shapes.byId.get(shapeIdByTrip.get(tripId) ?? "");
    if (exact) return [exact];
    return shapes.byPrefix.get(shapePrefix(tripId) ?? "") ?? [];
  };

  const now = Date.now() / 1000;
  const off: OffRouteReading[] = findOffRoute(
    candidates,
    inProgressTrips(feed, now),
    pathsFor,
    now,
  );
  if (off.length === 0) return 0;

  const alerts = await getServiceAlerts().catch((): ServiceAlert[] => []);
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      insert: "OffRouteSighting",
      documents: off.map((r) => {
        const alert = rerouteAlertFor(alerts, r.routeId, r.tripId);
        return {
          tripId: r.tripId,
          routeId: r.routeId,
          seenAt: { $date: new Date(r.timestamp * 1000).toISOString() },
          lat: r.lat,
          lon: r.lon,
          distanceM: r.distanceM,
          vehicleId: r.vehicleId,
          ...(alert ? { alert } : {}),
        };
      }),
      // The unique (trip, position time) key skips a position repeated across polls.
      ordered: false,
    }),
  )) as unknown as { n?: number };
  throwOnWriteErrors(res, [DUPLICATE_KEY], "OffRouteSighting insert");
  return res.n ?? 0;
}
