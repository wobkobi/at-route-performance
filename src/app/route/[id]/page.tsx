// src/app/route/[id]/page.tsx
import { AlertBanner } from "@/components/AlertBanner";
import { DayNav } from "@/components/DayNav";
import { DirectionChips } from "@/components/DirectionChips";
import { ModeIcon } from "@/components/ModeIcon";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RouteLineDiagramClient } from "@/components/RouteLineDiagramClient";
import { RouteMapDiagram } from "@/components/RouteMapDiagram";
import { RouteWeekSummary } from "@/components/RouteWeekSummary";
import { WorstTripsBoard } from "@/components/WorstTripsBoard";
import { alertsForRoute, getServiceAlerts } from "@/lib/at-alerts";
import {
  findCanonicalRouteSlug,
  getEarliestDataDay,
  getMostRecentDataDay,
  getRouteDailyStats,
  getRouteNames,
  getRouteStats,
  getWorstTripsOfDay,
  type TripSort,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDelay, formatDuration } from "@/lib/format";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import { buildRouteView } from "@/lib/route-view";
import {
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  type DateRange,
} from "@/lib/time";
import { routeStatsQuery } from "@/lib/validate";
import { getLiveVehicles } from "@/lib/vehicles";
import type { RouteDay, RouteVariant } from "@/types/api";
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

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
  const busiest = variants.reduce((a, b) => (b.tripCount > a.tripCount ? b : a), variants[0]);
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
 * Shift a `YYYY-MM-DD` date string by `days` calendar days (UTC arithmetic).
 * @param ymd - Source date.
 * @param days - Days to add (negative steps back).
 * @returns The shifted `YYYY-MM-DD`.
 */
function shiftWeek(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Auckland-local day/month and year parts of a UTC instant.
 * @param d - UTC instant.
 * @returns `{ dm: "DD/MM", y: "YYYY" }`.
 */
function dmY(d: Date): { dm: string; y: string } {
  const o: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d)) {
    o[part.type] = part.value;
  }
  return { dm: `${o.day}/${o.month}`, y: o.year };
}

/**
 * Week label as `DD/MM to DD/MM`, adding the year on both sides only when the
 * week straddles New Year.
 * @param range - Half-open week range (`end` is the exclusive next Monday).
 * @returns The range label.
 */
function weekRangeLabel(range: DateRange): string {
  const first = dmY(range.start);
  const last = dmY(new Date(range.end.getTime() - 86_400_000));
  return first.y === last.y
    ? `${first.dm} to ${last.dm}`
    : `${first.dm}/${first.y} to ${last.dm}/${last.y}`;
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
  const chevronClass = "block h-4 w-4";
  const btnClass = "chip chip-off flex items-center";
  return (
    <div className="flex items-center gap-1">
      {prevHref ? (
        <a href={prevHref} aria-label="Previous week" className={btnClass}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={chevronClass}>
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      ) : null}
      <span className="px-1 text-sm font-semibold tabular-nums">{label}</span>
      {nextHref ? (
        <a href={nextHref} aria-label="Next week" className={btnClass}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={chevronClass}>
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      ) : null}
    </div>
  );
}

/**
 * Day / Week toggle: two links rendered as a segmented control.
 * @param props - Component props.
 * @param props.slug - Route slug (for hrefs).
 * @param props.isWeekView - Whether the week segment is active.
 * @returns The segmented control element.
 */
