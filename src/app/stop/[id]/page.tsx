// src/app/stop/[id]/page.tsx
// Stop detail page showing a single stop's punctuality, worst routes,
// and map location for a service day. Day-focused like the route page: it opens
// on the same day as every other day page (see resolveShownDay), and the
// net-average wording stays mode-less because a stop mixes modes
// (no single on-time window). A station page stands for several GTFS stops, so
// its alerts are resolved across every platform behind it: AT keys those to raw
// stop ids, and matching the station's own id hit nothing. Its departures are
// the other way round - AT's schedule answers the parent id for every platform
// at once, so the board asks once.

import { AlertBanner } from "@/components/AlertBanner";
import { DayNav } from "@/components/DayNav";
import { ChevronLeft } from "@/components/icons";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RankBoard } from "@/components/RankBoard";
import { StopScheduleSkeleton } from "@/components/SkeletonParts";
import StopMapWrapper from "@/components/StopMapWrapper";
import { StopSchedule } from "@/components/StopSchedule";
import { alertsForStop, getServiceAlerts, type ServiceAlert } from "@/lib/at-alerts";
import { getStopDepartures } from "@/lib/at-stop-trips";
import { cn } from "@/lib/cn";
import { MEASURED_AGAINST, ON_TIME_CAPTION } from "@/lib/copy";
import {
  findCurrentStationId,
  getEarliestDataDay,
  getStationSiblings,
  getStopStats,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { readFallback } from "@/lib/db";
import {
  formatDuration,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { cardMetadata, cardPath, cardWhenSuffix, parseStopCard } from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import { dayRangeNav, routeLinkQuery } from "@/lib/range-page";
import {
  MIN_PLATFORM_EVENTS,
  platformNoun,
  platformsDiffer,
  type PlatformRow,
} from "@/lib/station-platforms";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment, Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 300; // 5 minutes

/** Query params for the stop detail page. */
interface StopSearchParams {
  day?: string;
}

/**
 * Per-stop page title, so a tab and a shared link name the stop rather than
 * repeating the site title. The shared link's card and title name the day the
 * link carries. The name comes from the same stats read as the page's, on the
 * same shown day, so the two share one cached query.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic params `{ id }`.
 * @param root0.searchParams - Optional query params (`day`).
 * @returns Title, description and card metadata for the stop.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<StopSearchParams>;
}): Promise<Metadata> {
  const raw = (await params).id;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  const sp = (await searchParams) ?? {};
  const { range } = await resolveShownDay(resolveRequestedDay(sp.day));
  const stats = await getStopStats(id, range, THRESHOLD_SEC, REVALIDATE).catch(
    readFallback("stop-stats", null),
  );
  const name = stats?.stop.name;
  if (!name) return { title: "Stop" };
  const card = parseStopCard(id, sp);
  const description = `On-time performance at ${name} ${MEASURED_AGAINST}`;
  return {
    title: name,
    description,
    ...cardMetadata(`${name}${cardWhenSuffix(card)}`, description, cardPath(card)),
  };
}

/**
 * Stop detail page: how a single stop performed across every route on a service
 * day - overall punctuality, the worst routes calling there, and the stop's spot
 * on the map. Day-focused like the route page, opening on the day every other
 * day page opens on.
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

  // Start the alerts fetch early so it overlaps the stats query. The banner is
  // awaited rather than streamed: it sits above the page's content, and letting
  // it pop in afterwards shoved everything below it down as the reader arrived.
  const alertsPromise = getServiceAlerts();
  // getEarliestDataDay and the sibling lookup are both independent of the day
  // and of the stop query.
  const [shown, earliestDay, siblings] = await Promise.all([
    resolveShownDay(resolveRequestedDay(sp.day)),
    getEarliestDataDay(1),
    getStationSiblings(id),
  ]);
  const { range, serviceDate } = shown;
  const stats = await getStopStats(id, range, THRESHOLD_SEC, REVALIDATE);
  if (!stats) notFound();

  const nav = dayRangeNav(shown, earliestDay);
  // Today's links stay clean (no ?day) so they don't bounce through the redirect.
  const linkDay = nav.isToday ? undefined : serviceDate;

  const { stop, summary, routes, routes_count } = stats;
  const routeNameMap = new Map(routes.map((r) => [r.route_id, r.short_name ?? null]));
  // Net-average wording stays mode-less: a stop mixes modes, so no single window.
  const punctuality: PunctualityBreakdown = {
    on_time_pct: summary?.on_time_pct ?? null,
    early_pct: summary?.early_pct ?? null,
    late_pct: summary?.late_pct ?? null,
    avg_delay_sec: summary?.avg_delay_sec ?? null,
    avg_abs_delay_sec: summary?.avg_abs_delay_sec ?? null,
    // No stop figure anywhere on the site takes the cancellation penalty: it is
    // counted per route per service day, and there is no defensible way to
    // charge one stop its share. A stop served by a route that cancelled half
    // its trips therefore reads healthy, and the footnote now says so.
    cancellations: "excluded",
  };

  return (
    <main className="space-y-6">
      {/* The worst-stops board is the only page on the site that lists stops, so
          it is the one way up from here. Without it a reader who arrived from a
          shame board or a route's stop table had the top bar and nothing else, and
          the top bar has no stops in it. Not "back to": a reader may equally have
          come from a route page or a shared link. */}
      <Link
        href={buildHref("/shame/stop", { day: linkDay })}
        className="inline-flex items-center gap-1 text-sm text-at-shore hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        The worst stops {nav.isToday ? "today" : "that day"}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-zero text-at-muted uppercase">Stop</p>
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">{stop.name}</h1>
          {/* AT models an interchange as two or more parent stations and this page
              stands for one of them, so without these links a reader at Manukau's
              bus station has no way to its trains. The names are AT's own, which
              is why a link is only offered when it reads differently from the
              title above it (see siblingsByStation). */}
          {siblings && (
            <p className="mt-1 text-sm text-at-muted">
              Also at {siblings.place}:{" "}
              {siblings.siblings.map((s, i) => (
                <Fragment key={s.id}>
                  {i > 0 && ", "}
                  <Link
                    href={buildHref(`/stop/${encodeURIComponent(s.id)}`, { day: linkDay })}
                    className="text-at-shore hover:underline"
                  >
                    {s.name}
                  </Link>
                </Fragment>
              ))}
            </p>
          )}
        </div>
        <DayNav
          basePath={`/stop/${encodeURIComponent(id)}`}
          serviceDate={serviceDate}
          preservedParams={{}}
          hasPrev={nav.hasPrev}
          atFloor={nav.atFloor}
          hasNext={nav.hasNext}
          nextHref={nav.nextIsToday ? `/stop/${encodeURIComponent(id)}` : undefined}
          nextPending={nav.nextPending}
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
            <p className="text-xs tracking-zero text-at-muted uppercase">Arrivals</p>
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
            value={summary?.on_time_pct?.toFixed(1) ?? UNKNOWN_VALUE}
            breakdown={punctuality}
          />
        </div>
        {/* "Arrivals 0" is a fact and the dashes beside it are an admission of
            ignorance, so side by side they describe one absence two ways and a
            reader cannot tell a quiet day from a missing one. The aggregation
            returns no summary row only when nothing matched, so this names which
            it is rather than leaving the strip to be read either way. */}
        {summary === null && (
          <p className="border-t border-at-border px-4 py-3 text-sm text-at-muted">
            No arrivals were recorded at this stop on this day, so there is nothing to average.
          </p>
        )}
      </section>

      {/* Empty unless the platforms earn the space - the gate is in
          platformBreakdown. It sits straight under the strip because what it
          says is about the strip: the single figure above covers platforms that
          did not agree. */}
      {stats.platforms.length > 0 && <PlatformTable stopName={stop.name} rows={stats.platforms} />}

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
        caption={ON_TIME_CAPTION}
        routeQuery={routeLinkQuery("day", linkDay, null)}
      />

      <Suspense fallback={<StopScheduleSkeleton />}>
        <StopScheduleSection
          scheduleStopId={stats.schedule_stop_id}
          serviceDate={serviceDate}
          routeNames={routeNameMap}
        />
      </Suspense>
    </main>
  );
}

