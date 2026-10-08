// src/lib/data/cancelled.ts
// Cancellations: per-route lists, counts and the most-cancelled board.
import { sumBy } from "@/lib/collections";
import { cachedForDay, cachedForRange } from "@/lib/data/cache";
import { type FlagKey, flagKey, flagStages } from "@/lib/data/flag-stages";
import { FIVE_MINUTE_REVALIDATE, LIVE_DAY_REVALIDATE } from "@/lib/data/revalidate";
import { routeIdsForSlug, routeTable } from "@/lib/data/routes";
import { type ShameFilter, worstStopRouteIds } from "@/lib/data/shame-filter";
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { modeOrBus } from "@/lib/mode";
import { type RouteDisplay, routeSlug } from "@/lib/route/slug";
import { isSchoolBus } from "@/lib/school-bus";
import {
  type DateRange,
  nzServiceDayRange,
  serviceDatesInRange,
  serviceDayClockInstant,
  startedServiceDates,
} from "@/lib/time/service-day";
import { type CancellationStage } from "@/lib/trip/cancellation";
import { gtfsTimeSeconds, tripIdStartSeconds } from "@/lib/trip/id";

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
    ["cancelled-trips-v4", routeId, range.start.toISOString(), range.end.toISOString()],
    range,
    LIVE_DAY_REVALIDATE,
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
      stage: stages.get(flagKey(f)) ?? "before",
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
export interface NetworkCancelledTrip
  extends CancelledTripRow, Omit<RouteDisplay, "routeId" | "colour"> {
  /** Route slug: the flags are tallied by line, across feed versions. */
  slug: string;
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
            slug: routeSlug(flag?.routeId ?? ""),
            shortName: route?.shortName ?? null,
            longName: route?.longName ?? "",
            mode: route?.mode ?? "BUS",
            colour: route?.colour ?? null,
            school: isSchoolBus(route?.shortName, route?.longName),
            service_date: date,
          };
        })
        .sort(byScheduledStart);
    },
    ["network-cancelled-trips-v2", date],
    date,
    LIVE_DAY_REVALIDATE,
  );
}

/**
 * Every trip cancelled on the network in a window, from the per-day lists.
 * Days that have not started are skipped.
 * @param range - The window (a service day, week or month).
 * @returns The window's cancelled trips, earliest scheduled start first.
 */
export async function getNetworkCancelledTrips(range: DateRange): Promise<NetworkCancelledTrip[]> {
  const dates = startedServiceDates(range);
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
    [
      "trip-cancellation",
      tripId,
      range?.start.toISOString() ?? "latest",
      range?.end.toISOString() ?? "latest",
    ],
    { revalidate: FIVE_MINUTE_REVALIDATE },
  )();
}

/** Cancelled trips on one versioned route id in a window. */
interface RouteCancellations {
  routeId: string;
  cancelled: number;
}

/**
 * Cancelled trips per versioned route id in a window, filtered by service date
 * only. The route filter is applied in memory by {@link keptRoutes}: Prisma sends
 * `in` to Mongo as an `$expr` `$or` whose cost grows with the list, and the school
 * filter's list runs to hundreds of ids, while a window holds a few hundred
 * grouped rows at most.
 * @param range - The window to count over.
 * @returns One row per route with a cancellation.
 */
async function cancelledPerRoute(range: DateRange): Promise<RouteCancellations[]> {
  const grouped = await prisma.cancelledTrip.groupBy({
    by: ["routeId"],
    // The window's service dates: the stored date is the trip's own day as a
    // string, so the same helper serves a day, a week and a month.
    where: { serviceDate: { in: serviceDatesInRange(range) } },
    _count: { _all: true },
  });
  return grouped.map((g) => ({ routeId: g.routeId, cancelled: g._count._all }));
}

/**
 * The route ids the mode and school filter keeps, as a set.
 * @param mode - Restrict to this mode, or null for every mode.
 * @param schools - Which school services count.
 * @returns The kept ids, or null when every route counts.
 */
async function allowedRouteIds(
  mode: ShameFilter["mode"],
  schools: NonNullable<ShameFilter["schools"]>,
): Promise<Set<string> | null> {
  const ids = await worstStopRouteIds(mode ?? null, schools);
  return ids ? new Set(ids) : null;
}

/**
 * The rows whose route the filter keeps.
 * @param rows - Cancellations per route.
 * @param allowed - Kept route ids, or null to keep every row.
 * @returns The kept rows.
 */
function keptRoutes(rows: RouteCancellations[], allowed: Set<string> | null): RouteCancellations[] {
  return allowed ? rows.filter((r) => allowed.has(r.routeId)) : rows;
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
  const { mode = null, schools = "exclude" } = filter;
  return cachedForRange(
    async () => {
      const [perRoute, allowed] = await Promise.all([
        cancelledPerRoute(range),
        allowedRouteIds(mode, schools),
      ]);
      return keptRoutes(perRoute, allowed).reduce((n, g) => n + g.cancelled, 0);
    },
    ["cancelled-count", range.start.toISOString(), range.end.toISOString(), mode ?? "all", schools],
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
  return new Map(rows.map((r) => [r.slug, r.cancelled]));
}

/** A route's cancellation tally for a service day. */
export interface CancelledRouteRow extends Omit<RouteDisplay, "routeId" | "colour"> {
  /** Route slug: the flags are tallied by line, across feed versions. */
  slug: string;
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
  const { mode = null, schools = "exclude" } = filter;
  return cachedForRange(
    async () => {
      const [perRoute, allowed, routes] = await Promise.all([
        cancelledPerRoute(range),
        allowedRouteIds(mode, schools),
        routeTable(),
      ]);
      const grouped = keptRoutes(perRoute, allowed);
      if (grouped.length === 0) return [];

      // Cancellations are keyed by the versioned route id, so fold them onto the
      // slug the rest of the site links by - otherwise one line splits across
      // feed republishes exactly as its stats would.
      const bySlug = sumBy(
        grouped,
        (g) => routeSlug(g.routeId),
        (g) => g.cancelled,
      );
      const metaBySlug = new Map(routes.map((r) => [routeSlug(r.id), r]));

      return [...bySlug.entries()]
        .map(([slug, cancelled]) => {
          const meta = metaBySlug.get(slug);
          return {
            slug,
            shortName: meta?.shortName ?? null,
            longName: meta?.longName ?? "",
            mode: modeOrBus(meta?.mode),
            colour: meta?.colour ?? null,
            cancelled,
          };
        })
        .sort((a, b) => b.cancelled - a.cancelled || a.slug.localeCompare(b.slug))
        .slice(0, limit);
    },
    [
      "cancelled-routes",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      schools,
      String(limit),
    ],
    range,
    revalidate,
  );
}
