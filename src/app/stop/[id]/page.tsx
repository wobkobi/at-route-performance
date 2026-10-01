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
import { DayNav } from "@/components/date/DayNav";
import { ChevronLeft } from "@/components/icons";
import { LoadingBlock } from "@/components/Loading";
import { StopDotKey } from "@/components/map/MapLegend";
import StopMapWrapper from "@/components/map/StopMapWrapper";
import { PunctualityStat, type PunctualityBreakdown } from "@/components/PunctualityStat";
import { RankBoard } from "@/components/ranking/RankBoard";
import { StopSchedule } from "@/components/StopSchedule";
import { cn } from "@/lib/cn";
import { MEASURED_AGAINST, ON_TIME_CAPTION } from "@/lib/copy";
import {
  getEarliestDataDay,
  getRouteNames,
  getStationSiblings,
  getStopIdentity,
  getStopStats,
} from "@/lib/data";
import { getRouteModeMap } from "@/lib/data/routes";
import { readFallback } from "@/lib/db";
import {
  alertsForStop,
  getServiceAlerts,
  getUpcomingAlerts,
  type ServiceAlert,
} from "@/lib/feed/at-alerts";
import { getStopDepartures } from "@/lib/feed/at-stop-trips";
import {
  formatCount,
  formatDuration,
  formatPct,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { fareZonesOf } from "@/lib/geo/fare-zone-geo";
import { FARE_ZONE_LABEL } from "@/lib/geo/fare-zones";
import { cardMetadata, cardPath, cardWhenSuffix, parseStopCard } from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { routeHref, stopHref, type LinkQuery } from "@/lib/page/hrefs";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import { dayRangeNav, routeLinkParams, windowPhrase } from "@/lib/page/range";
import { serviceClockNow } from "@/lib/stop/departure-board";
import { dominantStopMode, stopGrain } from "@/lib/stop/grain";
import {
  MIN_PLATFORM_EVENTS,
  platformNoun,
  platformsDiffer,
  type PlatformRow,
} from "@/lib/stop/station-platforms";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  /** `all` asks the departures board for the whole service day. */
  sched?: string;
}

/**
 * A stop id from its URL segment, decoded when it decodes cleanly. A raw "%"
 * in a hand-typed URL would otherwise throw URIError and 500 the page, so a
 * segment that does not decode is taken as it is.
 * @param raw - The segment.
 * @returns The stop id.
 */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Per-stop page title, so a tab and a shared link name the stop rather than
 * repeating the site title. The shared link's card and title name the day the
 * link carries, which the card reads from the query rather than from the
 * resolved day - so nothing here needs to know which day the page will show.
 * The name comes from {@link getStopIdentity}, a day-independent lookup, rather
 * than from the day's figures: the title says which stop this is, not how it ran.
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
  const id = decodeSegment((await params).id);
  const sp = (await searchParams) ?? {};
  const name = (await getStopIdentity(id).catch(readFallback("stop-identity", null)))?.name;
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
  const id = decodeSegment((await params).id);
  const sp = (await searchParams) ?? {};

  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  const stopPath = stopHref(id);
  clampDayParam(stopPath, sp, today);
  dropTodayParam(stopPath, sp, today);

  // Start the alerts fetch early so it overlaps the stats query. The banner is
  // awaited rather than streamed: it sits above the page's content, and letting
  // it pop in afterwards shoved everything below it down as the reader arrived.
  const alertsPromise = getServiceAlerts();
  // getEarliestDataDay and the sibling lookup are both independent of the day
  // and of the stop query.
  const [shown, earliestDay, siblings] = await Promise.all([
    resolveShownDay(resolveRequestedDay(sp.day), today),
    getEarliestDataDay(1),
    getStationSiblings(id),
  ]);
  const { range, serviceDate } = shown;
  const stats = await getStopStats(id, range, THRESHOLD_SEC, REVALIDATE);
  if (!stats) notFound();

  const nav = dayRangeNav(shown, earliestDay, today);
  // Today's links stay clean (no ?day) so they don't bounce through the redirect.
  const linkDay = dayLinkParam(serviceDate, today);

  const { stop, summary, routes, routes_count } = stats;
  const zones = fareZonesOf(stop.lat, stop.lon);
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
        className="at-link inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        The worst stops {windowPhrase(nav, null)}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {/* What the figures below cover: one pole, or every pole of a place
              averaged together. A grouped page says how many, because its single
              on-time figure is their average and nothing else on the page says
              so unless the per-platform table earned its space. */}
          <p className="text-xs tracking-zero text-at-muted uppercase">
            {stopGrain(
              dominantStopMode(stats.routes),
              stats.platform_labels,
              stats.platform_ids.length,
            )}
          </p>
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">{stop.name}</h1>
          {zones.length > 0 && (
            <p className="mt-0.5 text-sm text-at-muted">
              {zones.length === 1 ? "Fare zone " : "On a boundary, in fare zones "}
              {zones.map((z, i) => (
                <Fragment key={z}>
                  {i > 0 && " and "}
                  <Link href={buildHref("/routes", { day: linkDay, zone: z })} className="at-link">
                    {FARE_ZONE_LABEL[z]}
                  </Link>
                </Fragment>
              ))}
            </p>
          )}
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
                  <Link href={stopHref(s.id, { day: linkDay })} className="at-link">
                    {s.name}
                  </Link>
                </Fragment>
              ))}
            </p>
          )}
          <p className="mt-1 text-sm">
            <Link
              href={buildHref("/compare", { kind: "stops", ids: id, day: linkDay })}
              className="at-link"
            >
              Compare with other stops
            </Link>
          </p>
        </div>
        <DayNav
          basePath={stopPath}
          serviceDate={serviceDate}
          preservedParams={{}}
          hasPrev={nav.hasPrev}
          atFloor={nav.atFloor}
          hasNext={nav.hasNext}
          nextHref={nav.nextIsToday ? stopPath : undefined}
          nextPending={nav.nextPending}
          calendar={nav.calendar}
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
            <p className="text-2xl font-ultra tracking-zero tabular-nums">
              {formatCount(routes_count)}
            </p>
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
            value={formatPct(summary?.on_time_pct)}
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
      {stats.platforms.length > 0 && (
        <PlatformTable stopName={stop.name} rows={stats.platforms} linkDay={linkDay} />
      )}

      {/* The map shares a row with the worst-routes board on a wide screen: one
          stop's dot in a full-width strip is mostly empty street. The map takes
          the board's height. */}
      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
        <section className="border border-at-border bg-at-surface p-4 lg:flex lg:flex-col">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-ultra tracking-zero">Where it is</h2>
            <StopDotKey noReading={summary?.avg_delay_sec == null} lone />
          </div>
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
            className="h-[min(25rem,60svh)] lg:h-auto lg:min-h-80 lg:flex-1"
          />
          <p className="mt-2 text-xs text-at-muted">
            The dot is this stop, coloured by how early or late arrivals here were on average over
            the day shown.
          </p>
        </section>

        <RankBoard
          title="Worst routes here"
          accentClass="text-at-ink"
          rows={routes}
          metric="delay"
          caption={ON_TIME_CAPTION}
          routeParams={routeLinkParams("day", linkDay, null)}
        />
      </div>

      <Suspense fallback={<LoadingBlock label="Loading the departures" />}>
        <StopScheduleSection
          scheduleStopId={stats.schedule_stop_id}
          serviceDate={serviceDate}
          showAll={sp.sched === "all"}
          nowHref={buildHref(stopPath, { ...sp, sched: undefined })}
          allHref={buildHref(stopPath, { ...sp, sched: "all" })}
          routeParams={routeLinkParams("day", linkDay, null)}
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
 * @param root0.linkDay - The day shown, carried by each platform and route link; undefined for today.
 * @returns The section.
 */
