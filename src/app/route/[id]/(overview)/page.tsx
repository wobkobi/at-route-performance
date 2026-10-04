// src/app/route/[id]/(overview)/page.tsx
// Route detail page with a day view (worst trips and route map) and
// a week view of aggregated stats, toggled in the header. Version-stripped and
// case-canonical slugs are enforced up front via redirects; the day view opens
// on the same day as every other day page (see resolveShownDay).
// The live AT calls (service alerts, live vehicles) start without awaiting so
// they overlap the day's queries. The diagram's alerted-stop rings and the
// board's LIVE badges still stream in through Suspense; the alert banner is
// awaited, because it sits above the page body and streaming it in shoved
// everything below it down as the reader arrived.
// The week view skips the expensive trips query and the live vehicle fetch.
import { AlertBanner } from "@/components/AlertBanner";
import { RangeControls } from "@/components/date/RangeControls";
import { DirectionFilter } from "@/components/filter/DirectionFilter";
import { HourRangeFilter } from "@/components/filter/HourRangeFilter";
import { ChevronDown } from "@/components/icons";
import { LoadingBlock } from "@/components/Loading";
import { RouteMapDiagram } from "@/components/map/RouteMapDiagram";
import { ModeIcon } from "@/components/ModeIcon";
import { PunctualityStat, StatCell, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RouteStrip } from "@/components/route/RouteStrip";
import { RouteWeekSummary } from "@/components/route/RouteWeekSummary";
import { SortHeader } from "@/components/SortHeader";
import { WorstTripsBoard } from "@/components/trip/WorstTripsBoard";
import { CELL_CLASS, DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { OffScheduleValue } from "@/components/ui/OffScheduleValue";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/cn";
import { MEASURED_AGAINST } from "@/lib/copy";
import {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getBusiestRouteSlugs,
  getCancelledTrips,
  getDetouredTripIds,
  getEarliestDataDay,
  getOperatorDirectory,
  getRouteClosures,
  getRouteDailyStats,
  getRouteLabel,
  getRouteNames,
  getRouteStats,
  getRouteStopSplit,
  getRouteTripStats,
  getTripRiderWait,
  parseTripSort,
} from "@/lib/data";
import { readFallback } from "@/lib/db";
import {
  alertsForRoute,
  getServiceAlerts,
  getUpcomingAlerts,
  type ServiceAlert,
} from "@/lib/feed/at-alerts";
import { getLiveVehicles, type LiveVehicle } from "@/lib/feed/vehicles";
import {
  formatCount,
  formatDuration,
  formatPct,
  plural,
  sentenceStart,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { cardPath, cardWhenSuffix, pageMetadata, parseRouteCard } from "@/lib/og";
import { operatorHref, operatorOf } from "@/lib/operators";
import { redirectKeepingQuery, routeHref, stopHref, type LinkQuery } from "@/lib/page/hrefs";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import { dayRangeNav, periodRangeNav, type RangeWindow } from "@/lib/page/range";
import { resolveRange } from "@/lib/page/rankings";
import { sortRows, tableSort, type SortColumn, type SortParamNames } from "@/lib/page/table-sort";
import { withTripPenalty } from "@/lib/rider-wait";
import { routeDisplayName, routeSlug, routeSubtitle } from "@/lib/route/slug";
import { buildRouteView, type RouteView } from "@/lib/route/view";
import { aggregateWeek } from "@/lib/route/week";
import { isSchoolBus } from "@/lib/school-bus";
import { getFleet, type FleetVehicle } from "@/lib/store/fleet";
import { stripMarks } from "@/lib/strip/marks";
import { buildStrip, type StripSide } from "@/lib/strip/route-strip";
import { splitStopFigures } from "@/lib/strip/stop-split";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestNow } from "@/lib/time/request-now";
import { nzLocalHour, nzServiceDayString, type DateRange } from "@/lib/time/service-day";
import { hourRangeParam, isHourInRange, parseHourRange } from "@/lib/time/time-of-day";
import {
  buildTripBoardRows,
  LIVE_ONLY_PARAM,
  parseTripPage,
  sortRuns,
  TRIP_PAGE_SIZE,
  type TripBoardRow,
} from "@/lib/trip/board";
import { boundFor } from "@/lib/trip/departure-label";
import { buildHref } from "@/lib/utils";
import type { RouteByStop, RouteVariant } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ComponentProps, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

/**
 * How many route pages are prerendered at build.
 *
 * Every route not listed still works; its prefetch is answered by a fresh
 * render instead of the CDN, which is what every route did before this existed.
 * So the number is a spend, not a limit: each one is build time and stored
 * output, and the return falls away past the routes boards actually link to.
 */
const PRERENDERED_ROUTES = 50;

/**
 * Routes prerendered when the database cannot be read at build.
 *
 * A build has to produce at least one param or Next fails the route with
 * `empty-generate-static-params`, and CI builds with no `DATABASE_URL` at all -
 * the property that lets a deploy proceed while the NAS is unreachable. These
 * are the busiest slugs at the time of writing, all of them long-lived lines
 * (the Link services, the Northern Express, the top frequent routes), so a
 * stale list still names routes that exist.
 */
const FALLBACK_ROUTES = [
  "70",
  "INN",
  "OUT",
  "E-W",
  "33",
  "75",
  "18",
  "S-C",
  "65",
  "NX1",
  "NX2",
  "CTY",
];

/**
 * The route pages to prerender, busiest first.
 *
 * Prefetches were 93% of production traffic and `/route/[id]` was the single
 * biggest path in it. A prefetch of a route that was not prerendered has to be
 * rendered on demand, because the answer belongs to one id and nothing generic
 * is on hand to serve; a prerendered one is a CDN hit that never reaches the
 * database. The shells are identical and hold no route data - the prerender
 * stops at this segment's loading skeleton - so what listing an id buys is a
 * cache entry under its path, not any of its figures.
 * @returns Params for the busiest routes, or the fallback list if unreadable.
 */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  const slugs = await getBusiestRouteSlugs(PRERENDERED_ROUTES).catch(
    readFallback("busiest-route-slugs", [] as string[]),
  );
  return (slugs.length > 0 ? slugs : FALLBACK_ROUTES).map((id) => ({ id }));
}

