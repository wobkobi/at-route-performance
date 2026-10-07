// src/lib/data/stops.ts
// Stops and stations: station grouping, sibling stations and one stop's stats.
import { cachedForRange, rangeIsFinal, scheduledAtWindow } from "@/lib/data/cache";
import { aggregateRows } from "@/lib/data/raw";
import { DAY_REVALIDATE } from "@/lib/data/revalidate";
import { routeIdsForSlug } from "@/lib/data/routes";
import { prisma } from "@/lib/db";
import { realDeviationMatchFor } from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import { lateSum, onTimePerEventSum } from "@/lib/on-time";
import { routeSlug } from "@/lib/route/slug";
import {
  STATION_PREFIX,
  type StationParts,
  isLegacyStationId,
  legacyStationId,
  platformLabelOf,
  stationId,
  stationNameOf,
} from "@/lib/stop/station";
import { type PlatformStats, platformBreakdown } from "@/lib/stop/station-platforms";
import {
  type StationPlace,
  type StationSiblings,
  siblingsByStation,
} from "@/lib/stop/station-siblings";
import { type DateRange, padScanRange, serviceDatesInRange } from "@/lib/time/service-day";
import type { RouteRow, RouteSummary, StopStats } from "@/types/api";

/**
 * The other parents AT publishes for the same place as this station, so the page
 * can link them. Auckland's interchanges are several parents - Manukau is a bus
 * station, a station and a train station - and {@link stationId} keeps them
 * apart on purpose, so without a link a reader on one has no way to the others.
 *
 * The whole 144-parent map is derived under one cache key rather than one entry
 * per station: the derivation needs every parent to find any one station's
 * neighbours, so a per-station key would read the same rows 144 times over.
 * @param id - The canonical stop id from a link.
 * @returns The place and its other parents, or null for a stop with no siblings.
 */
export async function getStationSiblings(id: string): Promise<StationSiblings | null> {
  if (!id.startsWith(STATION_PREFIX)) return null;
  const places = await unstable_cache(
    async (): Promise<StationPlace[]> => {
      const rows = await prisma.stop.findMany({
        where: { parentStation: { not: null } },
        select: {
          id: true,
          name: true,
          lat: true,
          lon: true,
          parentStation: true,
          platformCode: true,
        },
      });
      const acc = new Map<
        string,
        { platforms: (StationParts & { name: string })[]; lat: number; lon: number }
      >();
      for (const r of rows) {
        const key = stationId(r.id, r.name, r);
        const held = acc.get(key);
        if (held) {
          held.platforms.push(r);
          held.lat += r.lat;
          held.lon += r.lon;
        } else {
          acc.set(key, { platforms: [r], lat: r.lat, lon: r.lon });
        }
      }
      // The parent's centre is the mean of its platforms, since AT publishes no
      // row for the parent itself to take a position from.
      return [...acc].map(([key, v]) => ({
        id: key,
        name: stationNameOf(v.platforms),
        lat: v.lat / v.platforms.length,
        lon: v.lon / v.platforms.length,
        platforms: v.platforms.length,
      }));
    },
    ["station-places-v1"],
    { revalidate: DAY_REVALIDATE },
  )();
  // Cheap enough to redo per request (144 parents, 25 of them sharing a place),
  // and it keeps the cached value the feed's own parents rather than a Map,
  // which would not survive the cache's serialisation.
  return siblingsByStation(places).get(id) ?? null;
}

/** A canonical stop resolved to its underlying platform ids + display position. */
/**
 * A stop's name alone, for a caller that needs to say which stop it is without
 * measuring it.
 *
 * `generateMetadata` used {@link getStopStats} for this, which costs a
 * day-scoped aggregation over every arrival at every platform, and a
 * `resolveShownDay` database read before it to settle which day to aggregate -
 * all in front of the document head, for one string. The name does not depend on
 * the day, so this reads only the stop, and the entry it hits is the day-long
 * one the page itself already warms.
 * @param id - The canonical stop id from a link (raw stop id or `station:` id).
 * @returns The stop's display name, or null when no such stop exists.
 */
export async function getStopIdentity(id: string): Promise<{ name: string } | null> {
  const group = await resolveStopGroup(id);
  return group === null ? null : { name: group.name };
}

interface StopGroup {
  /** Canonical id (a `station:` id for collapsed train platforms, else the stop id). */
  id: string;
  /** Underlying GTFS stop ids to match in the events (platforms of a station). */
  ids: string[];
  /**
   * The single id AT's schedule answers on: the parent id for a station, the
   * stop id otherwise. A parent returns every platform's departures in one
   * call, so a station page asks once rather than once per platform.
   */
  scheduleId: string;
  name: string;
  lat: number;
  lon: number;
  /**
   * Each platform's id and AT's own label for it, for the per-platform
   * breakdown. Empty for a stop that is not a station: there is nothing to break
   * a single stop down into.
   */
  platforms: { id: string; label: string }[];
}

