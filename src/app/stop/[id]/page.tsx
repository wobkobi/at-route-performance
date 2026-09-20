// src/app/stop/[id]/page.tsx
// Stop detail page showing a single stop's punctuality, worst routes,
// and map location for a service day. Day-focused like the route page: it falls
// back to the most recent populated day when the requested one has too few
// events, and the net-average wording stays mode-less because a stop mixes modes
// (no single on-time window). A station page stands for several GTFS stops, so
// its alerts and departures are resolved across every platform behind it - AT
// keys both to raw stop ids, and matching the station's own id hit nothing.

import { AlertBanner } from "@/components/AlertBanner";
import { DayNav } from "@/components/DayNav";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RankBoard } from "@/components/RankBoard";
import { StopScheduleSkeleton } from "@/components/SkeletonParts";
import StopMapWrapper from "@/components/StopMapWrapper";
import { StopSchedule } from "@/components/StopSchedule";
import { alertsForStop, getServiceAlerts, type ServiceAlert } from "@/lib/at-alerts";
import { getStopTrips } from "@/lib/at-stop-trips";
import { findCurrentStationId, getEarliestDataDay, getStopStats } from "@/lib/data";
import { DATA_START_DAY } from "@/lib/data-start";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import { hasEarlierDay, routeLinkQuery } from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { nzServiceDayRange, nzServiceDayString, shiftWeek, type DateRange } from "@/lib/time";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense, type JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 300; // 5 minutes

/** Query params for the stop detail page. */
interface StopSearchParams {
  day?: string;
}

/**
 * Per-stop page title, so a tab and a shared link name the stop rather than
 * repeating the site title.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic params `{ id }`.
 * @returns Title and description metadata for the stop.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const raw = (await params).id;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  const range = nzServiceDayRange(new Date());
  const stats = await getStopStats(id, range, THRESHOLD_SEC, REVALIDATE).catch(() => null);
  const name = stats?.stop.name;
  if (!name) return { title: "Stop" };
  return {
    title: name,
    description: `On-time performance at ${name} against Auckland Transport's published schedule.`,
  };
}

/**
 * Stop detail page: how a single stop performed across every route on a service
 * day - overall punctuality, the worst routes calling there, and the stop's spot
 * on the map. Day-focused like the route page, falling back to the most recent
 * day with data.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic params `{ id }`.
 * @param root0.searchParams - Optional query params (`day`).
 * @returns Page markup.
 */
