// src/lib/data.ts
// Central server-side data-access layer: builds the app's cached
// route, stop, trip and on-time views from MongoDB. Runs the heavy aggregations
// via `$runCommandRaw` (worst-of-day and worst-of-week boards, rankings, per-
// route and per-stop summaries, cancelled-trip lookups), splitting week queries
// per service day to stay under MongoDB's in-memory sort limit, and wraps each
// result in `unstable_cache`/`memCache` with a purpose-fit TTL.
import { fetchAll } from "@/lib/at-static";
import { prisma, runCommand } from "@/lib/db";
import {
  isGhostDeviation,
  medianDeviation,
  NO_DELAY_SOURCE,
  realDeviationExprFor,
  realDeviationMatchFor,
} from "@/lib/deviation";
import { unstable_cache } from "@/lib/mem-cache";
import {
  earlySingleModeSum,
  earlyTwoCounts,
  lateSum,
  onTimePerEventSum,
  onTimeSingleModeSum,
  onTimeTwoCounts,
  pickEarlyByRouteMode,
  pickOnTimeByRouteMode,
} from "@/lib/on-time";
import {
  allSuccessorSlugs,
  directoryLineageRows,
  foldLineageRows,
  predecessorSlugs,
  successorSlug,
} from "@/lib/route-lineage";
import { routeSlug, routeVersion } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import { serviceDateExpr } from "@/lib/service-day-expr";
import {
  isLegacyStationId,
  isPlatformStop,
  legacyStationId,
  STATION_PREFIX,
  stationId,
  stationName,
  stationPartsOf,
  stationProjection,
  type StationRow,
} from "@/lib/station";
import {
  NZ_TZ,
  nzLast7DaysRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  SERVICE_START_HOUR,
  serviceDatesInRange,
  shiftWeek,
  type DateRange,
} from "@/lib/time";
import type {
  PerTripStat,
  RouteByStop,
  RouteDay,
  RouteSummary,
  StopStats,
  TopRouteRow,
  TripStop,
  TripTimeline,
} from "@/types/api";
import type {
  ShameDayStop,
  ShameOfDay,
  ShameOfWeek,
  ShameRouteOfDay,
  ShameRouteOfWeek,
  ShameRouteRow,
  ShameStop,
  ShameStopOfDay,
  ShameStopOfWeek,
  ShameTrip,
  WorstStop,
} from "@/types/dashboard";

/**
 * Normalise an extended-JSON date (`{ $date }`) or ISO string to an ISO string.
 * `$runCommandRaw` returns dates as `{ $date }`; this flattens them.
 * @param d - An extended-JSON date or an ISO string.
 * @returns The ISO instant string.
 */
function toIso(d: { $date: string } | string): string {
  return typeof d === "string" ? d : d.$date;
}

const MS_IN_DAY = 86_400_000;

/**
 * Every AT route id sharing one slug - the same route across feed-version
 * republishes (see {@link routeSlug}) - newest version first, or empty when the
 * slug matches nothing. Cached hourly; route ids only change on the GTFS sync.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns Matching route ids, newest version first.
 */