/** Upper bound on the day's runs fetched for the paginated board. */
const TRIPS_FETCH_CAP = 500;

/** Query params for route detail (raw strings). */
interface StatsSearchParams {
  day?: string;
  tsort?: string;
  /** The trip board's 1-based page. */
  tpage?: string;
  /** "1" lists only the trips running now, on a view that covers now. */
  tlive?: string;
  /** Reverse the active sort direction when "1". */
  trev?: string;
  /** Travel direction id to narrow the page to; unset for both. */
  heading?: string;
  window?: string;
  /** Week start (`YYYY-MM-DD` Monday) when stepping back through the week view. */
  period?: string;
  /** Part of the service day to narrow to, e.g. `7-9`; absent covers all of it. */
  hours?: string;
  /** The Stops table's sorted column, and "1" to sort it the other way. */
  ssort?: string;
  srev?: string;
}

/** The Stops table's sortable columns; absent is the busiest stop first. */
const STOP_COLUMNS: SortColumn<RouteByStop>[] = [
  { key: "stop", value: "name", first: "asc" },
  { key: "arrivals", value: "events" },
  { key: "delay", value: "avg_delay_sec" },
];

/** The Stops table's own names: `tsort` and `trev` belong to the trips board. */
const STOP_SORT: SortParamNames = { sort: "ssort", rev: "srev" };

/** The route page's windows: it has no month view. */
const ROUTE_WINDOWS: readonly RangeWindow[] = ["day", "week"];

/**
 * A direction chip's label, from the busiest variant's headsign read the way
 * every trip row reads one ({@link boundFor}): origin dropped, shouting undone,
 * "To Lincoln Rd via Henderson".
 * @param variants - The direction's variants.
 * @param dirId - The direction id (for the fallback label).
 * @param mode - The route's mode; a train's platform numbers are dropped.
 * @returns The label, or `Direction N` when no headsign names a place.
 */
function directionLabel(variants: RouteVariant[], dirId: number, mode: string): string {
  const busiest = variants.reduce<RouteVariant | undefined>(
    (a, b) => (a === undefined || b.tripCount > a.tripCount ? b : a),
    undefined,
  );
  const bound = boundFor(busiest?.headsign, mode);
  return bound ? sentenceStart(bound) : `Direction ${dirId + 1}`;
}

/**
 * Per-route page title, so a tab and a shared link name the line rather than
 * repeating the site title. Uses the published line name where there is one
 * (AT's `route_long_name` for a train is just the bare code).
 * The shared link's card and title name the day or week the link carries.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic route params `{ id }`.
 * @param root0.searchParams - Optional query params (the day or week).
 * @returns Title, description and card metadata for the route.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<StatsSearchParams>;
}): Promise<Metadata> {
  const { id: slug } = await params;
  const card = parseRouteCard(slug, (await searchParams) ?? {});
  // The line's own two fields, not a summary of its week: a title names the
  // route, and reading it this way keeps the head clear of both the aggregation
  // and the clock a default window would need.
  // Undefined when the read failed, which is an outage rather than a missing route.
  const route = await getRouteLabel(slug).catch(readFallback("route-label", undefined));
  if (route === null) return { title: "Route not found" };
  const name = route ? routeSubtitle({ ...route, slug }) : null;
  const label = route ? routeDisplayName({ ...route, slug }) : slug;
  const title = route ? (name ? `${label} · ${name}` : label) : `Route ${slug}`;
  const description = `On-time performance for ${name ?? label} ${MEASURED_AGAINST}`;
  return pageMetadata({
    title,
    description,
    card: { title: `${title}${cardWhenSuffix(card)}`, path: cardPath(card) },
  });
}

/**
 * Route detail page: a day view (today's worst trips + route map) and a week
 * view (7-day aggregated stats from DailyRouteSummary). Toggle between them via
 * the Day / Week control in the header.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic route params `{ id }`.
 * @param root0.searchParams - Optional query params.
 * @returns Page markup.
 */
