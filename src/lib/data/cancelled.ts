// src/lib/data/cancelled.ts
// Cancellations: per-route lists, counts and the most-cancelled board.
import { cancellationStage, type CancellationStage } from "@/lib/cancellation";
import { cachedForDay, cachedForRange } from "@/lib/data/cache";
import { routeIdsForSlug } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { routeSlug } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import {
  type DateRange,
  nzServiceDayRange,
  serviceDatesInRange,
  serviceDayClockInstant,
} from "@/lib/time";
import { gtfsTimeSeconds, tripIdStartSeconds } from "@/lib/trip-id";

/** A trip cancelled on a route for a service day, for the trip board. */
export interface CancelledTripRow {
  trip_id: string;
  /** GTFS trip_headsign (destination), from TripMeta when known. */
  headsign: string | null;
  /** GTFS direction_id, from TripMeta when known (for the direction filter). */
  direction_id: number | null;
  /** ISO instant the trip was scheduled to start, or null when it cannot be told. */
  scheduled_start: string | null;
  /** ISO instant ingest first saw the cancellation. */
  detected_at: string;
  /** Whether it never ran, was cut short or was reinstated, from its arrivals against the flag. */
  stage: CancellationStage;
}

/** A stored cancellation flag: the trip, its service day and when the flag was first seen. */
interface FlagKey {
  tripId: string;
  /** The run's own service date (`YYYY-MM-DD`). */
  serviceDate: string;
  detectedAt: Date;
}

/**
 * Each flag's stage, from the real (non-ghost) arrivals its trip recorded on
 * the flag's own service day. One indexed read for the whole set: the trip ids
 * lead the ArrivalEvent unique key, and the window spans the flags' days.
 * @param flags - The cancellation flags to classify.
 * @returns Stage per flag, keyed by `tripId|serviceDate`.
 */
async function flagStages(flags: readonly FlagKey[]): Promise<Map<string, CancellationStage>> {
  const out = new Map<string, CancellationStage>();
  if (flags.length === 0) return out;
  const days = flags.map((f) => nzServiceDayRange(f.serviceDate));
  const start = new Date(Math.min(...days.map((d) => d.start.getTime())));
  const end = new Date(Math.max(...days.map((d) => d.end.getTime())));
  const events = await prisma.arrivalEvent.findMany({
    where: {
      tripId: { in: [...new Set(flags.map((f) => f.tripId))] },
      scheduledAt: { gte: start, lt: end },
    },
    select: { tripId: true, scheduledAt: true, actualAt: true, ghost: true },
  });
  const eventsByTrip = new Map<string, typeof events>();
  for (const e of events) {
    if (e.ghost === true) continue;
    const list = eventsByTrip.get(e.tripId);
    if (list) list.push(e);
    else eventsByTrip.set(e.tripId, [e]);
  }
  flags.forEach((f, i) => {
    const day = days[i];
    const arrivals = (eventsByTrip.get(f.tripId) ?? [])
      .filter((e) => day !== undefined && e.scheduledAt >= day.start && e.scheduledAt < day.end)
      .map((e) => e.actualAt.toISOString());
    out.set(
      `${f.tripId}|${f.serviceDate}`,
      cancellationStage(f.detectedAt.toISOString(), arrivals),
    );
  });
  return out;
}

/**
 * Trips cancelled on a route for a service day (from the realtime feed's
 * CANCELED trip updates), with each one's headsign and direction resolved from
 * TripMeta. The scheduled start comes from the feed's `start_time` captured at
 * ingest, or failing that the start seconds in the AT trip id.
 * Empty for any day before cancellation capture began - the feed discards
 * cancellations without storing them, so there is no history.
 * @param routeId - Route slug.
 * @param range - The service-day window; its `start` is the stored service date.
 * @returns The day's cancelled trips, earliest scheduled start first.
 */