async function routeIdsMatching(slug: string): Promise<string[]> {
  return unstable_cache(
    async () => {
      const routes = await prisma.route.findMany({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      return routes
        .map((r) => r.id)
        .filter((id) => routeSlug(id) === slug)
        .sort((a, b) => routeVersion(b) - routeVersion(a));
    },
    ["route-ids-matching", slug],
    { revalidate: 3600 },
  )();
}

/**
 * A route's own ids across feed-version republishes, newest first, without the
 * ids of any line it replaced. Falls back to the input when nothing matches, so
 * a full id still works and callers can always read `[0]`.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns The route's own ids, newest version first (or `[slug]` when none).
 */
export async function ownRouteIds(slug: string): Promise<string[]> {
  const ids = await routeIdsMatching(slug);
  return ids.length > 0 ? ids : [slug];
}

/**
 * A route's own ids (see {@link ownRouteIds}) followed by the ids of any line it
 * replaced (see {@link predecessorSlugs}). Lets route queries aggregate over all
 * versions (so history doesn't fragment when AT bumps the suffix) and across the
 * CRL rename (so a renamed line keeps its archive), and resolve a slug URL to a
 * concrete id.
 *
 * The requested slug's own ids always come first: callers read `[0]` as the
 * newest id for schedule and metadata lookups, which must never resolve to a
 * retired line.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns Matching route ids, newest version first (or `[slug]` when none).
 */
export async function routeIdsForSlug(slug: string): Promise<string[]> {
  const [own, ...predecessors] = await Promise.all([
    ownRouteIds(slug),
    ...predecessorSlugs(slug).map(routeIdsMatching),
  ]);
  return [...own, ...predecessors.flat()];
}

/** How far back {@link routeHasTraffic} looks for an arrival on a line's own ids. */
const TRAFFIC_LOOKBACK_MS = 7 * MS_IN_DAY;

/**
 * Whether a route has recorded any arrival on its own ids in the last week. A
 * single indexed point read (`routeId, scheduledAt`), cached for ten minutes so
 * the answer flips within that long of a line's first train.
 * @param slug - A version-stripped route slug.
 * @returns True once an arrival event exists for the route in the lookback.
 */
export async function routeHasTraffic(slug: string): Promise<boolean> {
  return unstable_cache(
    async () => {
      const ids = await ownRouteIds(slug);
      const since = new Date(Date.now() - TRAFFIC_LOOKBACK_MS);
      const hit = await prisma.arrivalEvent.findFirst({
        where: { routeId: { in: ids }, scheduledAt: { gte: since } },
        select: { id: true },
      });
      return hit !== null;
    },
    ["route-has-traffic", slug],
    { revalidate: 600 },
  )();
}

/**
 * Find the canonical version-stripped slug for a route, case-insensitively.
 * Returns the exact slug when it exists (fast path), or the slug of the first
 * case-insensitive match (for URLs typed in the wrong case), or null when no
 * route exists. Cached hourly per lowercased slug; route ids only change on
 * the GTFS static sync.
 * @param slug - A version-stripped route slug to look up.
 * @returns The canonical slug, or null when unknown.
 */
export async function findCanonicalRouteSlug(slug: string): Promise<string | null> {
  return unstable_cache(
    async () => {
      // Exact match first (indexed _id lookup); case-insensitive fallback for
      // user-typed paths like /route/nx1 > /route/NX1.
      const exact = await prisma.route.findFirst({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      if (exact) return routeSlug(exact.id);
      const ci = await prisma.route.findFirst({
        where: {
          OR: [
            { id: { equals: slug, mode: "insensitive" } },
            { id: { startsWith: `${slug}-`, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      return ci ? routeSlug(ci.id) : null;
    },
    ["canonical-route-slug", slug.toLowerCase()],
    { revalidate: 3600 },
  )();
}

/**
 * The live slug a retired train line's URL should move to. Retired lines keep
 * their Route row forever (the GTFS sync only upserts), so a stale link resolves
 * rather than 404s - this is what turns it into a redirect instead. The
 * successor's own row lands in static GTFS days before its first train (AT
 * published `S-C-201` on 10 September for a 13 September start), so existence
 * alone would redirect early onto a line with nothing to show; the redirect
 * waits until the successor has carried traffic (see {@link routeHasTraffic}).
 * @param slug - A canonical route slug.
 * @returns The successor's canonical slug, or null while the retired line's own page should stand.
 */
export async function findSuccessorRouteSlug(slug: string): Promise<string | null> {
  const candidate = successorSlug(slug);
  if (candidate === null) return null;
  const found = await findCanonicalRouteSlug(candidate);
  if (found === null) return null;
  return (await routeHasTraffic(found)) ? found : null;
}

/** A route as listed in the directory. */
export interface DirectoryRoute {
  id: string;
  shortName: string | null;
  longName: string | null;
  mode: string;
  colour: string | null;
}

/** How stale a route's `lastSeenAt` may be before it counts as retired (the sync runs daily). */
const ROUTE_STALE_MS = 2 * MS_IN_DAY;

/**
 * Routes AT's most recent GTFS sync still published, for the route directory.
 *
 * Retired routes keep their row - they hold years of retained summaries, and
 * their URLs still redirect - so listing every row would show lines that no
 * longer run. Four train lines retire at once at the CRL cutover. A row with
 * no stamp was absent from the last sync, so once any stamp exists it counts
 * as retired too; only a database no sync has ever stamped lists every row.
 *
 * Around the cutover the feed carries a retired line and its successor at the
 * same time, so the list is then trimmed to whichever of the two is running
 * (see {@link directoryLineageRows}). That trim sits outside the hourly cache
 * because it turns on {@link routeHasTraffic}, which flips within ten minutes
 * of the successor's first train.
 * @returns Current routes, ordered by short name.
 */
export async function getDirectoryRoutes(): Promise<DirectoryRoute[]> {
  const rows = await unstable_cache(
    async () => {
      const newest = await prisma.route.findFirst({
        where: { lastSeenAt: { not: null } },
        orderBy: { lastSeenAt: "desc" },
        select: { lastSeenAt: true },
      });
      const cutoff = newest?.lastSeenAt
        ? new Date(newest.lastSeenAt.getTime() - ROUTE_STALE_MS)
        : null;
      return prisma.route.findMany({
        where: cutoff ? { lastSeenAt: { gte: cutoff } } : {},
        select: { id: true, shortName: true, longName: true, mode: true, colour: true },
        orderBy: { shortName: "asc" },
      });
    },
    ["directory-routes"],
    { revalidate: 3600 },
  )();
  const successors = allSuccessorSlugs();
  const traffic = await Promise.all(successors.map(routeHasTraffic));
  const running = new Set(successors.filter((_, i) => traffic[i]));
  return directoryLineageRows(rows, running);
}

/** Parameters for {@link getTopRoutes}. */
export interface TopRoutesParams {
  week?: string;
  limit: number;
  metric: "on_time_rate" | "avg_delay";
  thresholdSec: number;
  mode?: "BUS" | "TRAIN" | "FERRY";
}

/** Parameters for {@link getRouteStats}. */
export interface RouteStatsParams {
  routeId: string;
  from?: Date;
  to?: Date;
  thresholdSec: number;
}

/** Result shape of {@link getRouteStats}. */
export interface RouteStats {
  route: { shortName: string | null; longName: string; mode: string; colour: string | null } | null;
  summary: RouteSummary | null;
  byStop: RouteByStop[];
}

/**
 * The Auckland-local week window for an ISO week string, defaulting to the
 * week containing now. ISO week 1 is the week holding 4 January; the target
 * week's Monday is stepped from there as a date and handed to
 * {@link nzWeekRange}, so the window runs from Auckland midnight rather than
 * UTC midnight (twelve or thirteen hours late for a New Zealand week).
 * @param iso - ISO week like `2025-W32` (optional).
 * @returns The week as a half-open UTC window.
 */
function isoWeekRange(iso?: string): DateRange {
  const parts = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  if (!parts) return nzWeekRange();
  const [, yearPart = "", weekPart = ""] = parts;
  const jan4 = new Date(Date.UTC(Number(yearPart), 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 7 * (Number(weekPart) - 1));
  return nzWeekRange(monday.toISOString().slice(0, 10));
}

/**
 * Run the top-routes aggregation against MongoDB.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
async function queryTopRoutes(p: TopRoutesParams): Promise<TopRouteRow[]> {
  const { start, end } = isoWeekRange(p.week);
  const classified = await rangeIsFinal({ start, end });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow({ start, end }),
        ...realDeviationMatchFor(classified),
      },
    },
    {
      $group: {
        _id: "$routeId",
        events: { $sum: 1 },
        avg_delay_sec: { $avg: "$deviationSec" },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        ...onTimeTwoCounts(),
      },
    },
    {
      $lookup: {
        from: "Route",
        localField: "_id",
        foreignField: "_id",
        as: "route",
      },
    },
    { $unwind: "$route" },
    // Mode known after the lookup: pick the matching on-time count, then the rate.
    { $addFields: { on_time_count: pickOnTimeByRouteMode } },
    {
      $addFields: {
        on_time_pct: { $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] },
      },
    },
  ];

  if (p.mode) pipeline.push({ $match: { "route.mode": p.mode } });

  pipeline.push({
    $sort: p.metric === "avg_delay" ? { avg_delay_sec: -1 as const } : { on_time_pct: -1 as const },
  });
  pipeline.push({ $limit: p.limit });
  pipeline.push({
    $project: {
      _id: 0,
      route_id: { $toString: "$_id" },
      short_name: "$route.shortName",
      long_name: "$route.longName",
      mode: "$route.mode",
      events: 1,
      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
      on_time_pct: { $round: ["$on_time_pct", 1] },
    },
  });

  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: pipeline as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };

  // One row per line: a republish or the CRL cutover inside the week would
  // otherwise list the same line twice. The fold can only shorten the list
  // and shift a merged row, so re-apply the metric order.
  const metric = p.metric === "avg_delay" ? "avg_delay_sec" : "on_time_pct";
  return foldLineageRows(result.cursor.firstBatch).sort(
    (a, b) => (b[metric] ?? Number.NEGATIVE_INFINITY) - (a[metric] ?? Number.NEGATIVE_INFINITY),
  );
}

/**
 * Top routes for an ISO week, ranked by on-time rate or average delay.
 * Cached (weekly aggregates are stable); both the home page and the API route
 * call this so there is no in-process HTTP round-trip.
 * @param p - Validated query parameters.
 * @returns Ranked route rows.
 */
export async function getTopRoutes(p: TopRoutesParams): Promise<TopRouteRow[]> {
  return unstable_cache(
    () => queryTopRoutes(p),
    ["top-routes", p.week ?? "", String(p.limit), p.metric, String(p.thresholdSec), p.mode ?? ""],
    { revalidate: 3600 },
  )();
}

/**
 * Collapse multi-platform train stations into one row per station: sum events
 * and event-weight the average delay and on-time %. Non-platform stops pass
 * through unchanged (see {@link stationId}). Keeps the per-stop table, map, and
 * line diagram from showing the same station once per platform.
 * @param rows - Per-stop rows for the window (busiest first).
 * @returns Rows with train platforms merged by station, re-sorted busiest first.
 */
function collapseStations(rows: RouteByStop[]): RouteByStop[] {
  const acc = new Map<string, { row: RouteByStop; delaySum: number; otCount: number }>();
  for (const r of rows) {
    const id = stationId(r.stop_id, r.name, stationPartsOf(r));
    const delaySum = (r.avg_delay_sec ?? 0) * r.events;
    const otCount = ((r.on_time_pct ?? 0) / 100) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.delaySum += delaySum;
      cur.otCount += otCount;
    } else {
      // The merged row is the station, so it carries no single platform's grouping.
      acc.set(id, {
        row: {
          ...r,
          stop_id: id,
          name: stationName(r.name),
          parent_station: undefined,
          platform_code: undefined,
        },
        delaySum,
        otCount,
      });
    }
  }
  return [...acc.values()]
    .map(({ row, delaySum, otCount }) => ({
      ...row,
      avg_delay_sec: row.events ? Math.round((delaySum / row.events) * 10) / 10 : null,
      on_time_pct: row.events ? Math.round((otCount / row.events) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.events - a.events);
}

/**
 * Run the route-stats aggregations (summary + per-stop) against MongoDB.
 * @param p - Validated parameters; window defaults to the last 7 days.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns Summary and top stops.
 */
async function queryRouteStats(p: RouteStatsParams, classified: boolean): Promise<RouteStats> {
  const start = p.from ?? new Date(Date.now() - 7 * MS_IN_DAY);
  const end = p.to ?? new Date();

  // Resolve the slug to every version's id so the stats cover the whole route's
  // history; read metadata from the newest version.
  const routeIds = await routeIdsForSlug(p.routeId);
  const route = await prisma.route.findUnique({
    where: { id: routeIds[0] },
    select: { shortName: true, longName: true, mode: true, colour: true },
  });
  // Single route, so the mode is fixed: use its asymmetric on-time window.
  const mode = route?.mode ?? "BUS";

  const match = {
    routeId: { $in: routeIds },
    scheduledAt: scheduledAtWindow({ start, end }),
    ...realDeviationMatchFor(classified),
  };

  const summaryResult = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: match },
        {
          $group: {
            _id: null,
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            on_time_count: onTimeSingleModeSum(mode),
            early_count: earlySingleModeSum(mode),
            late_count: lateSum(),
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
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: RouteSummary[] } };

  const byStopResult = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: match },
        {
          $group: {
            _id: "$stopId",
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            on_time_count: onTimeSingleModeSum(mode),
          },
        },
        {
          $addFields: {
            on_time_pct: {
              $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100],
            },
          },
        },
        {
          $lookup: {
            from: "Stop",
            localField: "_id",
            foreignField: "_id",
            as: "stop",
          },
        },
        { $unwind: "$stop" },
        { $sort: { events: -1 as const } },
        { $limit: 200 },
        {
          $project: {
            _id: 0,
            stop_id: { $toString: "$_id" },
            name: "$stop.name",
            lat: "$stop.lat",
            lon: "$stop.lon",
            events: 1,
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            on_time_pct: { $round: ["$on_time_pct", 1] },
            ...stationProjection,
          },
        },
      ],
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: RouteByStop[] } };

  return {
    route: route
      ? {
          shortName: route.shortName,
          longName: route.longName,
          mode: route.mode,
          colour: route.colour ?? null,
        }
      : null,
    summary: summaryResult.cursor.firstBatch[0] ?? null,
    byStop: collapseStations(byStopResult.cursor.firstBatch),
  };
}

/** Cache TTL for a completed, classified service day's aggregation (seconds). */
const COMPLETED_DAY_REVALIDATE = 7 * 86_400;

/**
 * Whether the nightly aggregate has written a `DailyRouteSummary` for a
 * service date. The aggregate classifies the day's ghost readings before it
 * writes the summaries, so a summary means the day's boards are final. One
 * indexed point read, cached for five minutes so a day's caches move to the
 * long TTL within that of the summary landing.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns True once the day has a summary.
 */
async function summaryExistsFor(date: string): Promise<boolean> {
  return unstable_cache(
    async () => {
      const row = await prisma.dailyRouteSummary.findFirst({
        where: { date: nzServiceDayRange(date).start },
        select: { id: true },
      });
      return row !== null;
    },
    ["summary-exists", date],
    { revalidate: 300 },
  )();
}

/**
 * Whether every service day in a window is complete and summarised, so an
 * aggregation over it can be held for a week. Null stands for a window that
 * follows the live day.
 * @param range - The queried half-open window, or null.
 * @returns True when the window's result can no longer change.
 */
async function rangeIsFinal(range: DateRange | null): Promise<boolean> {
  if (range === null || range.end > nzServiceDayRange().start) return false;
  const dates = serviceDatesInRange(range);
  if (dates.length === 0) return false;
  return (await Promise.all(dates.map(summaryExistsFor))).every(Boolean);
}

/**
 * Cache a date-scoped ArrivalEvent aggregation. A window over completed days
 * holds for a week once every day in it is summarised: the nightly aggregate
 * classifies ghost readings some twenty hours after a day ends, and a board
 * computed before that would otherwise pin the unclassified result. Until
 * then, and for a window touching the live day, the caller's short TTL
 * applies. The Data Cache judges staleness by the calling TTL, so the key
 * carries the state as well: once the summary lands the key changes and the
 * earlier entry is abandoned rather than kept fresh under the long TTL. A
 * week bounds staleness if a past day is ever re-ingested while still
 * covering a day's ~2-week navigable life in one computation.
 * The same flag tells the producer whether the window is classified, so its
 * pipeline can drop the unclassified magnitude guard (see
 * {@link realDeviationMatchFor}); a window mixing classified and live days
 * keeps the guard.
 * @param fn - Produces the value on a miss; receives whether the window is classified.
 * @param keyParts - Cache key, unique to the query and its window.
 * @param range - The queried half-open window, or null for a rolling live one.
 * @param liveRevalidate - TTL while the window can still change, in seconds.
 * @returns The cached or fresh value.
 */
async function cachedForRange<T>(
  fn: (classified: boolean) => Promise<T>,
  keyParts: string[],
  range: DateRange | null,
  liveRevalidate: number,
): Promise<T> {
  const final = await rangeIsFinal(range);
  return unstable_cache(fn, [...keyParts, final ? "final" : "live"], {
    revalidate: final ? COMPLETED_DAY_REVALIDATE : liveRevalidate,
  })(final);
}

/**
 * {@link cachedForRange} for one service day.
 * @param fn - Produces the value on a miss; receives whether the day is classified.
 * @param keyParts - Cache key, unique to the query and its day.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param liveRevalidate - TTL while the day can still change, in seconds.
 * @returns The cached or fresh value.
 */
function cachedForDay<T>(
  fn: (classified: boolean) => Promise<T>,
  keyParts: string[],
  date: string,
  liveRevalidate: number,
): Promise<T> {
  return cachedForRange(fn, keyParts, nzServiceDayRange(date), liveRevalidate);
}

/**
 * The `scheduledAt` match for a stats aggregation over a window. The ingest
 * stores AT's predicted arrival for every remaining stop of a running trip and
 * revises it each poll until the vehicle passes, so a window reaching past the
 * present would count guesses for stops not yet due; the end is clipped to now.
 * Windows over completed days are returned as they are. Callers cache the live
 * day for minutes, so the clip advances with the cache.
 * @param range - UTC half-open window.
 * @returns The `$gte`/`$lt` bounds in extended JSON.
 */
function scheduledAtWindow(range: DateRange): { $gte: { $date: string }; $lt: { $date: string } } {
  const end = range.end.getTime() > Date.now() ? new Date() : range.end;
  return { $gte: { $date: range.start.toISOString() }, $lt: { $date: end.toISOString() } };
}

/**
 * The cached worst runs for one service day. Key and TTL live here so the week
 * and month boards and the cache pre-warm route hit the same Data Cache entries.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst runs.
 */
export function cachedWorstTripsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameTrip[]> {
  return cachedForDay(
    (classified) => worstTripsForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["shame-trip-worst-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * The cached worst routes for one service day. Same key/TTL ownership as
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst routes.
 */
export function cachedWorstRoutesOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameRouteRow[]> {
  return cachedForDay(
    (classified) => worstRoutesForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["shame-route-worst-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * The cached worst stops for one service day. Same key/TTL ownership as
 * {@link cachedWorstTripsOfDay}.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param mode - Route mode filter (null = every mode).
 * @param includeSchool - Whether school services are included.
 * @param revalidate - TTL for the live day, in seconds.
 * @returns The day's worst stops.
 */
export function cachedWorstStopsOfDay(
  date: string,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  revalidate: number,
): Promise<ShameDayStop[]> {
  return cachedForDay(
    (classified) => worstStopsForRange(nzServiceDayRange(date), mode, includeSchool, classified),
    ["worst-stops-of-day", date, mode ?? "all", includeSchool ? "school" : "no-school"],
    date,
    revalidate,
  );
}

/**
 * Summarise a route's performance over a window (defaults to the last 7 days).
 * Cached briefly; shared by the route page and the API route.
 * @param p - Validated parameters.
 * @returns Summary and top stops.
 */
export async function getRouteStats(p: RouteStatsParams): Promise<RouteStats> {
  return cachedForRange(
    (classified) => queryRouteStats(p, classified),
    [
      "route-stats",
      p.routeId,
      p.from?.toISOString() ?? "",
      p.to?.toISOString() ?? "",
      String(p.thresholdSec),
    ],
    // The rolling default (no from/to) tracks the live day.
    p.from && p.to ? { start: p.from, end: p.to } : null,
    300,
  );
}

/**
 * Per-route aggregated rows from `DailyRouteSummary`. Per-day stats are weighted
 * by event count so the multi-day average is correct. Returns empty when no
 * summaries exist for the window (e.g. the current service day hasn't been
 * aggregated yet).
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one summary in the window.
 */
async function querySummaryRankings(range: DateRange): Promise<TopRouteRow[]> {
  // A summary row for the current service day would be a mid-day snapshot;
  // the live day is always read from ArrivalEvent (see queryRankings).
  const end = new Date(Math.min(range.end.getTime(), nzServiceDayRange().start.getTime()));
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "DailyRouteSummary",
      pipeline: [
        {
          $match: {
            date: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: end.toISOString() },
            },
          },
        },
        {
          $group: {
            _id: "$routeId",
            events: { $sum: "$events" },
            w_delay: { $sum: { $multiply: [{ $ifNull: ["$avgDelaySec", 0] }, "$events"] } },
            w_abs: { $sum: { $multiply: [{ $ifNull: ["$avgAbsDelaySec", 0] }, "$events"] } },
            w_on_time: { $sum: { $multiply: [{ $ifNull: ["$onTimePct", 0] }, "$events"] } },
            w_early: { $sum: { $multiply: [{ $ifNull: ["$earlyPct", 0] }, "$events"] } },
            w_late: { $sum: { $multiply: [{ $ifNull: ["$latePct", 0] }, "$events"] } },
          },
        },
        { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
        { $unwind: "$route" },
        {
          $project: {
            _id: 0,
            route_id: { $toString: "$_id" },
            short_name: "$route.shortName",
            long_name: "$route.longName",
            mode: "$route.mode",
            events: 1,
            // Guard the divisor as the live path does: Mongo throws on a zero
            // divisor, so one stored row with events 0 would fail the whole page.
            avg_delay_sec: { $round: [{ $divide: ["$w_delay", { $max: [1, "$events"] }] }, 1] },
            avg_abs_delay_sec: { $round: [{ $divide: ["$w_abs", { $max: [1, "$events"] }] }, 1] },
            on_time_pct: { $round: [{ $divide: ["$w_on_time", { $max: [1, "$events"] }] }, 1] },
            early_pct: { $round: [{ $divide: ["$w_early", { $max: [1, "$events"] }] }, 1] },
            late_pct: { $round: [{ $divide: ["$w_late", { $max: [1, "$events"] }] }, 1] },
            colour: "$route.colour",
          },
        },
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };
  return result.cursor.firstBatch;
}

/**
 * Per-route aggregated rows scanned live from `ArrivalEvent`. Slower than
 * {@link querySummaryRankings} but always reflects the current service day.
 * Used as a fallback when today's `DailyRouteSummary` hasn't been written yet.
 * @param range - UTC half-open window.
 * @returns Rows for every route with at least one qualifying event in the window.
 */
async function queryLiveRankings(range: DateRange): Promise<TopRouteRow[]> {
  // Inline real-reading condition used for the weighted sums. The total `events`
  // count includes every row so no route falls below the rankings threshold;
  // delay averages use only the readings the nightly pass kept. Only days
  // without a summary reach this scan, so the window is never classified and
  // the magnitude guard stays on.
  const plausible = realDeviationExprFor(false);
  const result = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            scheduledAt: scheduledAtWindow(range),
            source: { $ne: NO_DELAY_SOURCE },
            // No deviation filter here: every event counted so ghost-run noise
            // does not hide a route from rankings.
          },
        },
        {
          $group: {
            _id: "$routeId",
            events: { $sum: 1 },
            // Plausible-event count used as denominator for delay averages so
            // ghost runs do not skew the mean.
            _plausible: { $sum: { $cond: [plausible, 1, 0] } },
            w_delay: { $sum: { $cond: [plausible, "$deviationSec", 0] } },
            w_abs: { $sum: { $cond: [plausible, { $abs: "$deviationSec" }, 0] } },
            ...onTimeTwoCounts(),
            ...earlyTwoCounts(),
            late_count: lateSum(),
          },
        },
        { $lookup: { from: "Route", localField: "_id", foreignField: "_id", as: "route" } },
        { $unwind: "$route" },
        { $addFields: { on_time_count: pickOnTimeByRouteMode, early_count: pickEarlyByRouteMode } },
        {
          $project: {
            _id: 0,
            route_id: { $toString: "$_id" },
            short_name: "$route.shortName",
            long_name: "$route.longName",
            mode: "$route.mode",
            colour: "$route.colour",
            events: 1,
            avg_delay_sec: {
              $round: [{ $divide: ["$w_delay", { $max: [1, "$_plausible"] }] }, 1],
            },
            avg_abs_delay_sec: {
              $round: [{ $divide: ["$w_abs", { $max: [1, "$_plausible"] }] }, 1],
            },
            on_time_pct: {
              $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
            },
            early_pct: {
              $round: [{ $multiply: [{ $divide: ["$early_count", "$events"] }, 100] }, 1],
            },
            late_pct: {
              $round: [{ $multiply: [{ $divide: ["$late_count", "$events"] }, 100] }, 1],
            },
          },
        },
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as { cursor: { firstBatch: TopRouteRow[] } };
  return result.cursor.firstBatch;
}

/**
 * Service dates inside a window that already have a `DailyRouteSummary`, read
 * from the summary date index. The current service day is never counted even
 * when a summary row exists for it: a summary written mid-day is a snapshot,
 * and the live day must stay live.
 * @param range - UTC half-open window.
 * @returns The summarised service dates (`YYYY-MM-DD`).
 */
async function summaryDatesIn(range: DateRange): Promise<Set<string>> {
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "DailyRouteSummary",
      pipeline: [
        {
          $match: {
            date: {
              $gte: { $date: range.start.toISOString() },
              $lt: { $date: range.end.toISOString() },
            },
          },
        },
        { $group: { _id: "$date" } },
      ] as never,
      cursor: {},
    }),
  )) as unknown as { cursor: { firstBatch: { _id: { $date: string } | string }[] } };
  const today = nzServiceDayString();
  const dates = res.cursor.firstBatch.map((r) => nzServiceDayString(new Date(toIso(r._id))));
  return new Set(dates.filter((date) => date < today));
}

/**
 * Live per-route rows for one service day, cached under the day so every
 * window that covers the day shares one aggregation. Completed days hold for a
 * week; the live day refreshes every five minutes.
 * @param date - Service date (`YYYY-MM-DD`).
 * @returns Per-route rows for that day.
 */
function cachedLiveRankingsOfDay(date: string): Promise<TopRouteRow[]> {
  return cachedForDay(
    () => queryLiveRankings(nzServiceDayRange(date)),
    ["live-rankings-day", date],
    date,
    300,
  );
}

/**
 * Per-route aggregated rows for an arbitrary window: `DailyRouteSummary` rows
 * for the service days the nightly aggregate has covered, plus a live
 * `ArrivalEvent` scan of each remaining day that has started (today, and any
 * earlier day whose aggregate has not run), merged by event weight and folded
 * to one row per line (see {@link foldLineageRows}). A window that is entirely
 * summarised costs one query; a window reaching into today costs one more,
 * cached per day. Days that have not started are skipped.
 * @param range - UTC half-open window.
 * @returns Per-route rows.
 */
async function queryRankings(range: DateRange): Promise<TopRouteRow[]> {
  const summarised = await summaryDatesIn(range);
  const now = new Date();
  const liveDates = serviceDatesInRange(range).filter(
    (date) => !summarised.has(date) && nzServiceDayRange(date).start <= now,
  );
  const [summaryRows, ...liveSets] = await Promise.all([
    summarised.size > 0 ? querySummaryRankings(range) : Promise.resolve<TopRouteRow[]>([]),
    ...liveDates.map(cachedLiveRankingsOfDay),
  ]);
  return foldLineageRows([...summaryRows, ...liveSets.flat()]);
}

/**
 * Cached per-route rows for a window.
 * @param range - UTC half-open window.
 * @param thresholdSec - On-time threshold in seconds.
 * @param revalidate - Cache TTL in seconds.
 * @returns Per-route rows.
 */
export async function getRankings(
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<TopRouteRow[]> {
  return unstable_cache(
    () => queryRankings(range),
    ["rankings", range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    { revalidate },
  )();
}

/**
 * The scheduled time of the event at one end of the collection, read via the
 * `scheduledAt` index (sort + limit 1) so it stays cheap as the collection
 * grows. The `$group`/`$max` alternative scans every document - at 3M+ events
 * that is a 15s+ query on the shared cluster.
 * @param direction - 1 for the earliest event, -1 for the latest.
 * @returns That event's `scheduledAt`, or null when the collection is empty.
 */
async function endpointEventTime(direction: 1 | -1): Promise<Date | null> {
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $sort: { scheduledAt: direction } },
        { $limit: 1 },
        { $project: { _id: 0, scheduledAt: 1 } },
      ] as never,
      cursor: {},
    }),
  )) as unknown as { cursor: { firstBatch: { scheduledAt?: { $date: string } | string }[] } };
  const raw = res.cursor.firstBatch[0]?.scheduledAt;
  if (!raw) return null;
  return new Date(typeof raw === "string" ? raw : raw.$date);
}

/**
 * How many service days {@link findQualifyingDataDay} walks inward from the
 * collection's edge before giving up. Independent of the retention window: 21
 * consecutive sub-threshold days at an edge means the qualifying threshold is
 * effectively never met, and each step costs an indexed count.
 */
const DATA_DAY_WALK_LIMIT = 21;

/**
 * The service day nearest one end of the collection with at least `minEvents`
 * events: starts at the end event's own service day and steps inward one day at
 * a time, checking each with an indexed range count. The end event's day always
 * holds at least one event, so `minEvents <= 1` resolves with no counting and a
 * higher threshold typically counts a single day.
 * @param direction - 1 to search from the earliest event forward, -1 from the latest back.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns The qualifying service date (`YYYY-MM-DD`), or null when none is found.
 */
async function findQualifyingDataDay(direction: 1 | -1, minEvents: number): Promise<string | null> {
  const endpoint = await endpointEventTime(direction);
  if (!endpoint) return null;
  let day = nzServiceDayString(endpoint);
  for (let i = 0; i < DATA_DAY_WALK_LIMIT; i++) {
    if (i === 0 && minEvents <= 1) return day;
    const range = nzServiceDayRange(day);
    const n = await prisma.arrivalEvent.count({
      where: { scheduledAt: { gte: range.start, lt: range.end } },
    });
    if (n >= minEvents) return day;
    // Step inward: forward from the earliest end, back from the latest.
    day = shiftWeek(day, direction);
  }
  return null;
}

/**
 * A Date at local noon within a service day, so `nzServiceDayRange` anchors on
 * the right day regardless of DST offset.
 * @param day - Service date as `YYYY-MM-DD`.
 * @returns Noon (Auckland-local) within that service day.
 */
function dataDayNoon(day: string): Date {
  // The range starts at SERVICE_START_HOUR (5am local); +7h lands at local noon.
  return new Date(nzServiceDayRange(day).start.getTime() + 7 * 60 * 60 * 1000);
}

/**
 * The most recent event's scheduled time, for empty-window fallback.
 * @returns The max `scheduledAt`, or null when there are no events.
 */
export async function getLatestEventDate(): Promise<Date | null> {
  // Indexed endpoint lookup; still cached because the latest event only
  // advances once per ingest cycle and this sits on the rankings page's
  // critical path.
  const iso = await unstable_cache(
    async () => (await endpointEventTime(-1))?.toISOString() ?? null,
    ["latest-event-date"],
    { revalidate: 600 },
  )();
  return iso ? new Date(iso) : null;
}

/**
 * The most recent Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages fall back to this when the current service day is
 * sparse. Service-day bucketing matches `nzServiceDayString`, so a post-midnight
 * run counts under the day it started.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getMostRecentDataDay(minEvents: number): Promise<Date | null> {
  const day = await unstable_cache(
    () => findQualifyingDataDay(-1, minEvents),
    ["most-recent-data-day", String(minEvents)],
    { revalidate: 600 },
  )();
  return day ? dataDayNoon(day) : null;
}

/**
 * The earliest Auckland-local **service day** that has at least `minEvents`
 * events. Day-focused pages use this to stop the day stepper paging back past
 * where data exists. Buckets match {@link getMostRecentDataDay}, so the
 * boundary is symmetric.
 * @param minEvents - Minimum events a service day needs to qualify.
 * @returns A Date inside that service day (its local noon), or null when empty.
 */
export async function getEarliestDataDay(minEvents: number): Promise<Date | null> {
  const day = await unstable_cache(
    () => findQualifyingDataDay(1, minEvents),
    ["earliest-data-day", String(minEvents)],
    // Moves when the nightly cleanup prunes the oldest day; ten minutes, like
    // the latest/most-recent markers, so the day stepper cannot offer a day
    // that was just deleted for hours.
    { revalidate: 600 },
  )();
  return day ? dataDayNoon(day) : null;
}

/**
 * Stop ids a route has actually served (recorded an arrival at) in the last
 * `days`. The route diagram uses this to drop pattern stops the route never
 * really stops at (origin termini, never-served variants, id mismatches), while
 * keeping recently-active stops that merely lack today's data. Cached hourly.
 * @param routeId - AT route id.
 * @param days - How many days back to consider a stop active (default 7).
 * @returns The set of active stop ids.
 */
export async function getRecentStopIds(routeId: string, days = 7): Promise<Set<string>> {
  const since = new Date(Date.now() - days * MS_IN_DAY);
  const ids = await unstable_cache(
    async () => {
      const routeIds = await routeIdsForSlug(routeId);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: { $gte: { $date: since.toISOString() } },
              },
            },
            { $group: { _id: "$stopId" } },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string }[] } };
      return res.cursor.firstBatch.map((r) => r._id);
    },
    ["recent-stops", routeId, String(days), since.toISOString().slice(0, 10)],
    { revalidate: 3600 },
  )();
  return new Set(ids);
}