export default async function RoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<StatsSearchParams>;
}): Promise<JSX.Element> {
  const { id: slug } = await params;
  const sp = (await searchParams) ?? {};
  // The page has a day and a week view; any other window reads as the day.
  const isWeekView = sp.window === "week";

  // Case-insensitive lookup: /route/nx1 > /route/NX1; unknown slug > 404.
  const canonSlug = await findCanonicalRouteSlug(slug);
  if (canonSlug === null) notFound();
  if (canonSlug !== slug) redirectKeepingQuery(routeHref(canonSlug), sp);

  // A train line retired by the CRL rename keeps its Route row, so /route/STH
  // resolves rather than 404s; send it to the line that replaced it, which reads
  // both lines' history. Only redirects once the successor has carried traffic.
  // next.config.ts sends the exact retired slugs first; this catches other cases (/route/sth).
  const successorSlug = await findSuccessorRouteSlug(slug);
  if (successorSlug) redirectKeepingQuery(routeHref(successorSlug), sp);

  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const now = await requestNow();
  const today = nzServiceDayString(now);
  const routePath = routeHref(slug);
  if (!isWeekView) {
    clampDayParam(routePath, sp, today);
    dropTodayParam(routePath, sp, today);
  }
  const tripSort = parseTripSort(sp.tsort);
  const isReversed = sp.trev === "1";
  const hours = parseHourRange(sp.hours);
  // Re-derived rather than passed through, so an unreadable `hours` param drops
  // out of every link instead of being carried around the site.
  const hoursParam = hourRangeParam(hours);

  // Service day from ?day, or the one every day page opens on. In week view the
  // day stats are not displayed but the route metadata from getRouteStats is
  // still needed.
  const requestedDay = resolveRequestedDay(sp.day);
  const shown = await resolveShownDay(requestedDay, today);
  const { range, serviceDate } = shown;
  const stats = await getRouteStats({
    routeId: slug,
    from: range.start,
    to: range.end,
    hours,
  });
  const { route, summary, byStop } = stats;
  // Started here and awaited at the header, so it never holds up the stats.
  const operatorsP = getOperatorDirectory();
  const routeMode = route?.mode ?? "BUS";
  const school = isSchoolBus(route?.shortName, route?.longName);
  const punctuality: PunctualityBreakdown = {
    on_time_pct: summary?.on_time_pct ?? null,
    early_pct: summary?.early_pct ?? null,
    late_pct: summary?.late_pct ?? null,
    avg_delay_sec: summary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
    mode: routeMode,
    // A part-of-day view keeps the penalty too: getRouteStats charges it only
    // for the cancelled trips due to start in those hours.
    cancellations: "counted",
  };

  // Week view period: an explicit ?period snaps to that week's seven service
  // days; the rolling default (no param) covers the last seven, today included.
  const periodParam = isWeekView ? resolveRequestedDay(sp.period) : null;
  const { range: weekRange, label: weekPeriodLabel } = resolveRange(
    "week",
    periodParam ?? undefined,
    now,
  );
  const weekFigureNote = periodParam ? weekPeriodLabel : "last 7 days";

  // Start the live AT calls without blocking the shell. They feed only the alert
  // banner, the diagram's alerted-stop highlights, and the trip board's LIVE
  // badges - all streamed in via Suspense once they resolve, so the page shell
  // never waits on AT realtime/alert latency (the main page-load cost on a cold
  // cache and on every dev reload).
  const alertsPromise = getServiceAlerts();
  // Live positions belong only to a view that covers now: today's day view or the
  // rolling week ending today. On a past day the map would show where vehicles
  // are now, and since AT reuses trip ids every day, a past run would pick up
  // today's LIVE badge.
  const isLiveView = isWeekView ? periodParam === null : serviceDate === today;
  // Nothing on a past day is running, so the live-only filter only reads on today's board.
  const liveOnly = !isWeekView && isLiveView && sp.tlive === "1";
  const vehiclesPromise =
    isWeekView || !isLiveView
      ? Promise.resolve<LiveVehicle[]>([])
      : getLiveVehicles().catch(() => []);
  // Narrowed to this route and handed to the board unresolved: the rows, the
  // sort chips and the show-more link are all already in hand, so only the LIVE badges
  // wait on AT. `vehiclesPromise` already swallows its own failure, so this
  // cannot reject.
  const liveTripIdsPromise = vehiclesPromise.then(
    (vehicles) =>
      new Set(
        vehicles
          .filter((v) => routeSlug(v.routeId) === slug && v.tripId !== null)
          .map((v) => v.tripId as string),
      ),
  );

  // Week view skips the expensive trips query. Block only on the fast, cached
  // DB/geometry data the shell needs to render.
  const [trips, view, earliestDay, weekDays, cancelledTrips, detouredTripIds, tripWaits] =
    await Promise.all([
      isWeekView
        ? Promise.resolve([] as Awaited<ReturnType<typeof getRouteTripStats>>)
        : getRouteTripStats({
            routeId: slug,
            range,
            sort: tripSort,
            limit: TRIPS_FETCH_CAP,
          }),
      buildRouteView(slug, byStop, routeMode),
      getEarliestDataDay(1),
      // Rolling default covers the last seven service days, today included;
      // a fixed period uses its week, Monday 4am to Monday 4am.
      getRouteDailyStats(slug, weekRange.start, weekRange.end),
      isWeekView
        ? Promise.resolve([] as Awaited<ReturnType<typeof getCancelledTrips>>)
        : getCancelledTrips(slug, range),
      isWeekView ? Promise.resolve<string[]>([]) : getDetouredTripIds(slug, range),
      isWeekView
        ? Promise.resolve<Awaited<ReturnType<typeof getTripRiderWait>>>({})
        : getTripRiderWait(range),
    ]);

  const dayNav = dayRangeNav(shown, earliestDay, today);
  // The window controls: the day stepper, or the week stepper built as every
  // range page builds it. Their links carry the rest of the query from the URL.
  const rangeNav = isWeekView
    ? periodRangeNav(routePath, "week", sp.period, now, earliestDay, today).nav
    : dayNav;
  const linkDay = dayLinkParam(serviceDate, today);
  // A stop opens on the day shown; /stop has no week view, so the week view's stop links carry none.
  const stopDay = linkDay;

  // Direction entries sorted by id. Carrying the direction alongside its id
  // means the active direction's variants are looked up once, below, rather
  // than re-indexed by id at every use.
  const dirEntries = Object.entries(view.directions)
    .map(([d, dir]): [number, { variants: RouteVariant[] }] => [Number(d), dir])
    .sort(([a], [b]) => a - b);
  const dirKeys = dirEntries.map(([d]) => d);
  const requestedDir = sp.heading != null && /^\d+$/.test(sp.heading) ? Number(sp.heading) : null;
  // An unknown ?heading falls back to the unfiltered "both" view.
  const activeEntry =
    requestedDir == null ? null : (dirEntries.find(([d]) => d === requestedDir) ?? null);
  const activeDir = activeEntry?.[0] ?? null;
  const activeVariants = activeEntry?.[1].variants ?? null;

  // How this page is being read: the direction, hours and trip sort. The day
  // stepper keeps the whole set; the direction chips and the trips board each
  // drop the one param they set themselves, so the three cannot drift apart.
  const viewParams: Record<string, string> = {
    ...(activeDir != null ? { heading: String(activeDir) } : {}),
    ...(liveOnly ? { [LIVE_ONLY_PARAM]: "1" } : {}),
    ...(tripSort !== "off" ? { tsort: tripSort } : {}),
    ...(isReversed ? { trev: "1" } : {}),
    ...(hoursParam ? { hours: hoursParam } : {}),
  };
  const stopSort = tableSort(
    sp,
    STOP_COLUMNS,
    "arrivals",
    (p) => buildHref(routePath, { ...viewParams, day: linkDay, ...p }),
    STOP_SORT,
  );
  // The chosen direction's GTFS ids: its own plus any merged into it, so a
  // shape or vehicle filed under an alias id stays with its direction.
  const activeDirIds =
    activeDir == null
      ? null
      : [
          activeDir,
          ...[...view.directionIdAliases.entries()]
            .filter(([, primary]) => primary === activeDir)
            .map(([alias]) => alias),
        ];
  const mapLines = (
    activeDirIds == null
      ? view.routeLines
      : view.routeLines.filter((l) => l.directionId != null && activeDirIds.includes(l.directionId))
  ).map((l) => l.points);
  const dirStopIds =
    activeVariants == null ? null : new Set(activeVariants.flatMap((v) => v.stopIds));
  const mapStops =
    dirStopIds == null ? view.stops : view.stops.filter((s) => dirStopIds.has(s.stop_id));

  // A cut-short run carries the wait for the stops it never reached (see
  // lib/rider-wait.ts), which can move it on a delay sort, so those sorts are
  // redone here rather than taken from the database.
  const penalisedTrips = trips.map((t) => withTripPenalty(t, tripWaits[t.trip_id]));
  const sortedTrips =
    tripSort === "departure"
      ? isReversed
        ? [...penalisedTrips].reverse()
        : penalisedTrips
      : sortRuns(penalisedTrips, tripSort, isReversed);
  const cancelledWaits = Object.fromEntries(
    Object.entries(tripWaits).map(([tripId, p]) => [tripId, p.waitSec]),
  );

  // Week view: use neutral stop colouring (no day-specific delay data on the map).
  const weekMapStops = mapStops.map((s) => ({ ...s, avg_delay_sec: null, on_time_pct: null }));
  const weekSummary = aggregateWeek(weekDays);
  const weekPunctuality: PunctualityBreakdown = {
    on_time_pct: weekSummary?.on_time_pct ?? null,
    early_pct: null,
    late_pct: null,
    avg_delay_sec: weekSummary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: weekSummary?.avg_abs_delay_sec ?? null,
    mode: routeMode,
    // getRouteDailyStats applies the penalty to each day before they are merged.
    cancellations: "counted",
  };

  // The direction and time chips each set their own param over the rest of the
  // view, so a chip changes one thing and carries everything else.
  const viewBase: LinkQuery = {
    ...(isWeekView ? { window: "week", period: periodParam } : { day: requestedDay }),
    ...viewParams,
  };
  /**
   * Link to this view in a different direction.
   * @param dir - The direction id, or null for both.
   * @returns The href.
   */
  const dirHref = (dir: number | null): string =>
    buildHref(routePath, { ...viewBase, heading: dir == null ? undefined : String(dir) });

  const dirHeadsigns =
    activeVariants == null
      ? null
      : new Set(activeVariants.map((v) => v.headsign).filter((h): h is string => h != null));
  const dirFirstStops =
    activeVariants == null
      ? null
      : new Set(activeVariants.map((v) => v.stopIds[0]).filter((s): s is string => s != null));

  /**
   * Whether a trip runs in the active direction: by direction id, then headsign,
   * then first stop, keeping any trip none of them can place.
   * @param t - The trip's direction clues.
   * @param t.direction_id - GTFS direction id, when known.
   * @param t.headsign - Destination headsign, when known.
   * @param t.first_stop_id - First scheduled stop, when known (running trips only).
   * @returns True when the trip belongs on the filtered board.
   */
  const inActiveDir = (t: {
    direction_id?: number | null;
    headsign?: string | null;
    first_stop_id?: string | null;
  }): boolean => {
    if (activeDir == null) return true;
    if (t.direction_id != null)
      return (view.directionIdAliases.get(t.direction_id) ?? t.direction_id) === activeDir;
    if (t.headsign != null && dirHeadsigns) return dirHeadsigns.has(t.headsign);
    if (t.first_stop_id != null && dirFirstStops) {
      const matchesActive = dirFirstStops.has(t.first_stop_id);
      const matchesAny = dirEntries.some(([, dir]) =>
        dir.variants.some((v) => v.stopIds[0] === t.first_stop_id),
      );
      if (matchesAny) return matchesActive;
    }
    return true;
  };
  // The board has to honour the time chips too: a reader who picked the morning
  // peak and got a board of evening buses would read the summary as wrong. A run
  // is placed by when it was due to leave, so a trip that starts inside the
  // range stays whole even where it runs past the end of it. A cancellation with
  // no known start cannot be placed, so it is left out of a narrowed view.
  /**
   * Whether a run belongs to the chosen part of the day.
   * @param startedAt - ISO instant the run was due to leave, or null when unknown.
   * @returns True when no range is set, or the run starts inside it.
   */
  const inHours = (startedAt: string | null): boolean =>
    hours == null || (startedAt != null && isHourInRange(nzLocalHour(new Date(startedAt)), hours));
  const dirTrips = sortedTrips.filter((t) => inActiveDir(t) && inHours(t.scheduled_start));
  const boardRows = buildTripBoardRows(
    dirTrips,
    cancelledTrips.filter((c) => inActiveDir(c) && inHours(c.scheduled_start)),
    tripSort,
    isReversed,
    cancelledWaits,
  );

  const totalTrips = dirTrips.length;
  const tripsCapped = trips.length >= TRIPS_FETCH_CAP;

  // The board sets `tsort`, `tlive` and `tpage` itself, so everything else about the view carries.
  const tripPreserved: Record<string, string> = {
    ...(requestedDay ? { day: requestedDay } : {}),
  };
  for (const [k, v] of Object.entries(viewParams)) if (k !== "tsort") tripPreserved[k] = v;
  const boardProps: TripBoardSectionProps = {
    rows: boardRows,
    liveOnly,
    liveTripIds: liveTripIdsPromise,
    page: sp.tpage,
    board: {
      routeId: slug,
      serviceDate,
      sort: tripSort,
      isReversed,
      mode: routeMode,
      basePath: routePath,
      preservedParams: tripPreserved,
      liveTripIds: liveTripIdsPromise,
      detouredTripIds: new Set(detouredTripIds),
      canFilterLive: isLiveView,
    },
  };

  const title = route ? routeDisplayName({ ...route, slug }) : slug;
  const subtitle = route ? routeSubtitle({ ...route, slug }) : null;
  const [operators, directory] = await operatorsP;
  const operator = operatorOf(operators[slug], directory);

  return (
    <main className="space-y-4">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={title}
          icon={
            route && (
              <ModeIcon
                mode={route.mode}
                shortName={route.shortName}
                longName={route.longName}
                colour={route.colour}
                className="h-7 w-7"
              />
            )
          }
          subtitle={subtitle !== title ? subtitle : undefined}
          actions={<RangeControls basePath={routePath} nav={rangeNav} windows={ROUTE_WINDOWS} />}
        >
          {operator && (
            <p className="mt-0.5 text-sm text-at-muted">
              Run by{" "}
              <Link
                href={buildHref(
                  operatorHref(operator),
                  isWeekView
                    ? { window: "week", period: periodParam ?? undefined }
                    : { day: requestedDay ?? undefined },
                )}
                className="at-link"
              >
                {operator.name}
              </Link>
            </p>
          )}
          <p className="mt-0.5 text-sm">
            <Link
              href={buildHref("/compare", {
                kind: "routes",
                ids: slug,
                ...(isWeekView
                  ? { window: "week", period: periodParam ?? undefined }
                  : { day: requestedDay ?? undefined }),
              })}
              className="at-link"
            >
              Compare with other routes
            </Link>
          </p>
        </PageHeader>
        {/* An outage reads as a route with no schedule otherwise: the chips and
            the diagram simply would not be there, with nothing to say why. */}
        {view.patternFailed && (
          <p className="text-sm text-at-late">
            This route&apos;s stopping pattern could not be loaded, so the direction filter and the
            line diagram are missing. Every figure below is unaffected. Reload to try again.
          </p>
        )}
        {dirKeys.length > 1 && (
          <DirectionFilter
            dirKeys={dirKeys}
            activeDir={activeDir}
            labels={Object.fromEntries(
              dirEntries.map(([d, dir]) => [d, directionLabel(dir.variants, d, routeMode)]),
            )}
            hrefs={{
              both: dirHref(null),
              ...Object.fromEntries(dirKeys.map((d) => [String(d), dirHref(d)])),
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <HourRangeFilter
            basePath={routePath}
            params={Object.fromEntries(
              Object.entries(viewBase).map(([k, v]) => [k, v ?? undefined]),
            )}
            hours={hours}
            nowHour={isLiveView && !isWeekView ? nzLocalHour(now) : null}
          />
        </div>
      </div>

      <RouteAlertBannerSection alertsPromise={alertsPromise} slug={slug} live={isLiveView} />

      {isWeekView ? (
        <>
          {/* Week stats summary */}
          <Panel>
            <div className="grid grid-cols-2 sm:grid-cols-3">
              <StatCell label="Arrivals" note={weekFigureNote}>
                {formatCount(weekSummary?.events ?? 0)}
              </StatCell>
              <PunctualityStat
                bare
                variant="average"
                label="Avg off by"
                value={
                  weekSummary?.avg_abs_delay_sec == null
                    ? UNKNOWN_VALUE
                    : formatDuration(weekSummary.avg_abs_delay_sec)
                }
                breakdown={weekPunctuality}
              />
              <PunctualityStat
                bare
                variant="split"
                label="On time"
                value={formatPct(weekSummary?.on_time_pct)}
                breakdown={weekPunctuality}
              />
            </div>
          </Panel>

          {/* The week figures come from per-route daily summaries, which split by
              neither direction nor part of day, so say so rather than imply they
              are filtered. The part-of-day chips render in both views, so here
              the highlighted chip changes no figure on the page at all - which
              is worth a reader's attention more than the direction caveat is. */}
          {(activeDir != null || hours != null) && (
            <p className="text-xs text-at-muted">
              {activeDir != null &&
                "The week's figures cover both directions; the map and diagram pick out this one. "}
              {hours != null &&
                "They cover the whole of each day as well: a part of the day narrows the day view, not the week."}
            </p>
          )}

          <RouteWeekSummary
            days={weekDays}
            mode={routeMode}
            label={weekPeriodLabel}
            dayHref={(date) =>
              buildHref(routePath, {
                day: dayLinkParam(date, today),
                heading: activeDir == null ? undefined : String(activeDir),
              })
            }
          />

          {/* Map and diagram with neutral stop colouring in week mode */}
          <RouteMapDiagram
            stops={weekMapStops}
            routeLines={mapLines}
            routeId={slug}
            live={isLiveView}
            mode={routeMode}
            school={school}
            filterDirectionIds={activeDirIds ?? undefined}
          />
          {/* Hidden rather than empty when the pattern failed to load: the
              diagram's own empty state reads "no stopping pattern yet", which
              is the wrong story, and the note above already tells the right one. */}
          {!view.patternFailed && (
            <Suspense fallback={<LoadingBlock label="Loading the stopping pattern" />}>
              <RouteDiagramSection
                alertsPromise={alertsPromise}
                live={isLiveView}
                slug={slug}
                view={view}
                range={null}
                mode={routeMode}
                activeDir={activeDir}
              />
            </Suspense>
          )}
        </>
      ) : (
        <>
          {/* Day stats summary */}
          <Panel>
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <StatCell label="Arrivals">{formatCount(summary?.events ?? 0)}</StatCell>
              <StatCell label="Trips">{formatCount(totalTrips)}</StatCell>
              <PunctualityStat
                bare
                variant="average"
                label="Avg off by"
                value={
                  summary?.avg_abs_delay_sec == null
                    ? UNKNOWN_VALUE
                    : formatDuration(summary.avg_abs_delay_sec)
                }
                breakdown={punctuality}
              />
              <PunctualityStat
                bare
                variant="split"
                label="On time"
                value={formatPct(summary?.on_time_pct)}
                breakdown={punctuality}
              />
            </div>
            {/* Same reasoning as the stop page's strip: a 0 and three dashes are
                one absence told two ways. Named here so a quiet day, a day the
                filters emptied and a day with no data read differently. */}
            {summary === null && (
              <EmptyState inset className="border-t border-at-border px-4 py-3">
                No arrivals recorded for this route
                {hours != null ? " in this part of the day" : " on this day"}, so there is nothing
                to average.
              </EmptyState>
            )}
          </Panel>

          {/* What the direction chips do not reach. Both figures come from one
              getRouteStats call, which takes no direction at all, so "Trips"
              and the runs below describe one direction while "Arrivals" and
              "On time" describe both. */}
          {activeDir != null && (
            <p className="text-xs text-at-muted">
              Arrivals, Avg off by and On time cover both directions; Trips, the trips below, the
              map and the diagram pick out this one.
            </p>
          )}

          {/* The board on the left, the map and the line diagram stacked on the
              right, so the diagram sits beside the board rather than below it. */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
              {/* The live-only board waits on AT's realtime call to know which rows
                  to list, so it streams in; the full board does not wait. */}
              {liveOnly ? (
                <Suspense fallback={<LoadingBlock label="Loading the live trips" />}>
                  <TripBoardSection {...boardProps} />
                </Suspense>
              ) : (
                <TripBoardSection {...boardProps} />
              )}
              {tripsCapped && (
                <p className="text-xs text-at-muted">
                  Showing the first {TRIPS_FETCH_CAP} trips of the day.
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              <RouteMapDiagram
                stops={mapStops}
                routeLines={mapLines}
                routeId={slug}
                live={isLiveView}
                mode={routeMode}
                school={school}
                filterDirectionIds={activeDirIds ?? undefined}
                stopDay={stopDay}
              />
              {/* Hidden, not empty, when the pattern failed - see the week view above. */}
              {!view.patternFailed && (
                <Suspense fallback={<LoadingBlock label="Loading the stopping pattern" />}>
                  <RouteDiagramSection
                    alertsPromise={alertsPromise}
                    live={isLiveView}
                    slug={slug}
                    view={view}
                    range={range}
                    mode={routeMode}
                    activeDir={activeDir}
                    stopDay={stopDay}
                    narrow
                  />
                </Suspense>
              )}
            </div>
          </div>

          <section aria-labelledby="route-stops" className="space-y-3">
            <SectionHeading id="route-stops">Stops</SectionHeading>
            {byStop.length === 0 ? (
              <EmptyState>No stop-level arrivals recorded for this route on this day.</EmptyState>
            ) : (
              // Opened by a sort, which reloads the page and would otherwise fold
              // the table the reader just sorted away. The heading sits outside
              // the summary, which is a button to assistive tech and drops any
              // heading inside it from the outline.
              <details
                className="group at-card"
                open={sp.ssort !== undefined || sp.srev !== undefined}
              >
                <summary className="flex tap-h cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-at-shore select-none">
                  {plural(byStop.length, "stop")} with arrivals
                  <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <DataTable
                  caption="Arrivals and delay at each stop"
                  framed={false}
                  className="border-t border-at-border"
                >
                  <thead>
                    <tr className="at-th-row">
                      <SortHeader {...stopSort.head("stop")} align="left">
                        Stop
                      </SortHeader>
                      <SortHeader {...stopSort.head("arrivals")}>Arrivals</SortHeader>
                      <SortHeader {...stopSort.head("delay")}>Early or late</SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(byStop, STOP_COLUMNS, stopSort.sort).map((s) => (
                      <tr key={s.stop_id} className={ROW_CLASS}>
                        <th scope="row" className={cn(CELL_CLASS, "text-left font-normal")}>
                          <Link
                            href={stopHref(s.stop_id, { day: stopDay })}
                            className="at-link font-semibold"
                          >
                            {s.name}
                          </Link>
                        </th>
                        <td className={cn(CELL_CLASS, "text-right tabular-nums")}>
                          {formatCount(s.events)}
                        </td>
                        <td className={cn(CELL_CLASS, "text-right whitespace-nowrap")}>
                          <OffScheduleValue
                            signedSec={s.avg_delay_sec}
                            absSec={null}
                            mode={routeMode}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                {/* These rows and the strip above them are computed over
                    different populations: applyPenalty adds a visit per missed
                    stop to the strip's Arrivals, and no per-stop row takes a
                    share of it, so the column genuinely does not add up to the
                    figure above. Only worth saying when a penalty was applied. */}
                {punctuality.cancellations === "counted" && (
                  <p className="border-t border-at-border px-4 py-3 text-xs text-at-muted">
                    Stop rows count measured arrivals only, so on a day with cancellations they add
                    up to less than Arrivals above, which counts each missed stop as a rider wait.
                  </p>
                )}
              </details>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/**
 * Streamed "Service alerts" banner: awaits the shared alerts feed off the
 * critical path, keeps the alerts informing this route, and resolves the names
 * of any other routes they mention. On the current day a "Coming up" banner
 * follows with the route's alerts due in the next week, so a planned detour is
 * seen before it starts. Renders nothing while it streams.
 * @param root0 - Props.
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @param root0.slug - This route's slug, to filter the alerts.
 * @param root0.live - Whether the page is showing the current day or window.
 * @returns The alert banner.
 */
async function RouteAlertBannerSection({
  alertsPromise,
  slug,
  live,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  slug: string;
  live: boolean;
}): Promise<JSX.Element> {
  const routeAlerts = alertsForRoute(await alertsPromise, [slug]);
  const upcoming = live
    ? alertsForRoute(await getUpcomingAlerts().catch((): ServiceAlert[] => []), [slug])
    : [];
  const alertRouteIds = [
    ...new Set(
      [...routeAlerts, ...upcoming].flatMap((a) =>
        a.informed_entity.map((e) => e.route_id).filter((id): id is string => !!id),
      ),
    ),
  ];
  const routeNames = await getRouteNames(alertRouteIds);
  return (
    <>
      <AlertBanner
        alerts={routeAlerts}
        heading="Service alerts"
        routeNames={routeNames}
        pastWindow={!live}
      />
      <AlertBanner alerts={upcoming} heading="Coming up" routeNames={routeNames} upcoming />
    </>
  );
}

/**
 * Streamed line diagram: lays the route out as one strip, and awaits the day's
 * figures per stop, its closures and detours, and the shared alerts feed off
 * the critical path, so none of them holds up the shell. The strip always carries both directions; the page's
 * direction chip dims the other one rather than dropping it, so no stop moves.
 * @param root0 - Props.
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @param root0.slug - This route's slug, to filter the alerts and read its figures.
 * @param root0.view - The route's directions, stop names and positions.
 * @param root0.range - The day to read figures, closures and detours per stop for, or null for the
 *   week, which has none.
 * @param root0.mode - The route's mode.
 * @param root0.activeDir - The direction the page's chip picked, or null for both.
 * @param root0.live - Whether the page is showing the current day or window.
 * @param root0.stopDay - The day each stop's link opens on.
 * @param root0.narrow - Drawn in a half-width column, so one column of stops at every width.
 * @returns The route line diagram.
 */
async function RouteDiagramSection({
  alertsPromise,
  slug,
  view,
  range,
  mode,
  activeDir,
  live,
  stopDay,
  narrow = false,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  slug: string;
  view: RouteView;
  range: DateRange | null;
  mode: string;
  activeDir: number | null;
  live: boolean;
  stopDay?: string;
  narrow?: boolean;
}): Promise<JSX.Element> {
  const strip = buildStrip({
    directions: view.directions,
    names: view.nameByStop,
    coords: new Map(view.stops.map((s) => [s.stop_id, [s.lat, s.lon] as const])),
  });
  // The alerts feed is a snapshot of right now, with no history, so its stop
  // rings describe today whatever day the page is showing. The banner can say
  // so in words; a ring on a stop cannot, so on an archived day the diagram
  // simply goes unmarked. The closures recorded as they happened carry their
  // own alerts, so those mark any day.
  const [routeAlerts, splitRows, closures] = await Promise.all([
    live ? alertsPromise.then((a) => alertsForRoute(a, [slug])) : Promise.resolve([]),
    range ? getRouteStopSplit(slug, range, mode, view.rawToCanon) : Promise.resolve(null),
    range ? getRouteClosures(slug, range) : Promise.resolve(null),
  ]);
  const marks =
    range && closures && closures.length > 0
      ? stripMarks({
          strip,
          directions: view.directions,
          closures,
          rawToCanon: view.rawToCanon,
          directionIdAliases: view.directionIdAliases,
          day: { start: range.start.getTime(), end: range.end.getTime() },
        })
      : null;
  const split = splitRows
    ? splitStopFigures(splitRows, {
        versions: strip.versions,
        directionIdAliases: view.directionIdAliases,
        rawToCanon: view.rawToCanon,
      })
    : null;
  const alertStops = new Set(
    routeAlerts.flatMap((a) =>
      a.informed_entity
        .filter((e) => e.stop_id)
        .map((e) => view.rawToCanon.get(e.stop_id!) ?? e.stop_id!),
    ),
  );
  const alertRows = strip.rows
    .filter((r) => r.stopIds.some((id) => alertStops.has(id)))
    .map((r) => r.key);
  const side: StripSide | null =
    activeDir == null
      ? null
      : strip.down.includes(activeDir)
        ? "down"
        : strip.up.includes(activeDir)
          ? "up"
          : null;
  return (
    <RouteStrip
      strip={strip}
      split={split}
      mode={mode}
      side={side}
      alertRows={alertRows}
      marks={marks}
      stopDay={stopDay}
      narrow={narrow}
    />
  );
}

/** Props for {@link TripBoardSection}. */
interface TripBoardSectionProps {
  /** Every row of the day's board, in display order. */
  rows: TripBoardRow[];
  /** List only the trips running now. */
  liveOnly: boolean;
  /** Trip ids running now, from AT's realtime feed. */
  liveTripIds: Promise<ReadonlySet<string>>;
  /** The raw `tpage` param. */
  page: string | undefined;
  /** Everything else the board takes. */
  board: Omit<
    ComponentProps<typeof WorstTripsBoard>,
    "rows" | "total" | "page" | "liveOnly" | "fleet"
  >;
}

/**
 * One page of the trip board: narrowed to the trips running now when asked,
 * then cut to the page, with the page's vehicles named from the fleet register.
 * @param props - See {@link TripBoardSectionProps}.
 * @param props.rows - Every row of the day's board.
 * @param props.liveOnly - List only the trips running now.
 * @param props.liveTripIds - Trip ids running now.
 * @param props.page - The raw page param.
 * @param props.board - The board's other props.
 * @returns The board.
 */
async function TripBoardSection({
  rows,
  liveOnly,
  liveTripIds,
  page: rawPage,
  board,
}: TripBoardSectionProps): Promise<JSX.Element> {
  const live = liveOnly ? await liveTripIds : null;
  const listed = live ? rows.filter((r) => r.kind === "run" && live.has(r.trip.trip_id)) : rows;
  const page = parseTripPage(rawPage, Math.ceil(listed.length / TRIP_PAGE_SIZE));
  const pageRows = listed.slice((page - 1) * TRIP_PAGE_SIZE, page * TRIP_PAGE_SIZE);
  // The page's fleet labels, so a row names a vehicle as its own page does.
  const fleet = await getFleet([
    ...new Set(
      pageRows.flatMap((r) => (r.kind === "run" && r.trip.vehicle_id ? [r.trip.vehicle_id] : [])),
    ),
  ]).catch(readFallback("route-fleet", new Map<string, FleetVehicle>()));
  return (
    <WorstTripsBoard
      {...board}
      rows={pageRows}
      total={listed.length}
      page={page}
      liveOnly={liveOnly}
      fleet={fleet}
    />
  );
}