export default async function StopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<StopSearchParams>;
}): Promise<JSX.Element> {
  // Decode the segment when it decodes cleanly; a raw "%" in a hand-typed URL
  // would otherwise throw URIError and 500 the page.
  const rawId = (await params).id;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  const sp = (await searchParams) ?? {};

  // Stations used to be keyed by name ("station:newmarket train station"); they
  // are keyed by AT's parent_station now so a rename can't fork them. Send the
  // old form to the current one rather than 404ing a shared link.
  const currentStationId = await findCurrentStationId(id);
  if (currentStationId) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null)).toString();
    redirect(`/stop/${encodeURIComponent(currentStationId)}${qs ? `?${qs}` : ""}`);
  }

  clampDayParam(`/stop/${encodeURIComponent(id)}`, sp);
  dropTodayParam(`/stop/${encodeURIComponent(id)}`, sp);

  const requestedDay = resolveRequestedDay(sp.day);
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  // Start the alerts fetch early so it overlaps the stats query. The banner is
  // awaited rather than streamed: it sits above the page's content, and letting
  // it pop in afterwards shoved everything below it down as the reader arrived.
  const alertsPromise = getServiceAlerts();
  // getEarliestDataDay is independent of the stop query - fire both immediately.
  const [initialStats, earliestDay] = await Promise.all([
    getStopStats(id, range, THRESHOLD_SEC, REVALIDATE),
    getEarliestDataDay(1),
  ]);
  let stats = initialStats;
  if (!stats) notFound();
  // Fall back to the most recent populated day only when no day was requested.
  const fallbackDay = await maybeFallbackDay(
    requestedDay,
    (stats.summary?.events ?? 0) === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallbackDay) {
    range = nzServiceDayRange(fallbackDay);
    serviceDate = nzServiceDayString(range.start);
    const refreshed = await getStopStats(id, range, THRESHOLD_SEC, REVALIDATE);
    if (refreshed) stats = refreshed;
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = hasEarlierDay(serviceDate, earliestDay);
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? `/stop/${encodeURIComponent(id)}`
      : undefined;
  // Today's links stay clean (no ?day) so they don't bounce through the redirect.
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;

  const { stop, summary, routes, routes_count } = stats;
  const routeNameMap = new Map(routes.map((r) => [r.route_id, r.short_name ?? null]));
  // Net-average wording stays mode-less: a stop mixes modes, so no single window.
  const punctuality: PunctualityBreakdown = {
    on_time_pct: summary?.on_time_pct ?? null,
    early_pct: summary?.early_pct ?? null,
    late_pct: summary?.late_pct ?? null,
    avg_delay_sec: summary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-zero text-at-muted uppercase">Stop</p>
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">{stop.name}</h1>
        </div>
        <DayNav
          basePath={`/stop/${encodeURIComponent(id)}`}
          serviceDate={serviceDate}
          preservedParams={{}}
          hasPrev={hasPrevDay}
          atFloor={serviceDate === DATA_START_DAY}
          hasNext={hasNextDay}
          nextHref={nextDayHref}
        />
      </header>

      <StopAlertBanner
        alertsPromise={alertsPromise}
        stopIds={stats.platform_ids}
        pastWindow={linkDay !== undefined}
      />

      <section className="border border-at-border bg-at-surface">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <div className="p-4">
            <p className="text-xs tracking-zero text-at-muted uppercase">Events</p>
            <p className="text-2xl font-ultra tracking-zero tabular-nums">{summary?.events ?? 0}</p>
          </div>
          <div className="p-4">
            <p className="text-xs tracking-zero text-at-muted uppercase">Routes</p>
            <p className="text-2xl font-ultra tracking-zero tabular-nums">{routes_count}</p>
          </div>
          <PunctualityStat
            bare
            variant="average"
            label="Avg off by"
            value={
              summary?.avg_abs_delay_sec == null ? "—" : formatDuration(summary.avg_abs_delay_sec)
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

      <section className="border border-at-border bg-at-surface p-4">
        <h2 className="mb-2 text-lg font-ultra tracking-zero">Where it is</h2>
        <StopMapWrapper
          stops={[
            {
              stop_id: stop.stop_id,
              name: stop.name,
              lat: stop.lat,
              lon: stop.lon,
              avg_delay_sec: summary?.avg_delay_sec ?? null,
              on_time_pct: summary?.on_time_pct ?? null,
              avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
            },
          ]}
          selectedStopId={stop.stop_id}
          className="h-100"
        />
      </section>

      <RankBoard
        title="Worst routes here"
        accentClass="text-at-ink"
        rows={routes}
        metric="delay"
        routeQuery={routeLinkQuery("day", linkDay, null)}
      />

      <Suspense fallback={<StopScheduleSkeleton />}>
        <StopScheduleSection
          stopIds={stats.platform_ids}
          serviceDate={serviceDate}
          routeNames={routeNameMap}
        />
      </Suspense>
    </main>
  );
}

/**
 * Streamed departures board. Awaits the external AT stop-trips calls off the
 * critical path so the stop shell and stats render without waiting on them.
 *
 * A station is several GTFS stops, and AT's schedule endpoint only knows the raw
 * platform ids - so each platform is fetched and the results merged, rather than
 * the station showing an empty board. A trip calling at two platforms of the
 * same station is deduped on its trip id.
 * @param root0 - Props.
 * @param root0.stopIds - Raw GTFS stop ids behind the page (a station's platforms).
 * @param root0.serviceDate - The resolved service date being shown.
 * @param root0.routeNames - Route id to short-name map for the rows.
 * @returns The departures board.
 */
async function StopScheduleSection({
  stopIds,
  serviceDate,
  routeNames,
}: {
  stopIds: string[];
  serviceDate: string;
  routeNames: Map<string, string | null>;
}): Promise<JSX.Element> {
  const perStop = await Promise.all(
    // One bad platform must not empty the whole board.
    stopIds.map((sid) => getStopTrips(sid, serviceDate).catch(() => [])),
  );
  const byTrip = new Map<string, (typeof perStop)[number][number]>();
  for (const d of perStop.flat()) if (!byTrip.has(d.tripId)) byTrip.set(d.tripId, d);
  const departures = [...byTrip.values()].sort((a, b) => {
    if (!a.departureTime) return 1;
    if (!b.departureTime) return -1;
    return a.departureTime < b.departureTime ? -1 : a.departureTime > b.departureTime ? 1 : 0;
  });
  return <StopSchedule departures={departures} routeNames={routeNames} serviceDate={serviceDate} />;
}

/**
 * "Service alerts" banner for the stop, keeping the alerts that inform any of
 * its platforms. Renders nothing when there are none.
 * @param root0 - Props.
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @param root0.stopIds - Raw GTFS stop ids behind the page (a station's platforms).
 * @param root0.pastWindow - Whether the page is showing a past service day.
 * @returns The alert banner.
 */
async function StopAlertBanner({
  alertsPromise,
  stopIds,
  pastWindow,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  stopIds: string[];
  pastWindow: boolean;
}): Promise<JSX.Element> {
  return (
    <AlertBanner
      alerts={alertsForStop(await alertsPromise, stopIds)}
      heading="Service alerts"
      pastWindow={pastWindow}
    />
  );
}