/** Parameters for {@link getWorstTripsOfDay}. */
export interface WorstTripsParams {
  routeId: string;
  range: DateRange;
  thresholdSec: number;
  limit?: number;
  /** How to order the runs (default "off" = most off-schedule). */
  sort?: TripSort;
}

/** Ordering for {@link getWorstTripsOfDay}. */
export type TripSort = "off" | "late" | "early" | "departure";

/** Mongo `$sort` stage for each trip ordering. */
const TRIP_SORTS: Record<TripSort, Record<string, 1 | -1>> = {
  off: { avg_abs_delay_sec: -1 },
  late: { avg_delay_sec: -1 },
  early: { avg_delay_sec: 1 },
  departure: { scheduled_start: 1 },
};

/** Raw worst-trips row before the `scheduled_start` date is normalised. */
interface WorstTripRaw extends Omit<PerTripStat, "scheduled_start"> {
  scheduled_start: { $date: string } | string;
}

/**
 * List each run (trip) of a route on a day, ordered by `sort` (default most
 * off-schedule by average absolute deviation). The signed average is kept so the
 * board can still show late/early direction. Cached briefly.
 * @param p - Route, day window, on-time threshold, optional row limit and sort.
 * @returns Per-trip rows ordered by `sort` (up to `limit`, default 50).
 */
