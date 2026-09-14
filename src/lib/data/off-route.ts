// src/lib/data/off-route.ts
// Detours read back: the stored off-route readings, kept only where the trip's
// own arrivals bracket them (see confirmedDetour in lib/off-route.ts).
import { cachedForRange } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma } from "@/lib/db";
import { confirmedDetour, MIN_SIGHTINGS, type Sighting } from "@/lib/off-route";
import type { DateRange } from "@/lib/time";

/** A trip that left its route, for the trip page. */
export interface TripDetour {
  /** The confirming readings, in time order. */
  sightings: Sighting[];
  /** An active reroute alert on the route while it was off, when AT published one. */
  alert: string | null;
}

/**
 * The real (non-ghost) arrival instants of some trips in a window, per trip.
 * @param tripIds - The trips.
 * @param range - The window.
 * @returns Trip id to ISO arrival instants.
 */
async function arrivalsByTrip(tripIds: string[], range: DateRange): Promise<Map<string, string[]>> {
  const events = await prisma.arrivalEvent.findMany({
    where: { tripId: { in: tripIds }, scheduledAt: { gte: range.start, lt: range.end } },
    select: { tripId: true, actualAt: true, ghost: true },
  });
  const out = new Map<string, string[]>();
  for (const e of events) {
    if (e.ghost === true) continue;
    out.set(e.tripId, [...(out.get(e.tripId) ?? []), e.actualAt.toISOString()]);
  }
  return out;
}

/**
 * Whether one run left its route, and where. Cached for five minutes while the
 * day can still change.
 * @param tripId - AT trip id.
 * @param range - The run's service-day window.
 * @returns The confirmed detour, or null when the run stayed on its route.
 */
export async function getTripDetour(tripId: string, range: DateRange): Promise<TripDetour | null> {
  return cachedForRange(
    async () => {
      const rows = await prisma.offRouteSighting.findMany({
        where: { tripId, seenAt: { gte: range.start, lt: range.end } },
        select: { seenAt: true, lat: true, lon: true, distanceM: true, alert: true },
        orderBy: { seenAt: "asc" },
      });
      if (rows.length < MIN_SIGHTINGS) return null;
      const arrivals = (await arrivalsByTrip([tripId], range)).get(tripId) ?? [];
      const sightings = confirmedDetour(
        rows.map((r) => ({
          at: r.seenAt.toISOString(),
          lat: r.lat,
          lon: r.lon,
          distanceM: r.distanceM,
        })),
        arrivals,
      );
      if (sightings.length === 0) return null;
      return { sightings, alert: rows.find((r) => r.alert)?.alert ?? null };
    },
    ["trip-detour", tripId, range.start.toISOString()],
    range,
    300,
  );
}

/**
 * The runs of a route that left their route in a window, for the trip board's badge.
 * @param routeId - Route slug.
 * @param range - The window.
 * @returns The detoured trip ids.
 */
export async function getDetouredTripIds(routeId: string, range: DateRange): Promise<string[]> {
  return cachedForRange(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const rows = await prisma.offRouteSighting.findMany({
        where: { routeId: { in: routeIds }, seenAt: { gte: range.start, lt: range.end } },
        select: { tripId: true, seenAt: true, lat: true, lon: true, distanceM: true },
      });
      const byTrip = new Map<string, Sighting[]>();
      for (const r of rows) {
        const s = { at: r.seenAt.toISOString(), lat: r.lat, lon: r.lon, distanceM: r.distanceM };
        byTrip.set(r.tripId, [...(byTrip.get(r.tripId) ?? []), s]);
      }
      const candidates = [...byTrip].filter(([, s]) => s.length >= MIN_SIGHTINGS).map(([t]) => t);
      if (candidates.length === 0) return [];
      const arrivals = await arrivalsByTrip(candidates, range);
      return candidates.filter(
        (t) => confirmedDetour(byTrip.get(t) ?? [], arrivals.get(t) ?? []).length > 0,
      );
    },
    ["detoured-trips", routeId, range.start.toISOString(), range.end.toISOString()],
    range,
    300,
  );
}
