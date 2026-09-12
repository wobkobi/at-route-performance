// src/lib/data/cancelled.ts
// Cancellations: per-route lists, counts and the most-cancelled board.
import { cachedForRange } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { routeSlug } from "@/lib/route-slug";
import type { DateRange } from "@/lib/time";

/** A trip cancelled on a route for a service day, for the trip board. */
export interface CancelledTripRow {
  trip_id: string;
  /** GTFS trip_headsign (destination), from TripMeta when known. */
  headsign: string | null;
}

/**
 * Trips cancelled on a route for a service day (from the realtime feed's
 * CANCELED trip updates), with each one's headsign resolved from TripMeta.
 * Empty for any day before cancellation capture began - the feed discards
 * cancellations without storing them, so there is no history.
 * @param routeId - Route slug.
 * @param range - The service-day window; its `start` is the stored service date.
 * @returns The day's cancelled trips, ordered by destination then trip id.
 */
export async function getCancelledTrips(
  routeId: string,
  range: DateRange,
): Promise<CancelledTripRow[]> {
  return cachedForRange(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const rows = await prisma.cancelledTrip.findMany({
        // Range match, as the other cancellation reads do, so the helper serves
        // any window rather than only a day whose start equals a stored stamp.
        where: { routeId: { in: routeIds }, serviceDate: { gte: range.start, lt: range.end } },
        select: { tripId: true },
      });
      if (rows.length === 0) return [];
      const tripIds = [...new Set(rows.map((r) => r.tripId))];
      const meta = await prisma.tripMeta.findMany({
        where: { id: { in: tripIds } },
        select: { id: true, headsign: true },
      });
      const headsignById = new Map(meta.map((m) => [m.id, m.headsign]));
      return tripIds
        .map((id) => ({ trip_id: id, headsign: headsignById.get(id) ?? null }))
        .sort((a, b) => (a.headsign ?? a.trip_id).localeCompare(b.headsign ?? b.trip_id));
    },
    ["cancelled-trips", routeId, range.start.toISOString(), range.end.toISOString()],
    range,
    300,
  );
}

/**
 * How many trips were cancelled outright in a window.
 *
 * A cancelled trip carries no stop times, so it never becomes an ArrivalEvent
 * and cannot count as late - cancelling a service quietly *improves* a route's
 * on-time rate. This is the counterweight: the worst thing a service can do
 * against its schedule, counted separately and shown beside the on-time figure.
 * Forward-only, since nothing was stored before capture began.
 * @param range - The window to count over (a service day, week, or month).
 * @param filter - Mode and school-service filters, matching the other day queries.
 * @param revalidate - Cache TTL in seconds.
 * @returns The number of cancelled trips, or 0 when none were recorded.
 */
export async function getCancelledCount(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<number> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      return prisma.cancelledTrip.count({
        where: {
          // Range match, not equality: the same helper serves a single service
          // day and the rankings page's week and month windows.
          serviceDate: { gte: range.start, lt: range.end },
          ...(routeIds ? { routeId: { in: routeIds } } : {}),
        },
      });
    },
    [
      "cancelled-count",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      String(includeSchool),
    ],
    { revalidate },
  )();
}

/** A route's cancellation tally for a service day. */
export interface CancelledRouteRow {
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  mode: string;
  colour: string | null;
  /** Trips cancelled on this route that day. */
  cancelled: number;
}

/**
 * Routes ranked by how many trips they cancelled in a window, worst first.
 * Companion to {@link getCancelledCount} for the Shame board - the on-time
 * rankings cannot show this, because a cancellation leaves no arrival to rank.
 * @param range - The window to rank over (a service day, week, or month).
 * @param filter - Mode and school-service filters, matching the other day queries.
 * @param limit - Maximum rows to return.
 * @param revalidate - Cache TTL in seconds.
 * @returns Routes with at least one cancellation, most cancellations first.
 */
export async function getCancelledRoutes(
  range: DateRange,
  filter: ShameFilter,
  limit: number,
  revalidate: number,
): Promise<CancelledRouteRow[]> {
  const { mode = null, includeSchool = false } = filter;
  return unstable_cache(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const grouped = await prisma.cancelledTrip.groupBy({
        by: ["routeId"],
        where: {
          // Range match, not equality: the same helper serves a single service
          // day and the rankings page's week and month windows.
          serviceDate: { gte: range.start, lt: range.end },
          ...(routeIds ? { routeId: { in: routeIds } } : {}),
        },
        _count: { _all: true },
      });
      if (grouped.length === 0) return [];

      // Cancellations are keyed by the versioned route id, so fold them onto the
      // slug the rest of the site links by - otherwise one line splits across
      // feed republishes exactly as its stats would.
      const bySlug = new Map<string, number>();
      for (const g of grouped) {
        const slug = routeSlug(g.routeId);
        bySlug.set(slug, (bySlug.get(slug) ?? 0) + g._count._all);
      }

      const routes = await prisma.route.findMany({
        where: { id: { in: grouped.map((g) => g.routeId) } },
        select: { id: true, shortName: true, longName: true, mode: true, colour: true },
      });
      const metaBySlug = new Map(routes.map((r) => [routeSlug(r.id), r]));

      return [...bySlug.entries()]
        .map(([slug, cancelled]) => {
          const meta = metaBySlug.get(slug);
          return {
            route_id: slug,
            short_name: meta?.shortName ?? null,
            long_name: meta?.longName ?? null,
            mode: meta?.mode ?? "BUS",
            colour: meta?.colour ?? null,
            cancelled,
          };
        })
        .sort((a, b) => b.cancelled - a.cancelled || a.route_id.localeCompare(b.route_id))
        .slice(0, limit);
    },
    [
      "cancelled-routes",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      String(includeSchool),
      String(limit),
    ],
    { revalidate },
  )();
}