export async function getWorstTripsOfDay(p: WorstTripsParams): Promise<PerTripStat[]> {
  const limit = p.limit ?? 50;
  const sort = p.sort ?? "off";
  return cachedForRange(
    async (classified) => {
      const routeIds = await routeIdsForSlug(p.routeId);
      const real = realDeviationExprFor(classified);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                routeId: { $in: routeIds },
                scheduledAt: scheduledAtWindow(p.range),
                // No deviation filter here: every trip that had any event is
                // counted so the total reflects real runs, not just those within
                // the noise-free window.
              },
            },
            // Sort by time first so $first/$last within the group give the
            // chronological first/last stop, not an arbitrary document order.
            { $sort: { tripId: 1, scheduledAt: 1 } },
            {
              $group: {
                _id: "$tripId",
                scheduled_start: { $min: "$scheduledAt" },
                first_stop_id: { $first: "$stopId" },
                // Real readings only: a ghost re-report contributes null to each
                // list and is dropped below, so the stop count, the vehicle and
                // the stats all describe the run itself. A ghost comes from a
                // different vehicle, so its id would name the wrong bus, and it
                // repeats a stop the run already served, so counting rows would
                // overstate the stops.
                _delays: { $push: { $cond: [real, "$deviationSec", null] } },
                _stops: { $addToSet: { $cond: [real, "$stopId", null] } },
                _vehicles: { $push: { $cond: [real, { $ifNull: ["$vehicleId", null] }, null] } },
              },
            },
            {
              $addFields: {
                _ok: { $filter: { input: "$_delays", as: "d", cond: { $ne: ["$$d", null] } } },
                stops: {
                  $size: { $filter: { input: "$_stops", as: "s", cond: { $ne: ["$$s", null] } } },
                },
                // The chronologically first real reading names the vehicle.
                vehicle_id: {
                  $first: {
                    $filter: { input: "$_vehicles", as: "v", cond: { $ne: ["$$v", null] } },
                  },
                },
              },
            },
            {
              $addFields: {
                avg_delay_sec: { $avg: "$_ok" },
                avg_abs_delay_sec: {
                  $avg: { $map: { input: "$_ok", as: "d", in: { $abs: "$$d" } } },
                },
                worst_delay_sec: { $max: "$_ok" },
              },
            },
            // AT issues several trip_ids for one physical run, so collapse runs that
            // share the same Auckland-local start minute and stop count into one
            // (keeping the most off-schedule). Done before the metric sort + limit so
            // the board and the Trips count reflect real runs.
            {
              $addFields: {
                _minute: {
                  $dateToString: {
                    date: "$scheduled_start",
                    format: "%Y-%m-%dT%H:%M",
                    timezone: NZ_TZ,
                  },
                },
              },
            },
            { $sort: { _minute: 1, stops: -1, avg_abs_delay_sec: -1 } },
            { $group: { _id: { m: "$_minute", s: "$stops" }, doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
            { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
            { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
            { $sort: TRIP_SORTS[sort] },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                trip_id: { $toString: "$_id" },
                vehicle_id: 1,
                scheduled_start: 1,
                stops: 1,
                avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                worst_delay_sec: 1,
                headsign: { $ifNull: ["$meta.headsign", null] },
                direction_id: { $ifNull: ["$meta.directionId", null] },
                first_stop_id: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: WorstTripRaw[] } };
      return res.cursor.firstBatch.map((t) => ({
        ...t,
        scheduled_start: toIso(t.scheduled_start),
      }));
    },
    [
      "worst-trips",
      p.routeId,
      p.range.start.toISOString(),
      p.range.end.toISOString(),
      String(limit),
      sort,
    ],
    p.range,
    300,
  );
}

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

/** Fewest stops a run must have to qualify for the Shame board (drops flukes). */
const SHAME_MIN_STOPS = 5;

/** Raw Shame row before its `scheduled_start` date is normalised. */
interface ShameTripRaw extends Omit<
  ShameTrip,
  "scheduled_start" | "short_name" | "long_name" | "mode"
> {
  scheduled_start: { $date: string } | string;
  short_name?: string | null;
  long_name?: string | null;
  mode?: string | null;
}

/** School-service code regex (mirrors `isSchoolBus`) for the Shame filter. */
const SCHOOL_BUS_REGEX = "^S[0-9]{3}[A-Z]*$";

/** Which runs the Shame board considers - mirrors the home page's filters. */
export interface ShameFilter {
  /** Restrict to this mode; null/undefined means every mode. */
  mode?: "BUS" | "TRAIN" | "FERRY" | null;
  /** Include school services (default false, matching the home page default). */
  includeSchool?: boolean;
}

/**
 * The day's "Shame of the Day": the single most off-schedule run plus the worst
 * run of each hour, within the chosen filter. A run is ranked by its average
 * absolute deviation and attributed to the Auckland-local hour of its first
 * scheduled stop; runs shorter than {@link SHAME_MIN_STOPS} stops are excluded so
 * a stray one-stop feed sample can't top the board. The mode/school filters are
 * applied before the per-hour pick, so the worst always reflects what is shown
 * on the home page. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school filters mirroring the home page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The day's worst run and the per-hour worst list (earliest hour first).
 */
export async function getShameOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return cachedForRange(
    async (classified) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: scheduledAtWindow(range),
            ...realDeviationMatchFor(classified),
          },
        },
        // One row per run, with its off-schedule magnitude and owning route.
        {
          $group: {
            _id: "$tripId",
            route_id: { $first: "$routeId" },
            scheduled_start: { $min: "$scheduledAt" },
            _stops: { $addToSet: "$stopId" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            avg_delay_sec: { $avg: "$deviationSec" },
            worst_delay_sec: { $max: "$deviationSec" },
          },
        },
        // Distinct stops with a real reading; rows would double-count a stop
        // that carries both a real arrival and a re-report.
        { $addFields: { stops: { $size: "$_stops" } } },
        { $match: { stops: { $gte: SHAME_MIN_STOPS } } },
        { $lookup: { from: "Route", localField: "route_id", foreignField: "_id", as: "route" } },
        { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
        { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
      ];
      // Apply the home page's filters *before* the per-hour pick, so the worst of
      // an hour is the worst among the runs the page would actually show.
      if (mode) pipeline.push({ $match: { "route.mode": mode } });
      if (!includeSchool) {
        pipeline.push({
          $match: {
            $expr: {
              $not: {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.shortName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.longName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                ],
              },
            },
          },
        });
      }
      pipeline.push(
        {
          $addFields: {
            hour: { $hour: { date: "$scheduled_start", timezone: NZ_TZ } },
          },
        },
        // Sort worst-first, then keep the worst run of each hour ($first after the
        // sort = the most off-schedule run in that hour).
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$hour",
            trip_id: { $first: { $toString: "$_id" } },
            route_id: { $first: "$route_id" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            scheduled_start: { $first: "$scheduled_start" },
            stops: { $first: "$stops" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
            worst_delay_sec: { $first: "$worst_delay_sec" },
            headsign: { $first: "$meta.headsign" },
          },
        },
        {
          $project: {
            _id: 0,
            hour: "$_id",
            trip_id: 1,
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            scheduled_start: 1,
            stops: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
            worst_delay_sec: 1,
            headsign: 1,
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: ShameTripRaw[] } };

      const hours: ShameTrip[] = res.cursor.firstBatch.map((t) => ({
        hour: t.hour,
        trip_id: t.trip_id,
        route_id: t.route_id,
        short_name: t.short_name ?? null,
        long_name: t.long_name ?? "",
        mode: t.mode ?? "BUS",
        colour: t.colour ?? null,
        scheduled_start: toIso(t.scheduled_start),
        stops: t.stops,
        avg_abs_delay_sec: t.avg_abs_delay_sec,
        avg_delay_sec: t.avg_delay_sec,
        worst_delay_sec: t.worst_delay_sec,
        headsign: t.headsign ?? null,
      }));
      // Service-day order: 5am is first, post-midnight runs (12am-4am) are last.
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameTrip | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "shame-of-day",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    range,
    revalidate,
  );
}

/**
 * Count consecutive service days (ending today) on which `routeId` held the
 * highest average absolute delay across all routes - i.e. how many days in a
 * row this route has been "featured" as the shame of the day. Queries
 * DailyRouteSummary (pre-aggregated, fast). Returns 0 when the route was not
 * today's top, or when there is no data.
 * @param routeId - The GTFS route_id to track.
 * @param currentRange - UTC half-open window for today's service day.
 * @param revalidate - Cache lifetime in seconds.
 * @returns Number of consecutive days this route topped the shame list.
 */
export async function getShameRouteStreak(
  routeId: string,
  currentRange: DateRange,
  revalidate: number,
): Promise<number> {
  return unstable_cache(
    async () => {
      const sevenDaysAgo = new Date(currentRange.end.getTime() - 7 * MS_IN_DAY);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "DailyRouteSummary",
          pipeline: [
            {
              $match: {
                date: {
                  $gte: { $date: sevenDaysAgo.toISOString() },
                  $lt: { $date: currentRange.end.toISOString() },
                },
              },
            },
            // Sort so that within each date the highest-delay route comes first,
            // then $first picks it up as the day's top route.
            { $sort: { date: 1, avgAbsDelaySec: -1 } },
            {
              $group: {
                _id: "$date",
                topRouteId: { $first: "$routeId" },
              },
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                _id: 0,
                date: {
                  $dateToString: {
                    date: "$_id",
                    format: "%Y-%m-%d",
                    timezone: NZ_TZ,
                  },
                },
                topRouteId: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: { firstBatch: { date: string; topRouteId: string }[] };
      };

      const rows = res.cursor.firstBatch;
      // Require day-on-day adjacency so a date with no summary row breaks the
      // run instead of being silently bridged.
      let count = 0;
      let expectedDate: string | null = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row === undefined) break;
        if (expectedDate !== null && row.date !== expectedDate) break;
        if (row.topRouteId === routeId) {
          count++;
          expectedDate = shiftWeek(row.date, -1);
        } else {
          break;
        }
      }
      return count;
    },
    ["shame-route-streak", routeId, currentRange.end.toISOString()],
    { revalidate },
  )();
}

/**
 * For each route in `routeIds`, compute its consecutive-day streak (ending
 * today) and the total number of hourly slots it was the worst route across
 * all previous streak days (today's hours are tracked separately by the caller).
 *
 * Runs one ArrivalEvent aggregation over the past 14 days: group by trip >
 * bucket by (serviceDay, hour) > pick worst route per slot > count hours per
 * (serviceDay, routeId) > collect per day. Streak breaks when a route is absent
 * from a day's shame set or when a day has no data at all.
 *
 * Today counts as day 1 by definition (caller confirms all routeIds are on
 * today's shame list). Result caps at 15 (today + 14 prior days).
 * @param routeIds - Route IDs to check (from today's shame list).
 * @param currentRange - UTC half-open window for today's service day.
 * @param filter - Mode/school filter matching the active shame page view.
 * @param filter.mode - Restrict to this mode; null means all modes.
 * @param filter.includeSchool - Include school services (default false).
 * @returns Map of routeId to `{ count, prevHours, prevWorstOfDayDays }` - streak
 *   length (min 1), total hourly-slot appearances across *previous* streak days,
 *   and the count of consecutive prior days on which this route was also the
 *   worst of the day (highest avg absolute delay across all slots).
 */