/**
 * Per-platform figures for a grouped station, rendered only for the platforms
 * platformBreakdown has already decided are worth listing and in the order it
 * put them.
 * @param root0 - Props.
 * @param root0.stopName - The station's name, for the sentence above the table.
 * @param root0.rows - The platforms to list.
 * @returns The section.
 */
function PlatformTable({ stopName, rows }: { stopName: string; rows: PlatformRow[] }): JSX.Element {
  const noun = platformNoun(rows);
  // Two different facts get a station here, so the sentence names the one that
  // applies: platforms that ran differently, or platforms that agree and differ
  // only in which routes leave from them.
  const differ = platformsDiffer(rows);
  return (
    <section className="border border-at-border bg-at-surface">
      <div className="px-4 py-3">
        <h2 className="font-semibold">By {noun}</h2>
        {/* One template string rather than several expressions, so the sentence
            is a single text node: React separates adjacent ones with a comment
            marker, which reads as a stray space to anything parsing the page. */}
        <p className="mt-1 text-sm text-at-muted">
          {`${stopName} is several ${noun}s ${
            differ
              ? "and they did not all run the same way, so the figures above average them together."
              : "and some of its routes leave from one of them only."
          }`}
        </p>
      </div>
      <div className="overflow-x-auto px-4 pb-4">
        <table className="min-w-full text-sm">
          <thead className="bg-at-bg text-at-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                {noun.replace(/^./, (c) => c.toUpperCase())}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Arrivals
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                On time
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Early or late
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Only from here
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const value = offScheduleValue(p.avg_delay_sec, p.avg_abs_delay_sec, p.mode);
              return (
                <tr key={p.stop_id} className="border-t border-at-border">
                  <td className="px-3 py-2 font-semibold tabular-nums">{p.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.events}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.on_time_pct == null ? UNKNOWN_VALUE : `${p.on_time_pct.toFixed(1)}%`}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-semibold tabular-nums",
                      OFF_SCHEDULE_TONE_CLASS[value.tone],
                    )}
                  >
                    {value.text}
                  </td>
                  {/* Blank rather than a dash: no route being exclusive to a
                      platform is a fact about it, where the dash elsewhere on the
                      site means a figure the site does not have. */}
                  <td className="px-3 py-2">{p.only_routes.join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-at-muted">
          {`${MIN_PLATFORM_EVENTS} arrivals needed to be listed, so a ${noun} used a handful of times that day is not shown.`}
        </p>
      </div>
    </section>
  );
}

/**
 * Streamed departures board. Awaits the external AT call off the critical path
 * so the stop shell and stats render without waiting on it.
 *
 * One call covers a whole station: AT's schedule answers a parent id with every
 * platform's departures, already in order. Since no trip can appear twice once
 * the set-down-only rows are dropped, nothing is merged or deduped here.
 * @param root0 - Props.
 * @param root0.scheduleStopId - The id AT's schedule answers on for this page.
 * @param root0.serviceDate - The resolved service date being shown.
 * @param root0.routeNames - Route id to short-name map for the rows.
 * @returns The departures board.
 */
async function StopScheduleSection({
  scheduleStopId,
  serviceDate,
  routeNames,
}: {
  scheduleStopId: string;
  serviceDate: string;
  routeNames: Map<string, string | null>;
}): Promise<JSX.Element> {
  const result = await getStopDepartures(scheduleStopId, serviceDate);
  return <StopSchedule result={result} routeNames={routeNames} serviceDate={serviceDate} />;
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
