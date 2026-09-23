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
import { DayNav } from "@/components/DayNav";
import { DirectionFilter } from "@/components/DirectionFilter";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RouteMapDiagram } from "@/components/RouteMapDiagram";
import { RouteStrip } from "@/components/RouteStrip";
import { RouteWeekSummary } from "@/components/RouteWeekSummary";
import { LineDiagramSkeleton } from "@/components/SkeletonParts";
import { StepPending } from "@/components/StepPending";
import { TimeOfDayFilter } from "@/components/TimeOfDayFilter";
import { WorstTripsBoard } from "@/components/WorstTripsBoard";
import { alertsForRoute, getServiceAlerts, type ServiceAlert } from "@/lib/at-alerts";
import { cn } from "@/lib/cn";
import { MEASURED_AGAINST } from "@/lib/copy";
import {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getCancelledTrips,
  getDetouredTripIds,
  getEarliestDataDay,
  getRouteClosures,
  getRouteDailyStats,
  getRouteNames,
  getRouteStats,
  getRouteStopSplit,
  getTripRiderWait,
  getWorstTripsOfDay,
  type TripSort,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { readFallback } from "@/lib/db";
import { formatDuration, offScheduleValue, UNKNOWN_VALUE } from "@/lib/format";
import { lineName } from "@/lib/line-name";
import { cardMetadata, cardPath, cardWhenSuffix, parseRouteCard } from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { resolveRequestedDay, resolveShownDay, resolveWeekNav } from "@/lib/page-nav";
import { dayRangeNav, weekPeriodOf } from "@/lib/range-page";
import { withTripPenalty } from "@/lib/rider-wait";
import { routeSlug } from "@/lib/route-slug";
import { buildStrip, type StripSide } from "@/lib/route-strip";
import { buildRouteView, type RouteView } from "@/lib/route-view";
import { aggregateWeek } from "@/lib/route-week";
import { splitStopFigures } from "@/lib/stop-split";
import { stripMarks } from "@/lib/strip-marks";
import {
  nzLocalHour,
  nzServiceDayString,
  nzWeekRange,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";
import {
  hourRangeParam,
  isHourInRange,
  parseHourRange,
  TIME_PRESETS,
  type HourRange,
} from "@/lib/time-of-day";
import { buildTripBoardRows, sortRuns } from "@/lib/trip-board";
import { buildHref } from "@/lib/utils";
import { routeStatsQuery } from "@/lib/validate";
import { getLiveVehicles, type LiveVehicle } from "@/lib/vehicles";
import type { RouteVariant } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type JSX } from "react";

/** Trips shown per page on the "of the day" board. */
const PAGE_SIZE = 10;

/** Upper bound on the day's runs fetched for the paginated board. */
const TRIPS_FETCH_CAP = 500;

/** Query params for route detail (raw strings). */
interface StatsSearchParams {
  thresholdSec?: string;
  day?: string;
  tsort?: string;
  tpage?: string;
  /** Reverse the active sort direction when "1". */
  trev?: string;
  dir?: string;
  window?: string;
  /** Week start (`YYYY-MM-DD` Monday) when stepping back through the week view. */
  period?: string;
  /** Part of the service day to narrow to, e.g. `7-9`; absent covers all of it. */
  hours?: string;
}

/** Valid trip-sort values. */
const TRIP_SORTS = ["off", "late", "early", "departure"] as const;

/**
 * Full headsign label for a direction chip, taken from the busiest variant.
 * @param variants - The direction's variants.
 * @param dirId - The direction id (for the fallback label).
 * @returns The headsign, or `Direction N` when none is available.
 */
function directionLabel(variants: RouteVariant[], dirId: number): string {
  const busiest = variants.reduce<RouteVariant | undefined>(
    (a, b) => (a === undefined || b.tripCount > a.tripCount ? b : a),
    undefined,
  );
  return busiest?.headsign || `Direction ${dirId + 1}`;
}

/**
 * Route URL with an optional `?dir`, preserving the base params (day/threshold).
 * @param slug - The route slug.
 * @param base - Params to keep (day, threshold).
 * @param dir - The direction id, or null for "both".
 * @returns The href.
 */
function routeDirHref(slug: string, base: URLSearchParams, dir: number | null): string {
  const p = new URLSearchParams(base);
  if (dir != null) p.set("dir", String(dir));
  const qs = p.toString();
  return `/route/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`;
}

/**
 * Prev/next week stepper for the route week view. Omits a chevron when the
 * corresponding href is null (at the edge of the data range).
 * @param props - Component props.
 * @param props.label - Human label for the active period.
 * @param props.prevHref - Previous-week link, or null when unavailable.
 * @param props.nextHref - Next-week link, or null when already at the present.
 * @returns The stepper element.
 */
function RouteWeekNav({
  label,
  prevHref,
  nextHref,
}: {
  label: string;
  prevHref: string | null;
  nextHref: string | null;
}): JSX.Element {
  return (
    // Week steps prefetch in full for the reason DayNav's do.
    <div className="flex items-center gap-1">
      {prevHref ? (
        <Link
          href={prevHref}
          prefetch
          aria-label="Previous week"
          className="chip chip-off flex items-center"
        >
          <StepPending>
            <ChevronLeft className="block h-4 w-4" />
          </StepPending>
        </Link>
      ) : null}
      <span className="px-1 text-sm font-semibold tabular-nums">{label}</span>
      {nextHref ? (
        <Link
          href={nextHref}
          prefetch
          aria-label="Next week"
          className="chip chip-off flex items-center"
        >
          <StepPending>
            <ChevronRight className="block h-4 w-4" />
          </StepPending>
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Day / Week toggle using `chip chip-on` / `chip chip-off` pill classes. Each
 * side keeps the direction and stays on the period being looked at: a past day's
 * Week opens that day's calendar week, and a stepped-back week's Day opens its Monday.
 * @param props - Component props.
 * @param props.slug - Route slug (for hrefs).
 * @param props.isWeekView - Whether the week segment is active.
 * @param props.dayQuery - Query for the Day side.
 * @param props.weekQuery - Query for the Week side.
 * @returns The toggle element.
 */
function ViewToggle({
  slug,
  isWeekView,
  dayQuery,
  weekQuery,
}: {
  slug: string;
  isWeekView: boolean;
  dayQuery: Record<string, string | undefined>;
  weekQuery: Record<string, string | undefined>;
}): JSX.Element {
  const base = `/route/${encodeURIComponent(slug)}`;
  return (
    <div className="flex items-center gap-1">
      <Link
        href={buildHref(base, dayQuery)}
        className={cn("chip", isWeekView ? "chip-off" : "chip-on")}
      >
        Day
      </Link>
      <Link
        href={buildHref(base, { window: "week", ...weekQuery })}
        className={cn("chip", isWeekView ? "chip-on" : "chip-off")}
      >
        Week
      </Link>
    </div>
  );
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
  const { id } = await params;
  const slug = routeSlug(id);
  const card = parseRouteCard(id, (await searchParams) ?? {});
  const stats = await getRouteStats({ routeId: slug, thresholdSec: ON_TIME_LATE_SEC }).catch(
    readFallback("route-stats", null),
  );
  const route = stats?.route;
  const name = route ? lineName(route.mode, route.shortName) : null;
  const label = route?.shortName ?? slug;
  const title = route ? (name ? `${label} - ${name}` : label) : `Route ${slug}`;
  const description = `On-time performance for ${name ?? label} ${MEASURED_AGAINST}`;
  return {
    title,
    description,
    ...cardMetadata(`${title}${cardWhenSuffix(card)}`, description, cardPath(card)),
  };
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
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // Any window but the day means the week view: this page has no month, so a
  // `window=month` link kept from before routeLinkQuery mapped it - or typed by
  // hand - lands on a period view that names its own range rather than silently
  // showing today. Its `?period` is a month key, which the week parse rejects,
  // so it falls back to the rolling last 7 days.
  const isWeekView = sp.window !== undefined && sp.window !== "day";

  // URLs use the version-stripped slug ("501", not "501-217"); redirect old links.
  const slug = routeSlug(id);
  if (id !== slug) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null)).toString();
    redirect(`/route/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`);
  }

  // Case-insensitive lookup: /route/nx1 > /route/NX1; unknown slug > 404.
  const canonSlug = await findCanonicalRouteSlug(slug);
  if (canonSlug === null) notFound();
  if (canonSlug !== slug) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null)).toString();
    redirect(`/route/${encodeURIComponent(canonSlug)}${qs ? `?${qs}` : ""}`);
  }

  // A train line retired by the CRL rename keeps its Route row, so /route/STH
  // resolves rather than 404s; send it to the line that replaced it, which reads
  // both lines' history. Only redirects once the successor has carried traffic.
  const successorSlug = await findSuccessorRouteSlug(slug);
  if (successorSlug) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null)).toString();
    redirect(`/route/${encodeURIComponent(successorSlug)}${qs ? `?${qs}` : ""}`);
  }

  clampDayParam(`/route/${encodeURIComponent(slug)}`, sp);
  dropTodayParam(`/route/${encodeURIComponent(slug)}`, sp);
  const parsed = routeStatsQuery.safeParse(sp);
  const thresholdSec = (parsed.success ? parsed.data : routeStatsQuery.parse({})).thresholdSec;
  const tripSort = (TRIP_SORTS as readonly string[]).includes(sp.tsort ?? "")
    ? (sp.tsort as TripSort)
    : "off";
  const isReversed = sp.trev === "1";
  const hours = parseHourRange(sp.hours);
  // Re-derived rather than passed through, so an unreadable `hours` param drops
  // out of every link instead of being carried around the site.
  const hoursParam = hourRangeParam(hours);

  // Service day from ?day, or the one every day page opens on. In week view the
  // day stats are not displayed but the route metadata from getRouteStats is
  // still needed.
  const today = nzServiceDayString();
  const requestedDay = resolveRequestedDay(sp.day);
  const shown = await resolveShownDay(requestedDay, today);
  const { range, serviceDate } = shown;
  const stats = await getRouteStats({
    routeId: slug,
    from: range.start,
    to: range.end,
    thresholdSec,
    hours,
  });
  const { route, summary, byStop } = stats;
  const routeMode = route?.mode ?? "BUS";
  const punctuality: PunctualityBreakdown = {
    on_time_pct: summary?.on_time_pct ?? null,
    early_pct: summary?.early_pct ?? null,
    late_pct: summary?.late_pct ?? null,
    avg_delay_sec: summary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
    mode: routeMode,
    // getRouteStats drops the penalty for a part-of-day view, because it is
    // counted per service day and cannot be narrowed to a few hours. The
    // footnote has to follow it, or choosing "Morning peak" lifts the on-time
    // share while the explainer still says cancellations are counted.
    cancellations: hours ? "excluded" : "counted",
  };

  // Week view period: an explicit ?period snaps to that week's seven service
  // days; the rolling default (no param) covers the last seven, today included.
  const periodParam = isWeekView ? resolveRequestedDay(sp.period) : null;
  const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
  const weekPeriodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";

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
  const vehiclesPromise =
    isWeekView || !isLiveView
      ? Promise.resolve<LiveVehicle[]>([])
      : getLiveVehicles().catch(() => []);
  // Narrowed to this route and handed to the board unresolved: the rows, the
  // sort chips and the pager are all already in hand, so only the LIVE badges
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
        ? Promise.resolve([] as Awaited<ReturnType<typeof getWorstTripsOfDay>>)
        : getWorstTripsOfDay({
            routeId: slug,
            range,
            thresholdSec,
            sort: tripSort,
            limit: TRIPS_FETCH_CAP,
          }),
      buildRouteView(slug, byStop, routeMode),
      getEarliestDataDay(1),
      // Rolling default covers the last seven service days, today included;
      // a fixed period uses its week, Monday 4am to Monday 4am.
      getRouteDailyStats(slug, fixedWeekRange?.start, fixedWeekRange?.end),
      isWeekView
        ? Promise.resolve([] as Awaited<ReturnType<typeof getCancelledTrips>>)
        : getCancelledTrips(slug, range),
      isWeekView ? Promise.resolve<string[]>([]) : getDetouredTripIds(slug, range),
      isWeekView
        ? Promise.resolve<Awaited<ReturnType<typeof getTripRiderWait>>>({})
        : getTripRiderWait(range),
    ]);

  // Week stepper navigation - computed after earliestDay is available.
  let weekPrevHref: string | null = null;
  let weekNextHref: string | null = null;
  if (isWeekView) {
    /**
     * Build a week link for this route, preserving the week window and direction.
     * @param period - The week period, or null for the rolling current week.
     * @returns The route week href.
     */
    const weekHref = (period: string | null): string =>
      buildHref(`/route/${encodeURIComponent(slug)}`, {
        window: "week",
        period: period ?? undefined,
        dir: sp.dir != null && /^\d+$/.test(sp.dir) ? sp.dir : undefined,
      });
    ({ prevHref: weekPrevHref, nextHref: weekNextHref } = resolveWeekNav({
      periodParam,
      earliestDay,
      makeHref: weekHref,
    }));
  }

  const dayNav = dayRangeNav(shown, earliestDay, today);
  const linkDay = dayNav.isToday ? undefined : serviceDate;

  // Direction entries sorted by id. Carrying the direction alongside its id
  // means the active direction's variants are looked up once, below, rather
  // than re-indexed by id at every use.
  const dirEntries = Object.entries(view.directions)
    .map(([d, dir]): [number, { variants: RouteVariant[] }] => [Number(d), dir])
    .sort(([a], [b]) => a - b);
  const dirKeys = dirEntries.map(([d]) => d);
  const requestedDir = sp.dir != null && /^\d+$/.test(sp.dir) ? Number(sp.dir) : null;
  // An unknown ?dir falls back to the unfiltered "both" view.
  const activeEntry =
    requestedDir == null ? null : (dirEntries.find(([d]) => d === requestedDir) ?? null);
  const activeDir = activeEntry?.[0] ?? null;
  const activeVariants = activeEntry?.[1].variants ?? null;

  // How this page is being read: the direction, threshold and trip sort. The day
  // stepper keeps the whole set; the direction chips and the trips board each
  // drop the one param they set themselves, so the three cannot drift apart.
  const viewParams: Record<string, string> = {
    ...(activeDir != null ? { dir: String(activeDir) } : {}),
    ...(sp.thresholdSec ? { thresholdSec: sp.thresholdSec } : {}),
    ...(tripSort !== "off" ? { tsort: tripSort } : {}),
    ...(isReversed ? { trev: "1" } : {}),
    ...(hoursParam ? { hours: hoursParam } : {}),
  };
  // Stepping onto today drops `?day` so the URL stays canonical, but that link
  // must still carry the filters.
  const nextDayHref = dayNav.nextIsToday
    ? buildHref(`/route/${encodeURIComponent(slug)}`, viewParams)
    : undefined;
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

  // Week view: use neutral stop coloring (no day-specific delay data on the map).
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

  // The chips set `dir` themselves, so everything else about the view carries.
  const dirBase = new URLSearchParams();
  if (isWeekView) {
    dirBase.set("window", "week");
    if (periodParam) dirBase.set("period", periodParam);
  } else if (requestedDay) dirBase.set("day", requestedDay);
  for (const [k, v] of Object.entries(viewParams)) if (k !== "dir") dirBase.set(k, v);

  // The time chips set `hours` themselves, so everything else about the view
  // carries - the same trick the direction chips use with `dir`.
  const hoursBase = new URLSearchParams(dirBase);
  hoursBase.delete("hours");
  if (activeDir != null) hoursBase.set("dir", String(activeDir));
  /**
   * Link to this view with a different part of the day.
   * @param range - The range, or null for all day.
   * @returns The href.
   */
  const hoursHref = (range: HourRange | null): string => {
    const p = new URLSearchParams(hoursBase);
    const value = hourRangeParam(range);
    if (value) p.set("hours", value);
    const qs = p.toString();
    return `/route/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`;
  };

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
  const totalPages = Math.max(1, Math.ceil(boardRows.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.tpage ?? "1", 10);
  const tripPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );
  const pageRows = boardRows.slice((tripPage - 1) * PAGE_SIZE, tripPage * PAGE_SIZE);

  // The board sets `tsort` itself, so everything else about the view carries.
  const tripPreserved: Record<string, string> = {
    ...(requestedDay ? { day: requestedDay } : {}),
  };
  for (const [k, v] of Object.entries(viewParams)) if (k !== "tsort") tripPreserved[k] = v;

  const title = route?.shortName ?? slug;
  // AT sets every train route's long name to its bare code ("STH", "S-C"), so
  // the published line name is the only readable label the header can show.
  const subtitle = route ? (lineName(route.mode, route.shortName) ?? route.longName) : null;

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
              {route && (
                <ModeIcon
                  mode={route.mode}
                  shortName={route.shortName}
                  longName={route.longName}
                  colour={route.colour}
                  className="h-6 w-6"
                />
              )}
              {title}
            </h1>
            {subtitle && subtitle !== title && (
              <p className="mt-0.5 text-sm text-at-muted">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle
              slug={slug}
              isWeekView={isWeekView}
              dayQuery={{
                day: (isWeekView ? periodParam : requestedDay) ?? undefined,
                dir: activeDir == null ? undefined : String(activeDir),
                thresholdSec: sp.thresholdSec,
                hours: hoursParam,
              }}
              weekQuery={{
                period: (isWeekView ? periodParam : weekPeriodOf(serviceDate)) ?? undefined,
                dir: activeDir == null ? undefined : String(activeDir),
                thresholdSec: sp.thresholdSec,
                hours: hoursParam,
              }}
            />
            {isWeekView ? (
              <RouteWeekNav
                label={weekPeriodLabel}
                prevHref={weekPrevHref}
                nextHref={weekNextHref}
              />
            ) : (
              <DayNav
                basePath={`/route/${encodeURIComponent(slug)}`}
                serviceDate={serviceDate}
                preservedParams={viewParams}
                hasPrev={dayNav.hasPrev}
                atFloor={dayNav.atFloor}
                hasNext={dayNav.hasNext}
                nextHref={nextDayHref}
                nextPending={dayNav.nextPending}
              />
            )}
          </div>
        </div>
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
              dirEntries.map(([d, dir]) => [d, directionLabel(dir.variants, d)]),
            )}
            hrefs={{
              both: routeDirHref(slug, dirBase, null),
              ...Object.fromEntries(
                dirKeys.map((d) => [String(d), routeDirHref(slug, dirBase, d)]),
              ),
            }}
          />
        )}
        <TimeOfDayFilter
          active={hours}
          hrefs={{
            all: hoursHref(null),
            ...Object.fromEntries(TIME_PRESETS.map((p) => [p.key, hoursHref(p.range)])),
          }}
        />
      </header>

      <RouteAlertBannerSection alertsPromise={alertsPromise} slug={slug} live={isLiveView} />

      {isWeekView ? (
        <>
          {/* Week stats summary */}
          <section className="border border-at-border bg-at-surface">
            <div className="grid grid-cols-2 sm:grid-cols-3">
              <div className="p-4">
                <p className="text-xs tracking-zero text-at-muted uppercase">Arrivals</p>
                <p className="text-2xl font-ultra tracking-zero tabular-nums">
                  {weekSummary?.events ?? 0}
                </p>
                <p className="mt-0.5 text-xs text-at-muted">{weekPeriodLabel.toLowerCase()}</p>
              </div>
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
                label="On-time (%)"
                value={weekSummary?.on_time_pct?.toFixed(1) ?? UNKNOWN_VALUE}
                breakdown={weekPunctuality}
              />
            </div>
          </section>

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

          <RouteWeekSummary days={weekDays} mode={routeMode} label={weekPeriodLabel} />

          {/* Map and diagram with neutral stop coloring in week mode */}
          <RouteMapDiagram
            stops={weekMapStops}
            routeLines={mapLines}
            routeId={slug}
            live={isLiveView}
            mode={routeMode}
            filterDirectionIds={activeDirIds ?? undefined}
          />
          {/* Hidden rather than empty when the pattern failed to load: the
              diagram's own empty state reads "no stopping pattern yet", which
              is the wrong story, and the note above already tells the right one. */}
          {!view.patternFailed && (
            <Suspense fallback={<LineDiagramSkeleton />}>
              <RouteDiagramSection
                alertsPromise={alertsPromise}
                live={isLiveView}
                slug={slug}
                view={view}
                range={null}
                mode={routeMode}
                colour={route?.colour ?? null}
                activeDir={activeDir}
              />
            </Suspense>
          )}
        </>
      ) : (
        <>
          {/* Day stats summary */}
          <section className="border border-at-border bg-at-surface">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <div className="p-4">
                <p className="text-xs tracking-zero text-at-muted uppercase">Arrivals</p>
                <p className="text-2xl font-ultra tracking-zero tabular-nums">
                  {summary?.events ?? 0}
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs tracking-zero text-at-muted uppercase">Trips</p>
                <p className="text-2xl font-ultra tracking-zero tabular-nums">{totalTrips}</p>
              </div>
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
                label="On-time (%)"
                value={summary?.on_time_pct?.toFixed(1) ?? UNKNOWN_VALUE}
                breakdown={punctuality}
              />
            </div>
            {/* Same reasoning as the stop page's strip: a 0 and three dashes are
                one absence told two ways. Named here so a quiet day, a day the
                filters emptied and a day with no data read differently. */}
            {summary === null && (
              <p className="border-t border-at-border px-4 py-3 text-sm text-at-muted">
                No arrivals were recorded for this route
                {hours != null ? " in this part of the day" : " on this day"}, so there is nothing
                to average.
              </p>
            )}
          </section>

          {/* What the chips above do not reach. Both figures come from one
              getRouteStats call, which takes no direction at all and drops the
              cancellation penalty as soon as hours narrow the window - so
              "Trips" and the runs below describe one direction while "Arrivals"
              and "On-time" describe both, and a peak can read better than the
              day did without anything having improved. The week view has said
              its half of this since it shipped; the day view said neither. */}
          {(activeDir != null || hours != null) && (
            <p className="text-xs text-at-muted">
              {activeDir != null &&
                "Arrivals, Avg off by and On-time cover both directions; Trips, the runs below, the map and the diagram pick out this one. "}
              {hours != null &&
                "Cancellations are left out of a part-of-day view, so these figures count only the trips that ran."}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <WorstTripsBoard
              liveTripIds={liveTripIdsPromise}
              routeId={slug}
              serviceDate={serviceDate}
              rows={pageRows}
              sort={tripSort}
              isReversed={isReversed}
              mode={routeMode}
              basePath={`/route/${encodeURIComponent(slug)}`}
              preservedParams={tripPreserved}
              page={tripPage}
              totalPages={totalPages}
              detouredTripIds={new Set(detouredTripIds)}
            />
            {tripsCapped && (
              <p className="text-xs text-at-muted lg:col-span-2">
                Showing the first {TRIPS_FETCH_CAP} runs of the day.
              </p>
            )}
            <RouteMapDiagram
              stops={mapStops}
              routeLines={mapLines}
              routeId={slug}
              live={isLiveView}
              mode={routeMode}
              filterDirectionIds={activeDirIds ?? undefined}
            />
          </div>

          {/* Hidden, not empty, when the pattern failed - see the week view above. */}
          {!view.patternFailed && (
            <Suspense fallback={<LineDiagramSkeleton />}>
              <RouteDiagramSection
                alertsPromise={alertsPromise}
                live={isLiveView}
                slug={slug}
                view={view}
                range={range}
                mode={routeMode}
                colour={route?.colour ?? null}
                activeDir={activeDir}
              />
            </Suspense>
          )}

          {byStop.length === 0 ? (
            <section className="border border-at-border bg-at-surface px-4 py-3">
              <h2 className="font-semibold">Stops</h2>
              <p className="mt-1 text-sm text-at-muted">
                No stop-level arrivals recorded for this route on this day.
              </p>
            </section>
          ) : (
            <details className="border border-at-border bg-at-surface">
              <summary className="cursor-pointer px-4 py-3 font-semibold">Stops</summary>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="min-w-full text-sm">
                  <thead className="bg-at-bg text-at-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Stop</th>
                      <th className="px-3 py-2 text-right">Arrivals</th>
                      <th className="px-3 py-2 text-right">Avg delay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStop.map((s) => (
                      <tr
                        key={s.stop_id}
                        className="border-t border-at-border hover:bg-at-shore-pale"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/stop/${encodeURIComponent(s.stop_id)}${linkDay ? `?day=${linkDay}` : ""}`}
                            className="font-semibold text-at-shore hover:underline"
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.events}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {offScheduleValue(s.avg_delay_sec, null, routeMode).text}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* These rows and the strip above them are computed over
                    different populations: applyPenalty adds a visit per missed
                    stop to the strip's Arrivals, and no per-stop row takes a
                    share of it, so the column genuinely does not add up to the
                    figure above. Only worth saying when a penalty was applied. */}
                {punctuality.cancellations === "counted" && (
                  <p className="mt-2 text-xs text-at-muted">
                    Stop rows count measured arrivals only, so on a day with cancellations they add
                    up to less than Arrivals above, which counts each missed stop as a rider wait.
                  </p>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}

/**
 * Streamed "Service alerts" banner: awaits the shared alerts feed off the
 * critical path, keeps the alerts informing this route, and resolves the names
 * of any other routes they mention. Renders nothing while it streams.
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
  const alertRouteIds = [
    ...new Set(
      routeAlerts.flatMap((a) =>
        a.informed_entity.map((e) => e.route_id).filter((id): id is string => !!id),
      ),
    ),
  ];
  const routeNames = await getRouteNames(alertRouteIds);
  return (
    <AlertBanner
      alerts={routeAlerts}
      heading="Service alerts"
      routeNames={routeNames}
      pastWindow={!live}
    />
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
 * @param root0.colour - The route's GTFS colour, or null.
 * @param root0.activeDir - The direction the page's chip picked, or null for both.
 * @param root0.live - Whether the page is showing the current day or window.
 * @returns The route line diagram.
 */
async function RouteDiagramSection({
  alertsPromise,
  slug,
  view,
  range,
  mode,
  colour,
  activeDir,
  live,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  slug: string;
  view: RouteView;
  range: DateRange | null;
  mode: string;
  colour: string | null;
  activeDir: number | null;
  live: boolean;
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
      colour={colour}
      side={side}
      alertRows={alertRows}
      marks={marks}
    />
  );
}