export async function getShameRouteStreaksBatch(
  routeIds: string[],
  currentRange: DateRange,
  filter: ShameFilter,
): Promise<Map<string, { count: number; prevHours: number; prevWorstOfDayDays: number }>> {
  if (routeIds.length === 0) return new Map();
  const { mode = null, includeSchool = false } = filter;

  // Cache keyed only by day+filter, NOT by routeIds. The pipeline scans all
  // routes anyway; including routeIds in the key caused a cache miss whenever
  // the visible route set grew during the day, re-running the full 14-day
  // aggregation on every new hourly cycle.
  const fourteenDaysAgo = new Date(currentRange.start.getTime() - 14 * MS_IN_DAY);
  const firstBatch = await cachedForRange(
    async (classified) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: fourteenDaysAgo.toISOString() },
              $lt: { $date: currentRange.start.toISOString() },
            },
            ...realDeviationMatchFor(classified),
          },
        },
        // Collapse to one row per (routeId, tripId) so time buckets use trip
        // start rather than individual stop times.
        {
          $group: {
            _id: { routeId: "$routeId", tripId: "$tripId" },
            trip_start: { $min: "$scheduledAt" },
            events: { $sum: 1 },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
          },
        },
        // Service date as the shame pages label it, so the buckets match their
        // day links (every service-day board shares this expression).
        {
          $addFields: {
            serviceDay: serviceDateExpr("$trip_start"),
            hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } },
          },
        },
        // Group by (serviceDay, hour, routeId).
        {
          $group: {
            _id: { serviceDay: "$serviceDay", hour: "$hour", routeId: "$_id.routeId" },
            events: { $sum: "$events" },
            avg_abs_delay_sec: { $avg: "$avg_abs_delay_sec" },
          },
        },
        { $match: { events: { $gte: MIN_ROUTE_EVENTS_HOUR } } },
        // Join Route for mode and school filters.
        { $lookup: { from: "Route", localField: "_id.routeId", foreignField: "_id", as: "route" } },
        { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
      ];

      if (mode) pipeline.push({ $match: { "route.mode": mode } });
      if (!includeSchool) {
        pipeline.push({
          $match: {
            $expr: {
              $not: {
                $or: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.shortName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                  {
                    $regexMatch: {
                      input: { $ifNull: ["$route.longName", ""] },
                      regex: SCHOOL_BUS_REGEX,
                    },
                  },
                ],
              },
            },
          },
        });
      }

      pipeline.push(
        // Worst-first so $first picks the most off-schedule route per slot.
        { $sort: { avg_abs_delay_sec: -1 } },
        // Pick the worst route per (serviceDay, hour); keep its delay for worst-of-day.
        {
          $group: {
            _id: { serviceDay: "$_id.serviceDay", hour: "$_id.hour" },
            worstRouteId: { $first: "$_id.routeId" },
            slotDelay: { $first: "$avg_abs_delay_sec" },
          },
        },
        // Count hourly slots and track the highest slot delay per (serviceDay, route).
        {
          $group: {
            _id: { serviceDay: "$_id.serviceDay", routeId: "$worstRouteId" },
            hourCount: { $sum: 1 },
            maxSlotDelay: { $max: "$slotDelay" },
          },
        },
        // Sort so $first in the collect group picks the route with the highest
        // single-slot delay - matching the page's worst-of-day criterion.
        { $sort: { "_id.serviceDay": 1, maxSlotDelay: -1 } },
        // Collect per-day: worst-of-day route id + array of { routeId, hourCount }.
        {
          $group: {
            _id: "$_id.serviceDay",
            worstOfDayRouteId: { $first: "$_id.routeId" },
            slots: { $push: { routeId: "$_id.routeId", hourCount: "$hourCount" } },
          },
        },
      );

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as {
        cursor: {
          firstBatch: {
            _id: string;
            worstOfDayRouteId: string;
            slots: { routeId: string; hourCount: number }[];
          }[];
        };
      };

      return res.cursor.firstBatch;
    },
    [
      "shame-route-streaks-batch-v5",
      currentRange.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    // The 14-day window ends at the current day's start, so it never includes
    // the live day; it is held long once yesterday's summary exists and
    // refreshed hourly until then.
    { start: fourteenDaysAgo, end: currentRange.start },
    3600,
  );

  // Build lookup structures from the cached data (fast O(n), runs outside cache).
  const shameDays = new Map<string, Set<string>>();
  const routeHoursPerDay = new Map<string, Map<string, number>>();
  const worstOfDayPerDay = new Map<string, string>();
  for (const row of firstBatch) {
    const daySet = new Set<string>();
    const hourMap = new Map<string, number>();
    for (const slot of row.slots) {
      daySet.add(slot.routeId);
      hourMap.set(slot.routeId, slot.hourCount);
    }
    shameDays.set(row._id, daySet);
    routeHoursPerDay.set(row._id, hourMap);
    worstOfDayPerDay.set(row._id, row.worstOfDayRouteId);
  }

  const result = new Map<
    string,
    { count: number; prevHours: number; prevWorstOfDayDays: number }
  >();
  for (const routeId of routeIds) {
    let count = 1; // today is always day 1 (caller confirmed)
    let prevHours = 0;
    let prevWorstOfDayDays = 0;
    // Step by date string, not fixed 24h of milliseconds: a millisecond step
    // drifts an hour off the 5am boundary across a DST change and skips a day.
    let dayKey = shiftWeek(nzServiceDayString(currentRange.start), -1);
    for (let d = 0; d < 14; d++) {
      const daySet = shameDays.get(dayKey);
      if (!daySet || !daySet.has(routeId)) break;
      count++;
      prevHours += routeHoursPerDay.get(dayKey)?.get(routeId) ?? 0;
      // Consecutive worst-of-day run from yesterday backwards.
      if (d === prevWorstOfDayDays && worstOfDayPerDay.get(dayKey) === routeId) {
        prevWorstOfDayDays++;
      }
      dayKey = shiftWeek(dayKey, -1);
    }
    result.set(routeId, { count, prevHours, prevWorstOfDayDays });
  }
  return result;
}

/**
 * Fewest arrival events a route needs in an hour to qualify for the Route Shame
 * board. Counted in stop visits, not trips: one run of a 30-stop route lands ~30
 * events here, so this is roughly a single run's worth - low enough to keep a
 * quiet hour on the board, high enough that a couple of stray stop readings
 * cannot nominate an hour.
 */
const MIN_ROUTE_EVENTS_HOUR = 30;

/**
 * Build the shared route-shame pipeline prefix. Groups by `(routeId, tripId)`
 * first so the time-bucket key is derived from each trip's START time (not the
 * hour of each individual stop). This prevents overnight trips from creating
 * spurious late-night slots on the shame board.
 *
 * Pipeline: match range > group by trip > add `groupKey` from trip start >
 * group by (routeId, key) > enforce min-events > join Route > mode/school filters.
 * The caller appends "pick worst per key" group and projection stages.
 * @param range - The window to query.
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @param groupKey - Name of the field computed by `addFieldsStage`.
 * @param addFieldsStage - `$addFields` stage that computes `groupKey` from `$trip_start`.
 * @returns The partial pipeline array.
 */
function routeShamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  classified: boolean,
  groupKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFieldsStage: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow(range),
        ...realDeviationMatchFor(classified),
      },
    },
    // Collapse to one row per (routeId, tripId) so the time bucket uses trip
    // start time, not individual stop times. This keeps overnight routes from
    // bleeding into post-midnight hour slots they don't actually start in.
    {
      $group: {
        _id: { routeId: "$routeId", tripId: "$tripId" },
        trip_start: { $min: "$scheduledAt" },
        events: { $sum: 1 },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
      },
    },
    { $addFields: addFieldsStage },
    {
      $group: {
        _id: { routeId: "$_id.routeId", [groupKey]: `$${groupKey}` },
        events: { $sum: "$events" },
        avg_abs_delay_sec: { $avg: "$avg_abs_delay_sec" },
        avg_delay_sec: { $avg: "$avg_delay_sec" },
      },
    },
    { $match: { events: { $gte: MIN_ROUTE_EVENTS_HOUR } } },
    { $lookup: { from: "Route", localField: "_id.routeId", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
  ];
  if (mode) pipeline.push({ $match: { "route.mode": mode } });
  if (!includeSchool) {
    pipeline.push({
      $match: {
        $expr: {
          $not: {
            $or: [
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.shortName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.longName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
            ],
          },
        },
      },
    });
  }
  return pipeline;
}

/** Raw route-shame row from the aggregation cursor. */
interface ShameRouteRaw {
  hour: number;
  route_id: string;
  short_name: string | null;
  long_name: string | null;
  mode: string | null;
  colour: string | null;
  events: number;
  avg_abs_delay_sec: number;
  avg_delay_sec: number;
}

/**
 * The day's "Shame of the Day" for routes: the single most off-schedule route
 * plus the worst route of each hour. Groups `ArrivalEvent` by
 * `(routeId, hour)`, takes the worst route per hour, returns them earliest
 * hour first with the overall worst flagged. Cached at the supplied revalidate
 * rate.
 * @param range - The service-day window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-hour worst list.
 */
export async function getShameRouteOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return cachedForRange(
    async (classified) => {
      const pipeline = routeShamePipelineBase(range, mode, includeSchool, classified, "hour", {
        hour: { $hour: { date: "$trip_start", timezone: NZ_TZ } },
      });
      pipeline.push(
        { $sort: { avg_abs_delay_sec: -1 } },
        {
          $group: {
            _id: "$_id.hour",
            route_id: { $first: "$_id.routeId" },
            short_name: { $first: "$route.shortName" },
            long_name: { $first: "$route.longName" },
            mode: { $first: "$route.mode" },
            colour: { $first: "$route.colour" },
            events: { $first: "$events" },
            avg_abs_delay_sec: { $first: "$avg_abs_delay_sec" },
            avg_delay_sec: { $first: "$avg_delay_sec" },
          },
        },
        {
          $project: {
            _id: 0,
            hour: "$_id",
            route_id: 1,
            short_name: 1,
            long_name: 1,
            mode: 1,
            colour: 1,
            events: 1,
            avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
            avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
          },
        },
      );
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: pipeline as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: ShameRouteRaw[] } };

      const hours: ShameRouteRow[] = res.cursor.firstBatch.map((r) => ({
        hour: r.hour,
        route_id: r.route_id,
        short_name: r.short_name ?? null,
        long_name: r.long_name ?? "",
        mode: r.mode ?? "BUS",
        colour: r.colour ?? null,
        events: r.events,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        avg_delay_sec: r.avg_delay_sec,
      }));
      // Service-day order: 5am is first, post-midnight runs (12am-4am) are last.
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameRouteRow | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "shame-route-of-day-v3",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    range,
    revalidate,
  );
}

/**
 * The week's "Shame of the Week" for routes: the single most off-schedule route
 * plus the worst route of each service day. Groups `ArrivalEvent` by
 * `(routeId, serviceDay)`. Mirrors {@link getShameRouteOfDay} but for the week
 * view. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst route and the per-day worst list, earliest day first.
 */