function ViewToggle({ slug, isWeekView }: { slug: string; isWeekView: boolean }): JSX.Element {
  const base = `/route/${encodeURIComponent(slug)}`;
  /**
   * Render one segment link.
   * @param label - Display text.
   * @param href - Link target.
   * @param active - Whether this segment is selected.
   * @returns The segment anchor element.
   */
  const seg = (label: string, href: string, active: boolean): JSX.Element => (
    <a
      href={href}
      className={`px-3 py-1.5 text-sm leading-none${active ? "bg-at-ink font-semibold text-at-surface" : "text-at-muted hover:bg-at-bg"}`}
    >
      {label}
    </a>
  );
  return (
    <div className="flex overflow-hidden rounded-lg border border-at-border">
      {seg("Day", base, !isWeekView)}
      <span className="border-l border-at-border" />
      {seg("Week", `${base}?window=week`, isWeekView)}
    </div>
  );
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

  // Case-insensitive lookup: /route/nx1 -> /route/NX1; unknown slug -> 404.
  const canonSlug = await findCanonicalRouteSlug(slug);
  if (canonSlug === null) notFound();
  if (canonSlug !== slug) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null)).toString();
    redirect(`/route/${encodeURIComponent(canonSlug)}${qs ? `?${qs}` : ""}`);
  }

  dropTodayParam(`/route/${encodeURIComponent(slug)}`, sp);
  const parsed = routeStatsQuery.safeParse(sp);
  const thresholdSec = (parsed.success ? parsed.data : routeStatsQuery.parse({})).thresholdSec;
  const tripSort = (TRIP_SORTS as readonly string[]).includes(sp.tsort ?? "")
    ? (sp.tsort as TripSort)
    : "off";

  // Service day from ?day (or the current one). In week view the day stats are
  // not displayed but we still need route metadata from getRouteStats.
  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  let stats = await getRouteStats({
    routeId: slug,
    from: range.start,
    to: range.end,
    thresholdSec,
  });
  // Day view: fall back to the most recent day with data when today is empty.
  if (!isWeekView && !requestedDay && (stats.summary?.events ?? 0) === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      stats = await getRouteStats({
        routeId: slug,
        from: range.start,
        to: range.end,
        thresholdSec,
      });
    }
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
  const periodParam =
    isWeekView && sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : null;
  const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
  const weekPeriodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";

  // Week view skips the expensive trips query and live vehicles fetch.
  const [trips, view, earliestDay, allAlerts, liveVehicles, weekDays] = await Promise.all([
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
    getServiceAlerts(),
    isWeekView
      ? Promise.resolve([] as Awaited<ReturnType<typeof getLiveVehicles>>)
      : getLiveVehicles().catch(() => []),
    // Rolling default uses take:7 (most recent records); fixed period uses a date range.
    getRouteDailyStats(slug, fixedWeekRange?.start, fixedWeekRange?.end),
  ]);

  // Week stepper navigation - computed after earliestDay is available.
  let weekPrevHref: string | null = null;
  let weekNextHref: string | null = null;
  if (isWeekView) {
    const thisWeekStart = nzWeekStart(new Date());
    const prevWeek = shiftWeek(periodParam ?? thisWeekStart, -7);
    const earliestWeekStart = earliestDay ? nzWeekStart(earliestDay) : null;
    if (!earliestWeekStart || prevWeek >= earliestWeekStart) {
      weekPrevHref = `/route/${encodeURIComponent(slug)}?window=week&period=${prevWeek}`;
    }
    if (periodParam) {
      const nextWeek = shiftWeek(periodParam, 7);
      weekNextHref =
        nextWeek >= thisWeekStart
          ? `/route/${encodeURIComponent(slug)}?window=week`
          : `/route/${encodeURIComponent(slug)}?window=week&period=${nextWeek}`;
    }
  }

  const routeAlerts = alertsForRoute(allAlerts, [slug]);
  const hasDetour = routeAlerts.some((a) => a.effect === "DETOUR");
  const alertRouteIds = [
    ...new Set(
      routeAlerts.flatMap((a) =>
        a.informed_entity.map((e) => e.route_id).filter((id): id is string => !!id),
      ),
    ),
  ];
  const routeNames = await getRouteNames(alertRouteIds);

  const liveTripIds = new Set(
    liveVehicles
      .filter((v) => routeSlug(v.routeId) === slug && v.tripId !== null)
      .map((v) => v.tripId as string),
  );
  const alertedStopIds = routeAlerts.flatMap((a) =>
    a.informed_entity
      .filter((e) => e.stop_id)
      .map((e) => view.rawToCanon.get(e.stop_id!) ?? e.stop_id!),
  );

  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;
  const delayByStop = Object.fromEntries(byStop.map((s) => [s.stop_id, s.avg_delay_sec]));
  const nameByStop = Object.fromEntries(view.nameByStop);

  const dirKeys = Object.keys(view.directions)
    .map(Number)
    .sort((a, b) => a - b);
  const activeDir =
    sp.dir != null && /^\d+$/.test(sp.dir) && view.directions[Number(sp.dir)]
      ? Number(sp.dir)
      : null;
  const mapLines = (
    activeDir == null ? view.routeLines : view.routeLines.filter((l) => l.directionId === activeDir)
  ).map((l) => l.points);
  const dirStopIds =
    activeDir == null
      ? null
      : new Set(view.directions[activeDir].variants.flatMap((v) => v.stopIds));
  const mapStops =
    dirStopIds == null ? view.stops : view.stops.filter((s) => dirStopIds.has(s.stop_id));
  const diagramDirections =
    activeDir == null ? view.directions : { [activeDir]: view.directions[activeDir] };

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
    activeDir == null
      ? null
      : new Set(
          view.directions[activeDir].variants
            .map((v) => v.headsign)
            .filter((h): h is string => h != null),
        );
  const dirFirstStops =
    activeDir == null
      ? null
      : new Set(
          view.directions[activeDir].variants
            .map((v) => v.stopIds[0])
            .filter((s): s is string => s != null),
        );

  const dirTrips =
    activeDir == null
      ? trips
      : trips.filter((t) => {
          if (t.direction_id != null)
            return (view.directionIdAliases.get(t.direction_id) ?? t.direction_id) === activeDir;
          if (t.headsign != null && dirHeadsigns) return dirHeadsigns.has(t.headsign);
          if (t.first_stop_id != null && dirFirstStops) {
            const matchesActive = dirFirstStops.has(t.first_stop_id);
            const matchesAny = dirKeys.some((d) =>
              view.directions[d].variants.some((v) => v.stopIds[0] === t.first_stop_id),
            );
            if (matchesAny) return matchesActive;
          }
          return true;
        });

  const totalTrips = dirTrips.length;
  const totalPages = Math.max(1, Math.ceil(totalTrips / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.tpage ?? "1", 10);
  const tripPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );
  const pageTrips = dirTrips.slice((tripPage - 1) * PAGE_SIZE, tripPage * PAGE_SIZE);

  const tripPreserved: Record<string, string> = {};
  if (requestedDay) tripPreserved.day = requestedDay;
  if (sp.thresholdSec) tripPreserved.thresholdSec = sp.thresholdSec;
  if (activeDir != null) tripPreserved.dir = String(activeDir);

  const title = route?.shortName ?? slug;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
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
          {route?.longName && route.longName !== title && (
            <p className="mt-0.5 text-sm text-at-muted">{route.longName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle slug={slug} isWeekView={isWeekView} />
          {isWeekView ? (
            <RouteWeekNav label={weekPeriodLabel} prevHref={weekPrevHref} nextHref={weekNextHref} />
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
            />
          )}
        </div>
      </header>

      <AlertBanner alerts={routeAlerts} heading="Service alerts" routeNames={routeNames} />

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
          <RouteLineDiagramClient
            directions={view.directions}
            delayByStop={{}}
            nameByStop={nameByStop}
            mode={routeMode}
            alertStopIds={alertedStopIds}
            hasDetour={hasDetour}
          />
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
            <WorstTripsBoard
              routeId={slug}
              trips={pageTrips}
              sort={tripSort}
              mode={routeMode}
              basePath={`/route/${encodeURIComponent(slug)}`}
              preservedParams={tripPreserved}
              page={tripPage}
              totalPages={totalPages}
              pageSize={PAGE_SIZE}
              liveTripIds={liveTripIds}
            />
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

          {dirKeys.length > 1 && (
            <DirectionChips
              dirKeys={dirKeys}
              activeDir={activeDir}
              labels={Object.fromEntries(
                dirKeys.map((d) => [d, directionLabel(view.directions[d].variants, d)]),
              )}
              hrefs={{
                both: routeDirHref(slug, dirBase, null),
                ...Object.fromEntries(
                  dirKeys.map((d) => [String(d), routeDirHref(slug, dirBase, d)]),
                ),
              }}
            />
          )}

          <RouteLineDiagramClient
            directions={diagramDirections}
            delayByStop={delayByStop}
            nameByStop={nameByStop}
            mode={routeMode}
            alertStopIds={alertedStopIds}
            hasDetour={hasDetour}
          />

          {byStop.length > 0 && (
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