export async function getCancelledTrips(
  routeId: string,
  range: DateRange,
): Promise<CancelledTripRow[]> {
  return cachedForRange(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const rows = await prisma.cancelledTrip.findMany({
        // The window's service dates, not a range over an instant: the stored
        // date is now the run's own day as a string.
        where: { routeId: { in: routeIds }, serviceDate: { in: serviceDatesInRange(range) } },
        select: { tripId: true, serviceDate: true, startTime: true, detectedAt: true },
      });
      // One row per trip: the unique key is (trip, day), and a wider window than
      // a day would otherwise list a trip once per day it was cancelled.
      const byTrip = new Map(rows.map((r) => [r.tripId, r]));
      return (await describeFlags([...byTrip.values()])).sort(byScheduledStart);
    },
    ["cancelled-trips-v3", routeId, range.start.toISOString(), range.end.toISOString()],
    range,
    300,
  );
}

/** A stored cancellation flag with the start time ingest captured. */
interface StoredFlag extends FlagKey {
  startTime: string | null;
}

/**
 * Turn stored flags into board rows: headsign and direction from TripMeta, the
 * scheduled start from the captured `start_time` (or the start seconds in the
 * AT trip id), and the stage from the trip's arrivals.
 * @param flags - The stored flags.
 * @returns One row per flag, in the order given.
 */
async function describeFlags(flags: readonly StoredFlag[]): Promise<CancelledTripRow[]> {
  if (flags.length === 0) return [];
  const [meta, stages] = await Promise.all([
    prisma.tripMeta.findMany({
      where: { id: { in: [...new Set(flags.map((f) => f.tripId))] } },
      select: { id: true, headsign: true, directionId: true },
    }),
    flagStages(flags),
  ]);
  const metaById = new Map(meta.map((m) => [m.id, m]));
  return flags.map((f) => {
    const sec = gtfsTimeSeconds(f.startTime) ?? tripIdStartSeconds(f.tripId);
    return {
      trip_id: f.tripId,
      headsign: metaById.get(f.tripId)?.headsign ?? null,
      direction_id: metaById.get(f.tripId)?.directionId ?? null,
      scheduled_start:
        sec === null
          ? null
          : serviceDayClockInstant(nzServiceDayRange(f.serviceDate).start, sec).toISOString(),
      detected_at: f.detectedAt.toISOString(),
      stage: stages.get(`${f.tripId}|${f.serviceDate}`) ?? "before",
    };
  });
}

/**
 * Order cancellation rows by scheduled start, unknown starts last, then trip id.
 * @param a - First row.
 * @param b - Second row.
 * @returns The standard sort contract.
 */
function byScheduledStart(a: CancelledTripRow, b: CancelledTripRow): number {
  return (
    (a.scheduled_start ?? "~").localeCompare(b.scheduled_start ?? "~") ||
    a.trip_id.localeCompare(b.trip_id)
  );
}

/** A cancelled trip anywhere on the network, for the Cancellations page. */
export interface NetworkCancelledTrip extends CancelledTripRow {
  /** Route slug. */
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  mode: string;
  colour: string | null;
  /** Whether the route is a school service. */
  school: boolean;
  /** The service date the flag belongs to (`YYYY-MM-DD`). */
  service_date: string;
}

/**
 * Every trip cancelled on the network on one service day, with its route and
 * stage. Cached under the day, so a week or month reads each day once; a
 * completed day holds for a week once summarised, the live day for five minutes.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns The day's cancelled trips, earliest scheduled start first.
 */
function networkCancelledTripsOfDay(date: string): Promise<NetworkCancelledTrip[]> {
  return cachedForDay(
    async () => {
      const flags = await prisma.cancelledTrip.findMany({
        where: { serviceDate: date },
        select: {
          tripId: true,
          routeId: true,
          serviceDate: true,
          startTime: true,
          detectedAt: true,
        },
      });
      if (flags.length === 0) return [];
      const [rows, routes] = await Promise.all([
        describeFlags(flags),
        prisma.route.findMany({
          where: { id: { in: [...new Set(flags.map((f) => f.routeId))] } },
          select: { id: true, shortName: true, longName: true, mode: true, colour: true },
        }),
      ]);
      const routeById = new Map(routes.map((r) => [r.id, r]));
      return rows
        .map((row, i) => {
          const flag = flags[i];
          const route = flag ? routeById.get(flag.routeId) : undefined;
          return {
            ...row,
            route_id: routeSlug(flag?.routeId ?? ""),
            short_name: route?.shortName ?? null,
            long_name: route?.longName ?? null,
            mode: route?.mode ?? "BUS",
            colour: route?.colour ?? null,
            school: isSchoolBus(route?.shortName, route?.longName),
            service_date: date,
          };
        })
        .sort(byScheduledStart);
    },
    ["network-cancelled-trips", date],
    date,
    300,
  );
}