export async function getShameRouteOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameRouteOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstRoutesOfDay(date, mode, includeSchool, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const worst = days.reduce<ShameRouteRow | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst route of each service day within a range (one row per day with
 * data). Used per-day by {@link getShameRouteOfWeek}; left uncached so the
 * caller owns the per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst routes.
 */
async function worstRoutesForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameRouteRow[]> {
  const pipeline = routeShamePipelineBase(range, mode, includeSchool, classified, "serviceDay", {
    serviceDay: serviceDateExpr("$trip_start"),
  });
  pipeline.push(
    // Worst route per service day via a bounded per-group $top (one row per day)
    // instead of a global blocking $sort, which can exceed the cluster's 32MB
    // in-memory sort limit (the tier forbids disk spill).
    {
      $group: {
        _id: "$_id.serviceDay",
        worst: {
          $top: {
            sortBy: { avg_abs_delay_sec: -1 },
            output: {
              route_id: "$_id.routeId",
              short_name: "$route.shortName",
              long_name: "$route.longName",
              mode: "$route.mode",
              colour: "$route.colour",
              events: "$events",
              avg_abs_delay_sec: "$avg_abs_delay_sec",
              avg_delay_sec: "$avg_delay_sec",
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        route_id: "$worst.route_id",
        short_name: "$worst.short_name",
        long_name: "$worst.long_name",
        mode: "$worst.mode",
        colour: "$worst.colour",
        events: "$worst.events",
        avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
        avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
      },
    },
  );
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: pipeline as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as {
    cursor: { firstBatch: (Omit<ShameRouteRaw, "hour"> & { _id: string })[] };
  };

  return res.cursor.firstBatch.map((r) => ({
    hour: 0,
    date: r._id,
    route_id: r.route_id,
    short_name: r.short_name ?? null,
    long_name: r.long_name ?? "",
    mode: r.mode ?? "BUS",
    colour: r.colour ?? null,
    events: r.events,
    avg_abs_delay_sec: r.avg_abs_delay_sec,
    avg_delay_sec: r.avg_delay_sec,
  }));
}

/**
 * Build the shared part of the shame aggregation pipeline: match by date range,
 * group to one row per trip, filter by min stops, join Route + TripMeta, then
 * apply mode/school filters. The caller appends the final hour or service-day
 * grouping.
 * @param range - The window to query.
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether every day in the window has been through the ghost pass.
 * @returns The partial aggregation pipeline array.
 */
function shamePipelineBase(
  range: DateRange,
  mode: string | null,
  includeSchool: boolean,
  classified: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline: any[] = [
    {
      $match: {
        scheduledAt: scheduledAtWindow(range),
        ...realDeviationMatchFor(classified),
      },
    },
    {
      $group: {
        _id: "$tripId",
        route_id: { $first: "$routeId" },
        scheduled_start: { $min: "$scheduledAt" },
        _stops: { $addToSet: "$stopId" },
        avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
        avg_delay_sec: { $avg: "$deviationSec" },
        worst_delay_sec: { $max: "$deviationSec" },
      },
    },
    // Distinct stops with a real reading; rows would double-count a stop
    // that carries both a real arrival and a re-report.
    { $addFields: { stops: { $size: "$_stops" } } },
    { $match: { stops: { $gte: SHAME_MIN_STOPS } } },
    { $lookup: { from: "Route", localField: "route_id", foreignField: "_id", as: "route" } },
    { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "tripMeta", localField: "_id", foreignField: "_id", as: "meta" } },
    { $unwind: { path: "$meta", preserveNullAndEmptyArrays: true } },
  ];
  if (mode) pipeline.push({ $match: { "route.mode": mode } });
  if (!includeSchool) {
    pipeline.push({
      $match: {
        $expr: {
          $not: {
            $or: [
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.shortName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
              {
                $regexMatch: {
                  input: { $ifNull: ["$route.longName", ""] },
                  regex: SCHOOL_BUS_REGEX,
                },
              },
            ],
          },
        },
      },
    });
  }
  return pipeline;
}

/**
 * The week's "Shame of the Week": the single most off-schedule run plus the
 * worst run of each service day, within the chosen filter. Mirrors
 * {@link getShameOfDay} but groups by service day instead of hour, bucketing
 * each run with {@link serviceDateExpr}. Cached at the supplied revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters mirroring the rankings page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst run and the per-day worst list, earliest day first.
 */
export async function getShameOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. This also makes the
  // per-day worst the day's actual worst run (AT reuses tripIds across days, so a
  // single week-wide grouping would otherwise collapse a trip's daily runs).
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstTripsOfDay(date, mode, includeSchool, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const worst = days.reduce<ShameTrip | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst run of each service day within a range (one row per day with data).
 * Used per-day by {@link getShameOfWeek}; left uncached so the caller owns the
 * per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst runs.
 */
async function worstTripsForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameTrip[]> {
  const pipeline = shamePipelineBase(range, mode, includeSchool, classified);
  pipeline.push(
    {
      // Bucket each run by the service day its start falls in, so a
      // post-midnight run lands under the day it belongs to.
      $addFields: { serviceDay: serviceDateExpr("$scheduled_start") },
    },
    // Worst run per service day via a bounded per-group $top (one row per day)
    // instead of a global blocking $sort, which can exceed the cluster's 32MB
    // in-memory sort limit (the tier forbids disk spill).
    {
      $group: {
        _id: "$serviceDay",
        worst: {
          $top: {
            sortBy: { avg_abs_delay_sec: -1 },
            output: {
              trip_id: { $toString: "$_id" },
              route_id: "$route_id",
              short_name: "$route.shortName",
              long_name: "$route.longName",
              mode: "$route.mode",
              colour: "$route.colour",
              scheduled_start: "$scheduled_start",
              stops: "$stops",
              avg_abs_delay_sec: "$avg_abs_delay_sec",
              avg_delay_sec: "$avg_delay_sec",
              worst_delay_sec: "$worst_delay_sec",
              headsign: "$meta.headsign",
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        trip_id: "$worst.trip_id",
        route_id: "$worst.route_id",
        short_name: "$worst.short_name",
        long_name: "$worst.long_name",
        mode: "$worst.mode",
        colour: "$worst.colour",
        scheduled_start: "$worst.scheduled_start",
        stops: "$worst.stops",
        avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
        avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
        worst_delay_sec: "$worst.worst_delay_sec",
        headsign: "$worst.headsign",
      },
    },
  );
  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: pipeline as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as {
    cursor: { firstBatch: (Omit<ShameTripRaw, "hour"> & { _id: string })[] };
  };

  return res.cursor.firstBatch.map((t) => ({
    hour: 0,
    date: t._id,
    trip_id: t.trip_id,
    route_id: t.route_id,
    short_name: t.short_name ?? null,
    long_name: t.long_name ?? "",
    mode: t.mode ?? "BUS",
    colour: t.colour ?? null,
    scheduled_start: toIso(t.scheduled_start),
    stops: t.stops,
    avg_abs_delay_sec: t.avg_abs_delay_sec,
    avg_delay_sec: t.avg_delay_sec,
    worst_delay_sec: t.worst_delay_sec,
    headsign: t.headsign ?? null,
  }));
}

/**
 * Fewest events a stop needs per hour to appear in the Stop Shame hour board.
 * At a stop each calling trip contributes exactly one event, so this reads
 * directly as five services in the hour - the per-stop thresholds need none of
 * the scaling the per-route ones do.
 */
const MIN_STOP_EVENTS_HOUR = 5;

/** Fewest events - so, calling services - a stop needs to qualify for the worst-stops ranking. */
const MIN_STOP_EVENTS = 20;

/** Raw worst-stop row straight from the aggregation (pre platform-collapse). */
interface WorstStopRaw extends StationRow {
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  /** Route ids that served this stop in the window; used to resolve dominant mode. */
  routeIds: string[];
  mode: "BUS" | "TRAIN" | "FERRY"; // resolved in JS, not from the pipeline
}

/**
 * Collapse train-platform rows to one station each (summing events and
 * re-averaging both delay figures by event weight), then re-rank worst-first.
 * Mirrors {@link stationId}/{@link stationName} platform collapsing for the
 * cross-route worst-stops board so a station isn't split across its platforms.
 * @param rows - Raw per-stop rows, richest first.
 * @returns Station-collapsed rows, sorted by off-schedule magnitude descending.
 */
function collapseWorstStops(rows: WorstStopRaw[]): WorstStop[] {
  const acc = new Map<string, { row: WorstStop; absSum: number; signedSum: number }>();
  for (const r of rows) {
    const id = stationId(r.stop_id, r.name, stationPartsOf(r));
    const absSum = r.avg_abs_delay_sec * r.events;
    const signedSum = (r.avg_delay_sec ?? 0) * r.events;
    const cur = acc.get(id);
    if (cur) {
      cur.row.events += r.events;
      cur.absSum += absSum;
      cur.signedSum += signedSum;
      // mode already set from the first row - platforms share a mode
    } else {
      acc.set(id, {
        row: {
          stop_id: id,
          name: stationName(r.name),
          events: r.events,
          avg_delay_sec: r.avg_delay_sec,
          avg_abs_delay_sec: r.avg_abs_delay_sec,
          mode: r.mode,
        },
        absSum,
        signedSum,
      });
    }
  }
  return [...acc.values()]
    .map(({ row, absSum, signedSum }) => ({
      ...row,
      avg_abs_delay_sec: Math.round((absSum / row.events) * 10) / 10,
      avg_delay_sec: Math.round((signedSum / row.events) * 10) / 10,
    }))
    .sort((a, b) => b.avg_abs_delay_sec - a.avg_abs_delay_sec);
}

/**
 * All routes as a `routeId > mode` map. Cached with a long TTL since routes
 * only change when GTFS is re-ingested. Used to resolve dominant mode per stop.
 * @returns Map from route id to its mode.
 */
async function getRouteModeMap(): Promise<Map<string, "BUS" | "TRAIN" | "FERRY">> {
  const pairs = await unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({ select: { id: true, mode: true } });
      return rows.map((r) => [r.id, r.mode] as const);
    },
    ["route-mode-map"],
    { revalidate: 3600 },
  )();
  return new Map(pairs as [string, "BUS" | "TRAIN" | "FERRY"][]);
}

/**
 * Pick the most common mode among `routeIds`. Ties resolve BUS > TRAIN > FERRY.
 * @param routeIds - Route ids that served a stop in the window.
 * @param modeMap - The full route-mode map from {@link getRouteModeMap}.
 * @returns The dominant mode, or `"BUS"` when no routes are recognised.
 */
function dominantMode(
  routeIds: string[],
  modeMap: Map<string, "BUS" | "TRAIN" | "FERRY">,
): "BUS" | "TRAIN" | "FERRY" {
  const counts = { BUS: 0, TRAIN: 0, FERRY: 0 };
  for (const id of routeIds) {
    const m = modeMap.get(id);
    if (m) counts[m]++;
  }
  if (counts.BUS >= counts.TRAIN && counts.BUS >= counts.FERRY) return "BUS";
  if (counts.TRAIN >= counts.FERRY) return "TRAIN";
  return "FERRY";
}

/**
 * Resolve the route ids whose events the worst-stop ranking should include,
 * mirroring the home/rankings mode + school filters. Returns null when no filter
 * applies (every mode, school included), so the caller can skip the `$in` match.
 * @param mode - Restrict to this mode, or null for every mode.
 * @param includeSchool - Whether to include `S###` school services.
 * @returns Included route ids, or null when no route filter is needed.
 */
async function worstStopRouteIds(
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
): Promise<string[] | null> {
  if (!mode && includeSchool) return null;
  return unstable_cache(
    async () => {
      // Push mode filter to DB; school-bus detection needs name fields so stays in JS.
      const routes = await prisma.route.findMany({
        where: mode ? { mode } : undefined,
        select: { id: true, shortName: true, longName: true },
      });
      return routes
        .filter((r) => includeSchool || !isSchoolBus(r.shortName, r.longName))
        .map((r) => r.id);
    },
    ["worst-stop-route-ids", mode ?? "all", String(includeSchool)],
    { revalidate: 3600 },
  )();
}

/**
 * Rank stops by how far off schedule their buses ran across every route - the
 * average absolute deviation per stop, which counts both late and early. Drops
 * stops below {@link MIN_STOP_EVENTS} so a thin sample can't top the board, and
 * collapses train platforms to one station (see {@link collapseWorstStops}). The
 * mode/school filters mirror the home page so the worst stop stays in step with
 * what's shown. Cached briefly.
 * @param range - The window to rank over.
 * @param filter - Mode/school filters mirroring the home page.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param limit - How many ranked stops to return.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The worst stops, off-schedule magnitude descending.
 */
export async function getWorstStops(
  range: DateRange,
  filter: ShameFilter,
  limit: number,
  revalidate: number,
): Promise<WorstStop[]> {
  const { mode = null, includeSchool = false } = filter;
  // Align midnight-aligned week/month windows to service-day edges so the
  // worst-stops card counts the same events as the per-day shame boards. A
  // service-day-aligned range maps to itself, so day callers are unaffected.
  const days = serviceDatesInRange(range);
  const aligned =
    days.length > 0
      ? {
          start: nzServiceDayRange(days[0]).start,
          end: nzServiceDayRange(days[days.length - 1]).end,
        }
      : range;
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(aligned),
        ...realDeviationMatchFor(classified),
      };
      if (routeIds) match.routeId = { $in: routeIds };

      // Fetch a generous candidate set so the post-aggregation platform collapse
      // can merge stations and still leave `limit` rows after re-ranking.
      const candidates = Math.max(80, limit * 8);
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: "$stopId",
                events: { $sum: 1 },
                avg_delay_sec: { $avg: "$deviationSec" },
                avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                routeIds: { $addToSet: "$routeId" },
              },
            },
            { $match: { events: { $gte: MIN_STOP_EVENTS } } },
            { $lookup: { from: "Stop", localField: "_id", foreignField: "_id", as: "stop" } },
            { $unwind: "$stop" },
            { $sort: { avg_abs_delay_sec: -1 as const } },
            { $limit: candidates },
            {
              $project: {
                _id: 0,
                stop_id: { $toString: "$_id" },
                name: "$stop.name",
                events: 1,
                avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                routeIds: 1,
                ...stationProjection,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: Omit<WorstStopRaw, "mode">[] } };

      // Resolve dominant mode per stop from its route ids. When a mode filter is
      // active every stop already belongs to that mode; otherwise fetch the map.
      const modeMap = mode ? null : await getRouteModeMap();
      const enriched: WorstStopRaw[] = res.cursor.firstBatch.map((r) => ({
        ...r,
        mode: mode ?? dominantMode(r.routeIds, modeMap!),
      }));
      return collapseWorstStops(enriched).slice(0, limit);
    },
    [
      "worst-stops",
      aligned.start.toISOString(),
      aligned.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
      String(limit),
    ],
    aligned,
    revalidate,
  );
}