/**
 * Resolve a (possibly station-collapsed) stop id to its underlying platform ids
 * and a display name/position, the way {@link routeIdsForSlug} resolves a route
 * slug. A `station:` id expands to every platform of that station; a plain id
 * resolves to itself. Returns null when no such stop exists.
 *
 * The platform ids this returns are what let the stop page match AT's service
 * alerts and scheduled departures, both of which key off raw GTFS stop ids.
 * @param id - The canonical stop id from a link (raw stop id or `station:` id).
 * @returns The resolved group, or null when unknown.
 */
async function resolveStopGroup(id: string): Promise<StopGroup | null> {
  return unstable_cache(
    async () => {
      if (id.startsWith(STATION_PREFIX)) {
        // Parent-keyed ids name their station outright, so the platforms are an
        // indexed lookup. Legacy name-keyed ids predate the parent fields and
        // still have to be matched by scanning the (small) set of train stops.
        const select = {
          id: true,
          name: true,
          lat: true,
          lon: true,
          platformCode: true,
          parentStation: true,
        };
        const members = isLegacyStationId(id)
          ? (
              await prisma.stop.findMany({
                where: { name: { contains: "Train Station" } },
                select,
              })
            ).filter((s) => legacyStationId(s.name) === id)
          : await prisma.stop.findMany({
              where: { parentStation: id.slice(STATION_PREFIX.length) },
              select,
            });
        const first = members[0];
        if (first === undefined) return null;
        return {
          id,
          ids: members.map((s) => s.id),
          // A legacy id is keyed on the station's name, so the parent it stands
          // for has to come off a platform. Falling back to one platform's own
          // id costs that page its other platforms' departures, not the board.
          scheduleId: isLegacyStationId(id)
            ? (first.parentStation ?? first.id)
            : id.slice(STATION_PREFIX.length),
          name: stationNameOf(members),
          lat: first.lat,
          lon: first.lon,
          platforms: members.map((s) => ({ id: s.id, label: platformLabelOf(s.name, s) })),
        };
      }
      const stop = await prisma.stop.findUnique({
        where: { id },
        select: { id: true, name: true, lat: true, lon: true },
      });
      if (!stop) return null;
      return {
        id: stop.id,
        ids: [stop.id],
        scheduleId: stop.id,
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        platforms: [],
      };
    },
    ["resolve-stop-group-v4", id],
    { revalidate: DAY_REVALIDATE },
  )();
}

/**
 * Each route name's page slug, for a platform's route links. A name several routes share
 * (school runs: "009" is both S009A and S009B) is left out, since it picks out no one page.
 * @param ids - The platform's routes, by name and feed id.
 * @returns Short name to route slug.
 */