/**
 * Every trip cancelled on the network in a window, from the per-day lists.
 * Days that have not started are skipped.
 * @param range - The window (a service day, week or month).
 * @returns The window's cancelled trips, earliest scheduled start first.
 */
export async function getNetworkCancelledTrips(range: DateRange): Promise<NetworkCancelledTrip[]> {
  const now = new Date();
  const dates = serviceDatesInRange(range).filter((d) => nzServiceDayRange(d).start <= now);
  return (await Promise.all(dates.map(networkCancelledTripsOfDay))).flat();
}

/** One trip's cancellation flag, for the trip page. */
export interface TripCancellation {
  /** ISO instant ingest first saw the cancellation. */
  detected_at: string;
  /** The service date the flag belongs to (`YYYY-MM-DD`). */
  service_date: string;
}

/**
 * The cancellation flag on one run of a trip, if AT raised one. A trip id
 * repeats every service day, so the flag is looked up for the run's own day;
 * with no day (an undated link to a trip that recorded nothing) it takes the
 * trip's most recent flag. Cached for five minutes, since a flag can land on
 * the live day at any poll.
 * @param tripId - AT GTFS trip id.
 * @param range - The run's service-day window, or null for the latest flag.
 * @returns The flag, or null when the run was never flagged.
 */
export async function getTripCancellation(
  tripId: string,
  range: DateRange | null,
): Promise<TripCancellation | null> {
  return unstable_cache(
    async () => {
      const row = await prisma.cancelledTrip.findFirst({
        where: {
          tripId,
          ...(range ? { serviceDate: { in: serviceDatesInRange(range) } } : {}),
        },
        // `YYYY-MM-DD` sorts lexicographically in date order, so newest-first
        // still means the most recent service day.
        orderBy: { serviceDate: "desc" },
        select: { detectedAt: true, serviceDate: true },
      });
      return row
        ? { detected_at: row.detectedAt.toISOString(), service_date: row.serviceDate }
        : null;
    },
    ["trip-cancellation", tripId, range?.start.toISOString() ?? "latest"],
    { revalidate: 300 },
  )();
}

/**
 * How many trips were cancelled outright in a window.
 *
 * A cancelled trip carries no stop times, so it never becomes an ArrivalEvent;
 * the punctuality figures take it in as the wait for the next trip
 * (lib/rider-wait.ts), and this counts the flagged trips themselves, reinstated
 * ones included. Forward-only, since nothing was stored before capture began.
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
  return cachedForRange(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      return prisma.cancelledTrip.count({
        where: {
          // The window's service dates: the stored date is the run's own day as
          // a string, so the same helper still serves a day, a week and a month.
          serviceDate: { in: serviceDatesInRange(range) },
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
    range,
    revalidate,
  );
}

/** Row cap that lets {@link getCancelledRoutes} return every route with a cancellation. */
const ALL_ROUTES = 10_000;

/**
 * Cancellations per route slug in a window, for the note beside each route on
 * the "Most off-schedule" boards. The count sits beside the score, which already
 * takes the cancellations in as the wait for the next trip.
 * @param range - The window to count over (a service day, week, or month).
 * @param filter - Mode and school-service filters, matching the board's rows.
 * @param revalidate - Cache TTL in seconds.
 * @returns Route slug to cancelled-trip count, for routes with at least one.
 */
export async function getCancelledByRoute(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<Map<string, number>> {
  const rows = await getCancelledRoutes(range, filter, ALL_ROUTES, revalidate);
  return new Map(rows.map((r) => [r.route_id, r.cancelled]));
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
  return cachedForRange(
    async () => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const grouped = await prisma.cancelledTrip.groupBy({
        by: ["routeId"],
        where: {
          // The window's service dates: the stored date is the run's own day as
          // a string, so the same helper still serves a day, a week and a month.
          serviceDate: { in: serviceDatesInRange(range) },
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
    range,
    revalidate,
  );
}