/**
 * The day's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each hour for a service window. Only stops with at least
 * {@link MIN_STOP_EVENTS_HOUR} events in that hour qualify. Cached briefly.
 * @param range - The service-day window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The hour's worst stop and the per-hour worst list, earliest hour first.
 */
export async function getWorstStopsOfDay(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfDay> {
  const { mode = null, includeSchool = false } = filter;
  return cachedForRange(
    async (classified) => {
      const routeIds = await worstStopRouteIds(mode, includeSchool);
      const match: Record<string, unknown> = {
        scheduledAt: scheduledAtWindow(range),
        ...realDeviationMatchFor(classified),
      };
      if (routeIds) match.routeId = { $in: routeIds };

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            {
              $group: {
                _id: {
                  hour: { $hour: { date: "$scheduledAt", timezone: NZ_TZ } },
                  stop_id: "$stopId",
                },
                events: { $sum: 1 },
                avg_delay_sec: { $avg: "$deviationSec" },
                avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                routeIds: { $addToSet: "$routeId" },
              },
            },
            { $match: { events: { $gte: MIN_STOP_EVENTS_HOUR } } },
            {
              $lookup: {
                from: "Stop",
                localField: "_id.stop_id",
                foreignField: "_id",
                as: "stop",
              },
            },
            { $unwind: "$stop" },
            { $sort: { avg_abs_delay_sec: -1 } },
            {
              $group: {
                _id: "$_id.hour",
                stop_id: { $first: { $toString: "$_id.stop_id" } },
                name: { $first: "$stop.name" },
                events: { $first: "$events" },
                avg_delay_sec: { $first: { $round: ["$avg_delay_sec", 1] } },
                avg_abs_delay_sec: { $first: { $round: ["$avg_abs_delay_sec", 1] } },
                routeIds: { $first: "$routeIds" },
              },
            },
            {
              $project: {
                _id: 0,
                hour: "$_id",
                stop_id: 1,
                name: 1,
                events: 1,
                avg_delay_sec: 1,
                avg_abs_delay_sec: 1,
                routeIds: 1,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: (ShameStop & { routeIds: string[] })[] } };

      const modeMap = mode ? null : await getRouteModeMap();
      const hours: ShameStop[] = res.cursor.firstBatch.map((r) => ({
        hour: r.hour,
        stop_id: r.stop_id,
        name: r.name,
        events: r.events,
        avg_delay_sec: r.avg_delay_sec,
        avg_abs_delay_sec: r.avg_abs_delay_sec,
        mode: mode ?? dominantMode(r.routeIds, modeMap!),
      }));
      hours.sort(
        (a, b) =>
          ((a.hour + 24 - SERVICE_START_HOUR) % 24) - ((b.hour + 24 - SERVICE_START_HOUR) % 24),
      );
      const worst = hours.reduce<ShameStop | null>(
        (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
        null,
      );
      return { worst, hours };
    },
    [
      "worst-stops-of-day",
      range.start.toISOString(),
      range.end.toISOString(),
      mode ?? "all",
      includeSchool ? "school" : "no-school",
    ],
    range,
    revalidate,
  );
}

/** Raw per-(serviceDay,stop) row from the Stop Shame week aggregation. */
interface ShameDayStopRaw {
  _id: string; // service date, YYYY-MM-DD
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  routeIds: string[];
}

/**
 * The week's "Stop Shame": the single most off-schedule stop plus the worst stop
 * of each service day over a multi-day window. Only stops with at least
 * {@link MIN_STOP_EVENTS_HOUR} events on that day qualify. Cached at the supplied
 * revalidate rate.
 * @param range - The week (or multi-day) window.
 * @param filter - Mode/school filters.
 * @param filter.mode - Restrict to this mode; null/undefined means every mode.
 * @param filter.includeSchool - Include school services (default false).
 * @param revalidate - Cache lifetime in seconds.
 * @returns The period's worst stop and the per-day worst list, earliest day first.
 */
export async function getWorstStopsOfWeek(
  range: DateRange,
  filter: ShameFilter,
  revalidate: number,
): Promise<ShameStopOfWeek> {
  const { mode = null, includeSchool = false } = filter;
  // Resolve each service day independently (cached per day) and combine, so a
  // busy live day never forces one heavy 7-day aggregation. Past days stay
  // cached; only the current day recomputes.
  const days = (
    await Promise.all(
      serviceDatesInRange(range).map((date) =>
        cachedWorstStopsOfDay(date, mode, includeSchool, revalidate),
      ),
    )
  ).flat();
  days.sort((a, b) => a.date.localeCompare(b.date));
  const worst = days.reduce<ShameDayStop | null>(
    (w, d) => (w == null || d.avg_abs_delay_sec > w.avg_abs_delay_sec ? d : w),
    null,
  );
  return { worst, days };
}

/**
 * The worst stop of each service day within a range (one row per day with data).
 * Used per-day by {@link getWorstStopsOfWeek}; left uncached so the caller owns
 * the per-day cache key.
 * @param range - The window to aggregate (typically a single service day).
 * @param mode - Route mode filter (null = all).
 * @param includeSchool - Whether to include school services.
 * @param classified - Whether the day has been through the ghost pass.
 * @returns The per-service-day worst stops.
 */
async function worstStopsForRange(
  range: DateRange,
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
  classified: boolean,
): Promise<ShameDayStop[]> {
  const routeIds = await worstStopRouteIds(mode, includeSchool);
  const match: Record<string, unknown> = {
    scheduledAt: scheduledAtWindow(range),
    ...realDeviationMatchFor(classified),
  };
  if (routeIds) match.routeId = { $in: routeIds };

  const res = (await runCommand(() =>
    prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        { $match: match },
        {
          $group: {
            _id: {
              serviceDay: serviceDateExpr("$scheduledAt"),
              stop_id: "$stopId",
            },
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            routeIds: { $addToSet: "$routeId" },
          },
        },
        { $match: { events: { $gte: MIN_STOP_EVENTS_HOUR } } },
        // Worst stop per service day via a bounded per-group $top accumulator
        // (one entry per day) rather than a global blocking $sort, which exceeds
        // the cluster's 32MB in-memory sort limit (the tier forbids disk spill).
        {
          $group: {
            _id: "$_id.serviceDay",
            worst: {
              $top: {
                sortBy: { avg_abs_delay_sec: -1 },
                output: {
                  stop_id: "$_id.stop_id",
                  events: "$events",
                  avg_delay_sec: "$avg_delay_sec",
                  avg_abs_delay_sec: "$avg_abs_delay_sec",
                  routeIds: "$routeIds",
                },
              },
            },
          },
        },
        // Resolve the stop name for just the per-day winners.
        { $lookup: { from: "Stop", localField: "worst.stop_id", foreignField: "_id", as: "stop" } },
        { $unwind: "$stop" },
        {
          $project: {
            _id: 1,
            stop_id: { $toString: "$worst.stop_id" },
            name: "$stop.name",
            events: "$worst.events",
            avg_delay_sec: { $round: ["$worst.avg_delay_sec", 1] },
            avg_abs_delay_sec: { $round: ["$worst.avg_abs_delay_sec", 1] },
            routeIds: "$worst.routeIds",
          },
        },
      ] as never,
      cursor: { batchSize: 100_000 },
    }),
  )) as unknown as {
    cursor: {
      firstBatch: (Omit<ShameDayStopRaw, "_id"> & { _id: string } & { routeIds: string[] })[];
    };
  };

  const modeMap = mode ? null : await getRouteModeMap();
  return res.cursor.firstBatch.map((r) => ({
    date: r._id,
    stop_id: r.stop_id,
    name: r.name,
    events: r.events,
    avg_delay_sec: r.avg_delay_sec,
    avg_abs_delay_sec: r.avg_abs_delay_sec,
    mode: mode ?? dominantMode(r.routeIds, modeMap!),
  }));
}

/**
 * The parent-keyed station id replacing a legacy name-keyed one, so links minted
 * before stations moved off stop names keep resolving. Returns null when the id
 * is not a legacy one, names no known station, or has no parent in the feed - in
 * all three cases the id the caller holds is already the current one.
 * @param id - A canonical stop id from a link.
 * @returns The current station id to redirect to, or null to stay put.
 */
export async function findCurrentStationId(id: string): Promise<string | null> {
  if (!isLegacyStationId(id)) return null;
  return unstable_cache(
    async () => {
      const platforms = await prisma.stop.findMany({
        where: { name: { contains: "Train Station" } },
        select: { id: true, name: true, parentStation: true, platformCode: true },
      });
      const member = platforms.find(
        (s) => isPlatformStop(s.name, s) && legacyStationId(s.name) === id,
      );
      if (!member) return null;
      const current = stationId(member.id, member.name, member);
      return current === id ? null : current;
    },
    ["current-station-id", id],
    { revalidate: 86_400 },
  )();
}

/** A canonical stop resolved to its underlying platform ids + display position. */
interface StopGroup {
  /** Canonical id (a `station:` id for collapsed train platforms, else the stop id). */
  id: string;
  /** Underlying GTFS stop ids to match in the events (platforms of a station). */
  ids: string[];
  name: string;
  lat: number;
  lon: number;
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
        const members = isLegacyStationId(id)
          ? (
              await prisma.stop.findMany({
                where: { name: { contains: "Train Station" } },
                select: { id: true, name: true, lat: true, lon: true, platformCode: true },
              })
            ).filter((s) => legacyStationId(s.name) === id)
          : await prisma.stop.findMany({
              where: { parentStation: id.slice(STATION_PREFIX.length) },
              select: { id: true, name: true, lat: true, lon: true, platformCode: true },
            });
        const first = members[0];
        if (first === undefined) return null;
        return {
          id,
          ids: members.map((s) => s.id),
          name: stationName(first.name),
          lat: first.lat,
          lon: first.lon,
        };
      }
      const stop = await prisma.stop.findUnique({
        where: { id },
        select: { id: true, name: true, lat: true, lon: true },
      });
      if (!stop) return null;
      return { id: stop.id, ids: [stop.id], name: stop.name, lat: stop.lat, lon: stop.lon };
    },
    ["resolve-stop-group", id],
    { revalidate: 86400 },
  )();
}

/** One facet's results from the stop-stats aggregation. */
interface StopStatsFacet {
  summary: RouteSummary[];
  routes: TopRouteRow[];
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
 * @param thresholdSec - On-time late bound, for cache-key versioning only.
 * @param revalidate - Cache lifetime in seconds.
 * @returns The stop's stats, or null when the stop id is unknown.
 */
export async function getStopStats(
  id: string,
  range: DateRange,
  thresholdSec: number,
  revalidate: number,
): Promise<StopStats | null> {
  return cachedForRange(
    async (classified) => {
      const group = await resolveStopGroup(id);
      if (!group) return null;

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            {
              $match: {
                stopId: { $in: group.ids },
                scheduledAt: scheduledAtWindow(range),
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
                      short_name: { $first: "$route.shortName" },
                      long_name: { $first: "$route.longName" },
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
                      route_id: { $toString: "$_id" },
                      short_name: 1,
                      long_name: 1,
                      mode: 1,
                      events: 1,
                      avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                      avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                      on_time_pct: { $round: ["$on_time_pct", 1] },
                    },
                  },
                ],
                routeCount: [{ $group: { _id: "$routeId" } }, { $count: "n" }],
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: StopStatsFacet[] } };

      const facet = res.cursor.firstBatch[0];
      return {
        stop: { stop_id: group.id, name: group.name, lat: group.lat, lon: group.lon },
        platform_ids: group.ids,
        summary: facet?.summary[0] ?? null,
        routes: facet?.routes ?? [],
        routes_count: facet?.routeCount[0]?.n ?? 0,
      };
    },
    ["stop-stats", id, range.start.toISOString(), range.end.toISOString(), String(thresholdSec)],
    range,
    revalidate,
  );
}

/** Raw trip-timeline stop row before the `scheduled_at` date is normalised. */
interface TripStopRaw extends Omit<TripStop, "scheduled_at">, StationRow {
  scheduled_at: { $date: string } | string;
  vehicle_id: string | null;
}

/**
 * The Auckland-local service-day window of a trip's most recent run, so an
 * undated timeline request still resolves to a single run (a run that crosses
 * midnight stays in one service day).
 * @param tripId - The trip to scope.
 * @returns The latest run's service-day window, or null when the trip has no events.
 */
async function latestTripDay(tripId: string): Promise<DateRange | null> {
  // Cache the raw ISO string; reconstruct DateRange outside to avoid Date serialisation issues.
  const iso = await unstable_cache(
    async () => {
      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: { tripId } },
            { $group: { _id: null, max: { $max: "$scheduledAt" } } },
          ] as never,
          cursor: { batchSize: 1 },
        }),
      )) as unknown as { cursor: { firstBatch: { max?: { $date: string } | string }[] } };
      const raw = res.cursor.firstBatch[0]?.max;
      return raw ? toIso(raw) : null;
    },
    ["latest-trip-day", tripId],
    { revalidate: 21600 },
  )();
  return iso ? nzServiceDayRange(new Date(iso)) : null;
}

