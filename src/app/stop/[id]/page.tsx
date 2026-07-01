// src/app/stop/[id]/page.tsx
/**
 * @description Stop detail page showing a single stop's punctuality, worst routes,
 * and map location for a service day. Day-focused like the route page: it falls
 * back to the most recent populated day when the requested one has too few
 * events, and the net-average wording stays mode-less because a stop mixes modes
 * (no single on-time window). The service-alerts fetch is kicked off without
 * awaiting and streamed in through Suspense so a cold alerts cache doesn't gate
 * the page; station-prefixed ids skip the per-stop departures query.
 */
import { AlertBanner } from "@/components/AlertBanner";
import { DayNav } from "@/components/DayNav";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RankBoard } from "@/components/RankBoard";
import StopMapWrapper from "@/components/StopMapWrapper";
import { StopSchedule } from "@/components/StopSchedule";
import { alertsForStop, getServiceAlerts, type ServiceAlert } from "@/lib/at-alerts";
import { getStopTrips } from "@/lib/at-stop-trips";
import { getEarliestDataDay, getStopStats } from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { nzServiceDayRange, nzServiceDayString, shiftWeek, type DateRange } from "@/lib/time";
import { notFound } from "next/navigation";
import { Suspense, type JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 300; // 5 minutes

/** Query params for the stop detail page. */
interface StopSearchParams {
  day?: string;
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
  const id = decodeURIComponent((await params).id);
  const sp = (await searchParams) ?? {};
  dropTodayParam(`/stop/${encodeURIComponent(id)}`, sp);

  const requestedDay = resolveRequestedDay(sp.day);
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  // Start the service-alerts fetch off the critical path: the banner streams in
  // via Suspense so a cold alerts cache (or dev reload) doesn't gate the page.
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
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? `/stop/${encodeURIComponent(id)}`
      : undefined;
  // Today's links stay clean (no ?day) so they don't bounce through the redirect.
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;

  const { stop, summary, routes, routes_count } = stats;
  const todaysTrips = id.startsWith("station:") ? [] : await getStopTrips(id, serviceDate);
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
          hasNext={hasNextDay}
          nextHref={nextDayHref}
        />
      </header>

      <Suspense fallback={null}>
        <StopAlertBanner alertsPromise={alertsPromise} stopId={stop.stop_id} />
      </Suspense>

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
        routeDay={linkDay}
      />

      <StopSchedule departures={todaysTrips} routeNames={routeNameMap} serviceDate={serviceDate} />
    </main>
  );
}

/**
 * Streamed "Service alerts" banner for the stop. Awaits the shared alerts feed
 * off the critical path and keeps the alerts informing this stop; renders
 * nothing while it streams (and when there are none).
 * @param root0 - Props.
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @param root0.stopId - Canonical stop id, to filter the alerts.
 * @returns The alert banner.
 */
async function StopAlertBanner({
  alertsPromise,
  stopId,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
  stopId: string;
}): Promise<JSX.Element> {
  return (
    <AlertBanner alerts={alertsForStop(await alertsPromise, stopId)} heading="Service alerts" />
  );
}
