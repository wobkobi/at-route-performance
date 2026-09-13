// src/app/route/[id]/page.tsx
// Route detail page with a day view (worst trips and route map) and
// a week view of aggregated stats, toggled in the header. Version-stripped and
// case-canonical slugs are enforced up front via redirects; the day view falls
// back to the most recent populated service day when the requested one is empty.
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
import { RouteLineDiagramClient } from "@/components/RouteLineDiagramClient";
import { RouteMapDiagram } from "@/components/RouteMapDiagram";
import { RouteWeekSummary } from "@/components/RouteWeekSummary";
import { WorstTripsBoard } from "@/components/WorstTripsBoard";
import { alertsForRoute, getServiceAlerts, type ServiceAlert } from "@/lib/at-alerts";
import {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getCancelledTrips,
  getEarliestDataDay,
  getRouteDailyStats,
  getRouteNames,
  getRouteStats,
  getWorstTripsOfDay,
  type TripSort,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDelay, formatDuration } from "@/lib/format";
import { lineName } from "@/lib/line-name";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay, resolveWeekNav } from "@/lib/page-nav";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import { buildRouteView } from "@/lib/route-view";
import {
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";
import { buildTripBoardRows } from "@/lib/trip-board";
import { buildHref } from "@/lib/utils";
import { routeStatsQuery } from "@/lib/validate";
import { getLiveVehicles, type LiveVehicle } from "@/lib/vehicles";
import type { RouteDay, RouteVariant } from "@/types/api";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ComponentProps, type JSX } from "react";

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
}

/** Valid trip-sort values. */
const TRIP_SORTS = ["off", "late", "early", "departure"] as const;

/**
 * Event-weighted aggregate of per-day route stats from `DailyRouteSummary`.
 * Returns null when there are no days or no events.
 * @param days - Per-day stats, any order.
 * @returns Event-weighted summary, or null when there are no events.
 */