/**
 * A single trip run's stop-by-stop scheduled-vs-actual timeline, in stop order.
 * A GTFS `tripId` repeats every service day, so the events are scoped to one
 * day - the supplied `range` (the run the user clicked) or the trip's latest day
 * - otherwise different days' runs interleave and stops appear out of order or
 * duplicated. Consecutive events for the same stop (a stop with two recorded
 * actuals) are collapsed. Cached briefly.
 * @param tripId - The trip (run) to resolve.
 * @param routeId - The owning route (for the header).
 * @param range - The run's Auckland-local day window; defaults to its latest day.
 * @returns The route header, vehicle, and ordered stops.
 */
export async function getTripTimeline(
  tripId: string,
  routeId: string,
  range?: DateRange,
): Promise<TripTimeline> {
  const day = range ?? (await latestTripDay(tripId));
  return cachedForRange(
    async (classified) => {
      const routeIds = await routeIdsForSlug(routeId);
      const route = await prisma.route.findUnique({
        where: { id: routeIds[0] },
        select: { shortName: true, longName: true, mode: true, colour: true },
      });

      const match: Record<string, unknown> = { tripId, ...realDeviationMatchFor(classified) };
      if (day) {
        match.scheduledAt = {
          $gte: { $date: day.start.toISOString() },
          $lt: { $date: day.end.toISOString() },
        };
      }

      const res = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "ArrivalEvent",
          pipeline: [
            { $match: match },
            { $sort: { scheduledAt: 1 as const } },
            { $lookup: { from: "Stop", localField: "stopId", foreignField: "_id", as: "stop" } },
            { $unwind: "$stop" },
            {
              $project: {
                _id: 0,
                stop_id: { $toString: "$stopId" },
                name: "$stop.name",
                lat: "$stop.lat",
                lon: "$stop.lon",
                scheduled_at: "$scheduledAt",
                deviation_sec: "$deviationSec",
                vehicle_id: "$vehicleId",
                ...stationProjection,
              },
            },
          ] as never,
          cursor: { batchSize: 100_000 },
        }),
      )) as unknown as { cursor: { firstBatch: TripStopRaw[] } };

      // AT re-reports a trip_id against a later vehicle cycle, so a stop can carry
      // both its real arrival and a "ghost" reading ~1h off - and the ghosts can
      // even outnumber the real events. Collapse each station (and its platforms)
      // to the event nearest its own schedule (the real run), then drop anything
      // sitting a vehicle cycle off the run's own level rather than showing it
      // wildly late. Same rule the nightly pass applies (see lib/deviation.ts),
      // reapplied here because a timeline can be read before that pass has run.
      const bestByStop = new Map<string, TripStopRaw>();
      for (const r of res.cursor.firstBatch) {
        const id = stationId(r.stop_id, r.name, stationPartsOf(r));
        const cur = bestByStop.get(id);
        if (!cur || Math.abs(r.deviation_sec) < Math.abs(cur.deviation_sec)) bestByStop.set(id, r);
      }
      const chosen = [...bestByStop.values()].sort(
        (a, b) => +new Date(toIso(a.scheduled_at)) - +new Date(toIso(b.scheduled_at)),
      );
      const runMedian = medianDeviation(chosen.map((r) => r.deviation_sec)) ?? 0;

      const stops: TripStop[] = [];
      for (const r of chosen) {
        if (isGhostDeviation(r.deviation_sec, runMedian)) continue;
        stops.push({
          stop_id: stationId(r.stop_id, r.name, stationPartsOf(r)),
          name: stationName(r.name),
          lat: r.lat,
          lon: r.lon,
          scheduled_at: toIso(r.scheduled_at),
          deviation_sec: r.deviation_sec,
        });
      }
      return {
        trip_id: tripId,
        route: route
          ? {
              shortName: route.shortName,
              longName: route.longName,
              mode: route.mode,
              colour: route.colour,
            }
          : null,
        vehicle_id: res.cursor.firstBatch.find((r) => r.vehicle_id)?.vehicle_id ?? null,
        stops,
      };
    },
    ["trip-timeline", tripId, routeId, day?.start.toISOString() ?? "all"],
    // The "all" variant follows the trip's latest day and stays short-lived.
    day ?? null,
    300,
  );
}

/** One stop in a trip's GTFS scheduled stop sequence. */
export interface ScheduledStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  stop_sequence: number;
  /** GTFS departure time "HH:MM:SS"; hours may exceed 23 for post-midnight trips. */
  departure_time: string | null;
}

/**
 * Scheduled stop sequence for a trip from the AT GTFS static feed, joined with
 * stop names and coordinates from the database. Cached for a day - the schedule
 * does not change during a trip's service day. An AT failure throws out of the
 * cache rather than storing an empty schedule for the day; the trip page treats
 * it as no schedule for that request only.
 * @param tripId - AT GTFS trip id.
 * @returns Stops ordered by stop_sequence with display names and coordinates.
 */
export async function getTripScheduledStops(tripId: string): Promise<ScheduledStop[]> {
  interface RawStopTime {
    stop_id: string;
    stop_sequence: number;
    departure_time?: string | null;
  }
  return unstable_cache(
    async () => {
      const stoptimes = await fetchAll<RawStopTime>(
        `/trips/${encodeURIComponent(tripId)}/stoptimes`,
      );
      if (stoptimes.length === 0) return [];
      const ordered = stoptimes.slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
      const stopIds = ordered.map((s) => s.stop_id);
      const stopDocs = await prisma.stop.findMany({
        where: { id: { in: stopIds } },
        select: {
          id: true,
          name: true,
          lat: true,
          lon: true,
          parentStation: true,
          platformCode: true,
        },
      });
      const stopById = new Map(stopDocs.map((s) => [s.id, s]));
      const out: ScheduledStop[] = [];
      for (const st of ordered) {
        const stop = stopById.get(st.stop_id);
        if (!stop) continue;
        out.push({
          stop_id: stationId(stop.id, stop.name, stop),
          name: stationName(stop.name),
          lat: stop.lat,
          lon: stop.lon,
          stop_sequence: st.stop_sequence,
          departure_time: st.departure_time ?? null,
        });
      }
      return out;
    },
    ["trip-scheduled-stops", tripId],
    { revalidate: 86_400 },
  )();
}

/**
 * Look up short names for a set of route ids. Returns a map of id to shortName,
 * falling back to the raw id when the route has no shortName set.
 * @param routeIds - Route ids to look up.
 * @returns Record mapping each id to its display name.
 */
export async function getRouteNames(routeIds: string[]): Promise<Record<string, string>> {
  if (routeIds.length === 0) return {};
  return unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({
        where: { id: { in: routeIds } },
        select: { id: true, shortName: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.shortName ?? r.id]));
    },
    ["route-names", ...[...routeIds].sort()],
    { revalidate: 86400 },
  )();
}

/**
 * Event-weighted mean of one per-day field across the rows for a date. Rows
 * without a value contribute nothing; null when none has one.
 * @param group - The rows sharing a date.
 * @param pick - Reads the field from a row.
 * @returns The weighted mean rounded to one decimal, or null.
 */
function weightedDayField(
  group: readonly RouteDay[],
  pick: (row: RouteDay) => number | null,
): number | null {
  const valued = group.filter((r) => pick(r) !== null && r.events > 0);
  const weight = valued.reduce((n, r) => n + r.events, 0);
  if (weight === 0) return null;
  const sum = valued.reduce((n, r) => n + (pick(r) ?? 0) * r.events, 0);
  return Math.round((sum / weight) * 10) / 10;
}

/**
 * Merge per-day rows that share a service date (two feed versions of a route,
 * or a line and its predecessor, each summarised for the same day) into one
 * event-weighted row.
 * @param rows - Per-day rows, any order.
 * @returns One row per date, newest first.
 */
function mergeRouteDays(rows: readonly RouteDay[]): RouteDay[] {
  const byDate = new Map<string, RouteDay[]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  return [...byDate.entries()]
    .map(([date, group]) => ({
      date,
      events: group.reduce((n, r) => n + r.events, 0),
      avg_delay_sec: weightedDayField(group, (r) => r.avg_delay_sec),
      avg_abs_delay_sec: weightedDayField(group, (r) => r.avg_abs_delay_sec),
      on_time_pct: weightedDayField(group, (r) => r.on_time_pct),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Per-day stats for a route over a window, newest first: `DailyRouteSummary`
 * rows for the days the nightly aggregate has covered, plus one live
 * `ArrivalEvent` aggregation grouped by service date for the days it has not
 * (today, and any earlier day whose aggregate has not run). The live rows use
 * the same real-reading filter and per-mode on-time window as the route's day
 * view, so a day reads the same in both places. Supply `from`/`to` for a
 * specific window; omit both for the last seven service days. Days with no
 * arrivals are omitted.
 * @param routeId - AT route id (slug form).
 * @param from - Inclusive window start (UTC). Omit for the rolling week.
 * @param to - Exclusive window end (UTC). Omit for the rolling week.
 * @returns Per-day stats, newest first.
 */
export async function getRouteDailyStats(
  routeId: string,
  from?: Date,
  to?: Date,
): Promise<RouteDay[]> {
  const range: DateRange = from && to ? { start: from, end: to } : nzLast7DaysRange();
  return cachedForRange(
    async () => {
      // DailyRouteSummary stores versioned route IDs (e.g. "209-217"), not slugs.
      const routeIds = await routeIdsForSlug(routeId);
      const today = nzServiceDayString();
      const summaries = await prisma.dailyRouteSummary.findMany({
        where: { routeId: { in: routeIds }, date: { gte: range.start, lt: range.end } },
        select: {
          date: true,
          events: true,
          avgDelaySec: true,
          avgAbsDelaySec: true,
          onTimePct: true,
        },
      });
      const days: RouteDay[] = summaries
        .map((r) => ({
          date: nzServiceDayString(r.date),
          events: r.events,
          avg_delay_sec: r.avgDelaySec ?? null,
          avg_abs_delay_sec: r.avgAbsDelaySec ?? null,
          on_time_pct: r.onTimePct ?? null,
        }))
        // A summary for the live day would be a mid-day snapshot; read it live.
        .filter((r) => r.date < today);

      const summarised = new Set(days.map((r) => r.date));
      const now = new Date();
      const liveDates = serviceDatesInRange(range).filter(
        (date) => !summarised.has(date) && nzServiceDayRange(date).start <= now,
      );
      const [firstLive] = liveDates;
      const lastLive = liveDates.at(-1);
      if (firstLive !== undefined && lastLive !== undefined) {
        const live: DateRange = {
          start: nzServiceDayRange(firstLive).start,
          end: nzServiceDayRange(lastLive).end,
        };
        const route = await prisma.route.findUnique({
          where: { id: routeIds[0] ?? routeId },
          select: { mode: true },
        });
        const mode = route?.mode ?? "BUS";
        const res = (await runCommand(() =>
          prisma.$runCommandRaw({
            aggregate: "ArrivalEvent",
            pipeline: [
              {
                $match: {
                  routeId: { $in: routeIds },
                  scheduledAt: scheduledAtWindow(live),
                  // Only unsummarised days are scanned here, so the guard stays on.
                  ...realDeviationMatchFor(false),
                },
              },
              {
                $group: {
                  _id: serviceDateExpr("$scheduledAt"),
                  events: { $sum: 1 },
                  avg_delay_sec: { $avg: "$deviationSec" },
                  avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
                  on_time_count: onTimeSingleModeSum(mode),
                },
              },
              {
                $project: {
                  _id: 1,
                  events: 1,
                  avg_delay_sec: { $round: ["$avg_delay_sec", 1] },
                  avg_abs_delay_sec: { $round: ["$avg_abs_delay_sec", 1] },
                  on_time_pct: {
                    $round: [{ $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100] }, 1],
                  },
                },
              },
            ] as never,
            cursor: { batchSize: 100_000 },
          }),
        )) as unknown as {
          cursor: { firstBatch: (Omit<RouteDay, "date"> & { _id: string })[] };
        };
        // The live window may span a summarised day in between; keep only the
        // dates that have no summary.
        const wanted = new Set(liveDates);
        for (const row of res.cursor.firstBatch) {
          if (wanted.has(row._id)) days.push({ ...row, date: row._id });
        }
      }
      return mergeRouteDays(days);
    },
    ["route-daily-stats", routeId, from?.toISOString() ?? "", to?.toISOString() ?? ""],
    range,
    300,
  );
}