function slugsByName(ids: readonly { name: string | null; id: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const shared = new Set<string>();
  for (const { name, id } of ids) {
    if (name == null) continue;
    const slug = routeSlug(id);
    if (out[name] !== undefined && out[name] !== slug) shared.add(name);
    out[name] = slug;
  }
  for (const name of shared) delete out[name];
  return out;
}

/** One facet's results from the stop-stats aggregation. */
interface StopStatsFacet {
  summary: RouteSummary[];
  routes: RouteRow[];
  /** Per-platform rows, before the labels are joined on and the gate is applied. */
  platforms: (Omit<PlatformStats, "label"> & {
    routes: (string | null)[];
    route_ids: { name: string | null; id: string }[];
  })[];
  routeCount: { n: number }[];
}

/**
 * How a single stop performed across every route in a window: an overall
 * punctuality summary and the worst routes calling at it. Mirrors the per-route
 * pipeline but matches by stop (all platform ids of a station) with no route
 * filter, joining Route so the on-time split honours each event's mode-specific
 * window (see {@link onTimePerEventSum}). Cached briefly.
 * @param id - Canonical stop id (raw stop id or `station:` id).
 * @param range - The window to summarise.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The stop's stats, or null when the stop id is unknown.
 */
export async function getStopStats(
  id: string,
  range: DateRange,
  revalidate: number,
): Promise<StopStats | null> {
  // Resolved outside the cached callback, where its own Data Cache read would be
  // skipped, and beside the window's state check that cachedForRange makes first.
  const [group] = await Promise.all([resolveStopGroup(id), rangeIsFinal(range)]);
  if (!group) return null;
  return cachedForRange(
    async (classified) => {
      const labels = new Map(group.platforms.map((p) => [p.id, p.label]));

      const res = await aggregateRows<StopStatsFacet>("ArrivalEvent", [
        {
          $match: {
            stopId: { $in: group.ids },
            scheduledAt: scheduledAtWindow(padScanRange(range)),
            serviceDate: { $in: serviceDatesInRange(range) },
            ...realDeviationMatchFor(classified),
          },
        },
        { $lookup: { from: "Route", localField: "routeId", foreignField: "_id", as: "route" } },
        { $unwind: "$route" },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  events: { $sum: 1 },
                  avg_delay_sec: { $avg: "$deviationSec" },
                  avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                  on_time_count: onTimePerEventSum(),
                  late_count: lateSum(),
                },
              },
              // Every event is exactly one of early/on-time/late, so early is
              // the remainder - no separate mode-aware early accumulator needed.
              {
                $addFields: {
                  early_count: {
                    $subtract: ["$events", { $add: ["$on_time_count", "$late_count"] }],
                  },
                },
              },
              {
                $addFields: {
                  on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
                  early_pct: { $multiply: [{ $divide: ["$early_count", "$events"] }, 100] },
                  late_pct: { $multiply: [{ $divide: ["$late_count", "$events"] }, 100] },
                },
              },
              {
                $project: {
                  _id: 0,
                  events: 1,
                  avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                  avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                  on_time_pct: { $round: ["$on_time_pct", 1] },
                  early_pct: { $round: ["$early_pct", 1] },
                  late_pct: { $round: ["$late_pct", 1] },
                },
              },
            ],
            routes: [
              {
                $group: {
                  _id: "$routeId",
                  events: { $sum: 1 },
                  avg_delay_sec: { $avg: "$deviationSec" },
                  avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                  on_time_count: onTimePerEventSum(),
                  shortName: { $first: "$route.shortName" },
                  longName: { $first: "$route.longName" },
                  mode: { $first: "$route.mode" },
                },
              },
              {
                $addFields: {
                  on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
                },
              },
              { $sort: { avg_abs_delay_sec: -1 as const } },
              { $limit: 12 },
              {
                $project: {
                  _id: 0,
                  routeId: { $toString: "$_id" },
                  shortName: 1,
                  longName: 1,
                  mode: 1,
                  events: 1,
                  avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                  avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                  on_time_pct: { $round: ["$on_time_pct", 1] },
                },
              },
            ],
            // Per platform, for the breakdown a station page shows when its
            // platforms disagree (see platformBreakdown). It rides in this
            // facet rather than its own query: the scan is already paid for,
            // and a plain stop returns a single row the gate discards.
            platforms: [
              {
                $group: {
                  _id: "$stopId",
                  events: { $sum: 1 },
                  avg_delay_sec: { $avg: "$deviationSec" },
                  avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                  on_time_count: onTimePerEventSum(),
                  // By the name a rider uses, not the feed id: two feed
                  // versions of one route are one route to whoever is
                  // waiting, and "only route 33 leaves from here" has to
                  // count them as one or it never holds.
                  routes: { $addToSet: "$route.shortName" },
                  // The same routes by id, only to link each name to its page.
                  route_ids: { $addToSet: { name: "$route.shortName", id: "$routeId" } },
                  // Not an arbitrary pick from the group: all 311 platforms
                  // that recorded arrivals on a measured day served exactly
                  // one mode, since a bay is buses and a pier is ferries.
                  // It decides the early tolerance behind the row colour.
                  mode: { $first: "$route.mode" },
                },
              },
              {
                $addFields: {
                  on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
                },
              },
              {
                $project: {
                  _id: 0,
                  stop_id: { $toString: "$_id" },
                  events: 1,
                  routes: 1,
                  route_ids: 1,
                  mode: 1,
                  avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                  avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                  on_time_pct: { $round: ["$on_time_pct", 1] },
                },
              },
            ],
            routeCount: [{ $group: { _id: "$routeId" } }, { $count: "n" }],
          },
        },
      ]);

      const facet = res[0];
      return {
        stop: { stop_id: group.id, name: group.name, lat: group.lat, lon: group.lon },
        platform_ids: group.ids,
        platform_labels: group.platforms.map((p) => p.label),
        schedule_stop_id: group.scheduleId,
        summary: facet?.summary[0] ?? null,
        routes: facet?.routes ?? [],
        routes_count: facet?.routeCount[0]?.n ?? 0,
        platforms: platformBreakdown(
          (facet?.platforms ?? []).flatMap((p) => {
            const label = labels.get(p.stop_id);
            // A platform the group does not know is one the feed dropped between
            // the events being recorded and this read; leave it out rather than
            // label it with a raw id.
            if (label === undefined) return [];
            const { route_ids, ...rest } = p;
            return [
              {
                ...rest,
                label,
                routes: p.routes.filter((r): r is string => r != null),
                route_slugs: slugsByName(route_ids),
              },
            ];
          }),
        ),
      };
    },
    ["stop-stats-v5", id, range.start.toISOString(), range.end.toISOString()],
    range,
    revalidate,
  );
}