function PlatformTable({
  stopName,
  rows,
  linkDay,
}: {
  stopName: string;
  rows: PlatformRow[];
  linkDay: string | undefined;
}): JSX.Element {
  const routeParams = routeLinkParams("day", linkDay, null);
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
          <thead className="bg-at-shore-pale text-at-muted">
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
                  <td className="px-3 py-2 font-semibold tabular-nums">
                    <Link href={stopHref(p.stop_id, { day: linkDay })} className="at-link">
                      {p.label}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(p.events)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatPct(p.on_time_pct)}</td>
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
                  <td className="px-3 py-2">
                    {p.only_routes.map((name, i) => {
                      const slug = p.route_slugs?.[name];
                      return (
                        <Fragment key={name}>
                          {i > 0 && ", "}
                          {slug ? (
                            <Link href={routeHref(slug, routeParams)} className="at-link">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </Fragment>
                      );
                    })}
                  </td>
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
 *
 * Names are resolved from the route table once the departures are known, not
 * from the "Worst routes here" board above. That board is the twelve worst by
 * off-schedule magnitude among routes that recorded an arrival, which differs
 * from "routes with a departure" in both directions: a thirteenth route, or one
 * whose every trip was cancelled, has a departure and no row there, and would
 * have printed its raw GTFS id. One cached read covers the whole table.
 * Today opens on what is still to come: a busy station is roughly 844 boardable
 * rows and a platform over 100, so the reader starts at the part of the day they
 * can still catch. The clock is read here rather than in the component so the
 * whole board renders from one instant.
 * @param root0 - Props.
 * @param root0.scheduleStopId - The id AT's schedule answers on for this page.
 * @param root0.serviceDate - The resolved service date being shown.
 * @param root0.showAll - Whether the reader asked for the whole day.
 * @param root0.nowHref - This page without the whole-day param.
 * @param root0.allHref - This page with it.
 * @param root0.routeParams - Params each route link carries.
 * @returns The departures board.
 */
async function StopScheduleSection({
  scheduleStopId,
  serviceDate,
  showAll,
  nowHref,
  allHref,
  routeParams,
}: {
  scheduleStopId: string;
  serviceDate: string;
  showAll: boolean;
  nowHref: string;
  allHref: string;
  routeParams: LinkQuery;
}): Promise<JSX.Element> {
  const result = await getStopDepartures(scheduleStopId, serviceDate);
  const departures = result.status === "ok" ? result.departures : [];
  const routeIds = [...new Set(departures.map((d) => d.routeId))];
  // A route's mode decides how its headsign is read, so it is looked up beside
  // the names, from the same table and under its own single cache key.
  const [names, modes] = await Promise.all([getRouteNames(routeIds), getRouteModeMap()]);
  return (
    <StopSchedule
      result={result}
      routeNames={new Map(Object.entries(names))}
      routeModes={modes}
      serviceDate={serviceDate}
      nowSeconds={serviceClockNow(serviceDate)}
      showAll={showAll}
      nowHref={nowHref}
      allHref={allHref}
      routeParams={routeParams}
    />
  );
}

/**
 * "Service alerts" banner for the stop, keeping the alerts that inform any of
 * its platforms, and on the current day a "Coming up" banner with those due in
 * the next week. Renders nothing when there are none.
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
  const upcoming = pastWindow ? [] : await getUpcomingAlerts().catch((): ServiceAlert[] => []);
  return (
    <>
      <AlertBanner
        alerts={alertsForStop(await alertsPromise, stopIds)}
        heading="Service alerts"
        pastWindow={pastWindow}
      />
      <AlertBanner alerts={alertsForStop(upcoming, stopIds)} heading="Coming up" upcoming />
    </>
  );
}