function aggregateWeek(days: RouteDay[]): {
  events: number;
  avg_delay_sec: number;
  avg_abs_delay_sec: number;
  on_time_pct: number;
} | null {
  const totalEvents = days.reduce((s, d) => s + d.events, 0);
  if (totalEvents === 0) return null;
  return {
    events: totalEvents,
    avg_delay_sec: days.reduce((s, d) => s + (d.avg_delay_sec ?? 0) * d.events, 0) / totalEvents,
    avg_abs_delay_sec:
      days.reduce((s, d) => s + (d.avg_abs_delay_sec ?? 0) * d.events, 0) / totalEvents,
    on_time_pct: days.reduce((s, d) => s + (d.on_time_pct ?? 0) * d.events, 0) / totalEvents,
  };
}

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
    <div className="flex items-center gap-1">
      {prevHref ? (
        <a href={prevHref} aria-label="Previous week" className="chip chip-off flex items-center">
          <ChevronLeft className="block h-4 w-4" />
        </a>
      ) : null}
      <span className="px-1 text-sm font-semibold tabular-nums">{label}</span>
      {nextHref ? (
        <a href={nextHref} aria-label="Next week" className="chip chip-off flex items-center">
          <ChevronRight className="block h-4 w-4" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * Day / Week toggle using `chip chip-on` / `chip chip-off` pill classes.
 * @param props - Component props.
 * @param props.slug - Route slug (for hrefs).
 * @param props.isWeekView - Whether the week segment is active.
 * @returns The toggle element.
 */
function ViewToggle({ slug, isWeekView }: { slug: string; isWeekView: boolean }): JSX.Element {
  const base = `/route/${encodeURIComponent(slug)}`;
  return (
    <div className="flex items-center gap-1">
      <a href={base} className={`chip ${!isWeekView ? "chip-on" : "chip-off"}`}>
        Day
      </a>
      <a href={`${base}?window=week`} className={`chip ${isWeekView ? "chip-on" : "chip-off"}`}>
        Week
      </a>
    </div>
  );
}

/**
 * Per-route page title, so a tab and a shared link name the line rather than
 * repeating the site title. Uses the published line name where there is one
 * (AT's `route_long_name` for a train is just the bare code).
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic route params `{ id }`.
 * @returns Title and description metadata for the route.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const slug = routeSlug((await params).id);
  const stats = await getRouteStats({ routeId: slug, thresholdSec: ON_TIME_LATE_SEC }).catch(
    () => null,
  );
  const route = stats?.route;
  if (!route) return { title: `Route ${slug}` };
  const name = lineName(route.mode, route.shortName);
  const label = route.shortName ?? slug;
  return {
    title: name ? `${label} - ${name}` : label,
    description: `On-time performance for ${name ?? label} against Auckland Transport's published schedule.`,
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
  const isWeekView = sp.window === "week";

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

  dropTodayParam(`/route/${encodeURIComponent(slug)}`, sp);
  const parsed = routeStatsQuery.safeParse(sp);
  const thresholdSec = (parsed.success ? parsed.data : routeStatsQuery.parse({})).thresholdSec;
  const tripSort = (TRIP_SORTS as readonly string[]).includes(sp.tsort ?? "")
    ? (sp.tsort as TripSort)
    : "off";
  const isReversed = sp.trev === "1";

  // Service day from ?day (or the current one). In week view the day stats are
  // not displayed but the route metadata from getRouteStats is still needed.
  const requestedDay = resolveRequestedDay(sp.day);
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  let stats = await getRouteStats({
    routeId: slug,
    from: range.start,
    to: range.end,
    thresholdSec,
  });
  // Day view: fall back to the most recent day with data when today is empty.
  const fallbackDay = await maybeFallbackDay(
    requestedDay,
    !isWeekView && (stats.summary?.events ?? 0) === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallbackDay) {
    range = nzServiceDayRange(fallbackDay);
    serviceDate = nzServiceDayString(range.start);
    stats = await getRouteStats({
      routeId: slug,
      from: range.start,
      to: range.end,
      thresholdSec,
    });
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  const { route, summary, byStop } = stats;
  const routeMode = route?.mode ?? "BUS";
  const punctuality: PunctualityBreakdown = {
    on_time_pct: summary?.on_time_pct ?? null,
    early_pct: summary?.early_pct ?? null,
    late_pct: summary?.late_pct ?? null,
    avg_delay_sec: summary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
    mode: routeMode,
  };

  // Week view period: explicit ?period snaps to that calendar week; rolling
  // default (no param) fetches the 7 most recent records regardless of date.
  const periodParam = isWeekView ? resolveRequestedDay(sp.period) : null;
  const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
  const weekPeriodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";

  // Start the live AT calls without blocking the shell. They feed only the alert
  // banner, the diagram's alerted-stop highlights, and the trip board's LIVE
  // badges - all streamed in via Suspense once they resolve, so the page shell
  // never waits on AT realtime/alert latency (the main page-load cost on a cold
  // cache and on every dev reload).
  const alertsPromise = getServiceAlerts();
  const vehiclesPromise = isWeekView
    ? Promise.resolve<LiveVehicle[]>([])
    : getLiveVehicles().catch(() => []);

  // Week view skips the expensive trips query. Block only on the fast, cached
  // DB/geometry data the shell needs to render.
  const [trips, view, earliestDay, weekDays, cancelledTrips] = await Promise.all([
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
    // a fixed period uses its calendar week.
    getRouteDailyStats(slug, fixedWeekRange?.start, fixedWeekRange?.end),
    isWeekView
      ? Promise.resolve([] as Awaited<ReturnType<typeof getCancelledTrips>>)
      : getCancelledTrips(slug, range),
  ]);

  // Week stepper navigation - computed after earliestDay is available.
  let weekPrevHref: string | null = null;
  let weekNextHref: string | null = null;
  if (isWeekView) {
    /**
     * Build a week link for this route, preserving the week window.
     * @param period - The week period, or null for the rolling current week.
     * @returns The route week href.
     */
    const weekHref = (period: string | null): string =>
      buildHref(`/route/${encodeURIComponent(slug)}`, {
        window: "week",
        period: period ?? undefined,
      });
    ({ prevHref: weekPrevHref, nextHref: weekNextHref } = resolveWeekNav({
      periodParam,
      earliestDay,
      makeHref: weekHref,
    }));
  }

  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? `/route/${encodeURIComponent(slug)}`
      : undefined;
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;
  const delayByStop = Object.fromEntries(byStop.map((s) => [s.stop_id, s.avg_delay_sec]));
  const nameByStop = Object.fromEntries(view.nameByStop);

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
  const mapLines = (
    activeDir == null ? view.routeLines : view.routeLines.filter((l) => l.directionId === activeDir)
  ).map((l) => l.points);
  const dirStopIds =
    activeVariants == null ? null : new Set(activeVariants.flatMap((v) => v.stopIds));
  const mapStops =
    dirStopIds == null ? view.stops : view.stops.filter((s) => dirStopIds.has(s.stop_id));
  const diagramDirections =
    activeEntry == null ? view.directions : { [activeEntry[0]]: activeEntry[1] };

  const sortedTrips = isReversed ? [...trips].reverse() : trips;

  // Week view: use neutral stop coloring (no day-specific delay data on the map).
  const weekMapStops = view.stops.map((s) => ({ ...s, avg_delay_sec: null, on_time_pct: null }));
  const weekSummary = aggregateWeek(weekDays);
  const weekPunctuality: PunctualityBreakdown = {
    on_time_pct: weekSummary?.on_time_pct ?? null,
    early_pct: null,
    late_pct: null,
    avg_delay_sec: weekSummary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: weekSummary?.avg_abs_delay_sec ?? null,
    mode: routeMode,
  };

  const dirBase = new URLSearchParams();
  if (requestedDay) dirBase.set("day", requestedDay);
  if (sp.thresholdSec) dirBase.set("thresholdSec", sp.thresholdSec);
  if (tripSort !== "off") dirBase.set("tsort", tripSort);

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
  const dirTrips = sortedTrips.filter(inActiveDir);
  const boardRows = buildTripBoardRows(
    dirTrips,
    cancelledTrips.filter(inActiveDir),
    tripSort,
    isReversed,
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

  const tripPreserved: Record<string, string> = {};
  if (requestedDay) tripPreserved.day = requestedDay;
  if (sp.thresholdSec) tripPreserved.thresholdSec = sp.thresholdSec;
  if (activeDir != null) tripPreserved.dir = String(activeDir);
  if (isReversed) tripPreserved.trev = "1";

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
            <ViewToggle slug={slug} isWeekView={isWeekView} />
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
                preservedParams={{
                  ...(activeDir != null ? { dir: String(activeDir) } : {}),
                  ...(tripSort !== "off" ? { tsort: tripSort } : {}),
                }}
                hasPrev={hasPrevDay}
                hasNext={hasNextDay}
                nextHref={nextDayHref}
              />
            )}
          </div>
        </div>
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
      </header>

      <RouteAlertBannerSection alertsPromise={alertsPromise} slug={slug} />

      {isWeekView ? (
        <>
          {/* Week stats summary */}
          <section className="border border-at-border bg-at-surface">
            <div className="grid grid-cols-2 sm:grid-cols-3">
              <div className="p-4">
                <p className="text-xs tracking-zero text-at-muted uppercase">Events</p>
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
                    ? "—"
                    : formatDuration(weekSummary.avg_abs_delay_sec)
                }
                breakdown={weekPunctuality}
              />
              <PunctualityStat
                bare
                variant="split"
                label="On-time (%)"
                value={weekSummary?.on_time_pct?.toFixed(1) ?? "—"}
                breakdown={weekPunctuality}
              />
            </div>
          </section>

          <RouteWeekSummary days={weekDays} mode={routeMode} label={weekPeriodLabel} />

          {/* Map and diagram with neutral stop coloring in week mode */}
          <RouteMapDiagram
            stops={weekMapStops}
            routeLines={mapLines}
            routeId={slug}
            mode={routeMode}
          />
          <Suspense
            fallback={
              <div className="h-64 animate-pulse rounded bg-at-border motion-reduce:animate-none" />
            }
          >
            <RouteDiagramSection
              alertsPromise={alertsPromise}
              slug={slug}
              rawToCanon={view.rawToCanon}
              directions={view.directions}
              delayByStop={{}}
              nameByStop={nameByStop}
              mode={routeMode}
            />
          </Suspense>
        </>
      ) : (
        <>
          {/* Day stats summary */}
          <section className="border border-at-border bg-at-surface">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <div className="p-4">
                <p className="text-xs tracking-zero text-at-muted uppercase">Events</p>
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
                    ? "—"
                    : formatDuration(summary.avg_abs_delay_sec)
                }
                breakdown={punctuality}
              />
              <PunctualityStat
                bare
                variant="split"
                label="On-time (%)"
                value={summary?.on_time_pct?.toFixed(1) ?? "—"}
                breakdown={punctuality}
              />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Suspense
              fallback={
                <div className="h-96 animate-pulse rounded bg-at-border motion-reduce:animate-none" />
              }
            >
              <RouteTripBoardSection
                vehiclesPromise={vehiclesPromise}
                routeId={slug}
                rows={pageRows}
                sort={tripSort}
                isReversed={isReversed}
                mode={routeMode}
                basePath={`/route/${encodeURIComponent(slug)}`}
                preservedParams={tripPreserved}
                page={tripPage}
                totalPages={totalPages}
              />
            </Suspense>
            {tripsCapped && (
              <p className="text-xs text-at-muted lg:col-span-2">
                Showing the first {TRIPS_FETCH_CAP} runs of the day.
              </p>
            )}
            <RouteMapDiagram
              stops={mapStops}
              routeLines={mapLines}
              routeId={slug}
              mode={routeMode}
              filterDirectionIds={
                activeDir == null
                  ? undefined
                  : [
                      activeDir,
                      ...[...view.directionIdAliases.entries()]
                        .filter(([, primary]) => primary === activeDir)
                        .map(([alias]) => alias),
                    ]
              }
            />
          </div>

          <Suspense
            fallback={
              <div className="h-64 animate-pulse rounded bg-at-border motion-reduce:animate-none" />
            }
          >
            <RouteDiagramSection
              alertsPromise={alertsPromise}
              slug={slug}
              rawToCanon={view.rawToCanon}
              directions={diagramDirections}
              delayByStop={delayByStop}
              nameByStop={nameByStop}
              mode={routeMode}
            />
          </Suspense>

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
                      <th className="px-3 py-2 text-right">Events</th>
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
                          <a
                            href={`/stop/${encodeURIComponent(s.stop_id)}${linkDay ? `?day=${linkDay}` : ""}`}
                            className="font-semibold text-at-shore hover:underline"
                          >
                            {s.name}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.events}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s.avg_delay_sec == null
                            ? "—"
                            : formatDelay(s.avg_delay_sec, { mode: routeMode })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
 * @returns The alert banner.
 */
async function RouteAlertBannerSection({
  alertsPromise,
  slug,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  slug: string;
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
  return <AlertBanner alerts={routeAlerts} heading="Service alerts" routeNames={routeNames} />;
}

/**
 * Streamed line diagram: awaits the shared alerts feed off the critical path to
 * derive the alerted-stop highlights and detour flag, then renders the diagram
 * with everything else passed straight through.
 * @param root0 - Props (the diagram's own props plus the alert inputs).
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @param root0.slug - This route's slug, to filter the alerts.
 * @param root0.rawToCanon - Maps raw stop ids to their station-canonical ids.
 * @returns The route line diagram.
 */
async function RouteDiagramSection({
  alertsPromise,
  slug,
  rawToCanon,
  ...diagram
}: Omit<ComponentProps<typeof RouteLineDiagramClient>, "alertStopIds" | "hasDetour"> & {
  alertsPromise: Promise<ServiceAlert[]>;
  slug: string;
  rawToCanon: Map<string, string>;
}): Promise<JSX.Element> {
  const routeAlerts = alertsForRoute(await alertsPromise, [slug]);
  const hasDetour = routeAlerts.some((a) => a.effect === "DETOUR");
  const alertStopIds = routeAlerts.flatMap((a) =>
    a.informed_entity.filter((e) => e.stop_id).map((e) => rawToCanon.get(e.stop_id!) ?? e.stop_id!),
  );
  return <RouteLineDiagramClient {...diagram} alertStopIds={alertStopIds} hasDetour={hasDetour} />;
}

/**
 * Streamed worst-trips board: awaits the shared live-vehicles feed off the
 * critical path to flag the running trips, then renders the board with
 * everything else passed straight through.
 * @param root0 - Props (the board's own props plus the live-vehicles input).
 * @param root0.vehiclesPromise - The in-flight network-wide live-vehicles fetch.
 * @returns The worst-trips board.
 */
async function RouteTripBoardSection({
  vehiclesPromise,
  ...board
}: Omit<ComponentProps<typeof WorstTripsBoard>, "liveTripIds"> & {
  vehiclesPromise: Promise<LiveVehicle[]>;
}): Promise<JSX.Element> {
  const liveVehicles = await vehiclesPromise;
  const liveTripIds = new Set(
    liveVehicles
      .filter((v) => routeSlug(v.routeId) === board.routeId && v.tripId !== null)
      .map((v) => v.tripId as string),
  );
  return <WorstTripsBoard {...board} liveTripIds={liveTripIds} />;
}
