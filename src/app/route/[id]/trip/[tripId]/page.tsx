// src/app/route/[id]/trip/[tripId]/page.tsx
// Trip timeline page showing one run's stop-by-stop scheduled-vs-actual punctuality.

import { ChevronLeft } from "@/components/icons";
import { MapMarkKey, StopDotKey } from "@/components/map/MapLegend";
import StopMapWrapper from "@/components/map/StopMapWrapper";
import { ModeIcon } from "@/components/ModeIcon";
import { TripCancellationNote } from "@/components/trip/TripCancellationNote";
import { TripDetourNote } from "@/components/trip/TripDetourNote";
import { TripGhostRunNote } from "@/components/trip/TripGhostRunNote";
import { TripLine } from "@/components/trip/TripLine";
import { Hint } from "@/components/ui/Hint";
import { cn } from "@/lib/cn";
import { MEASURED_AGAINST } from "@/lib/copy";
import {
  getGhostRun,
  getGhostRunFor,
  getLatestTripDay,
  getTripCancellation,
  getTripDetour,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
  type GhostRunRow,
  type ScheduledStop,
} from "@/lib/data";
import { formatCount } from "@/lib/format";
import { metresBetween } from "@/lib/geo/distance";
import { modeOrBus, modeWord } from "@/lib/mode";
import { cardMetadata, cardPath, parseTripCard } from "@/lib/og";
import { routeHref, stopHref, vehicleHref } from "@/lib/page/hrefs";
import { routeDisplayName, routeSlug } from "@/lib/route/slug";
import { buildRouteView, type MapStop } from "@/lib/route/view";
import { dayLinkParam } from "@/lib/time/day-url";
import { formatGtfsTime, nzClockTime } from "@/lib/time/format";
import { requestServiceDay } from "@/lib/time/request-now";
import {
  afterMidnightNote,
  gtfsServiceSeconds,
  isAfterMidnight,
  nzServiceDayRange,
  nzServiceDayString,
  parseInstantParam,
  SEC_PER_DAY,
  serviceDayLabel,
} from "@/lib/time/service-day";
import { tripBoardView } from "@/lib/trip/board";
import { arrivedBeforeFlag, cancellationStage } from "@/lib/trip/cancellation";
import { buildTripLine } from "@/lib/trip/line";
import type { TripStop } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

/**
 * Per-trip page title, so a tab and a shared link name the route and, when the
 * link carries one, the day the run ran.
 *
 * The departure time is what the page's own heading leads with and would read
 * better here, but it comes from the timeline and the schedule, and the schedule
 * is an AT API call: putting either in front of the document head would add a
 * round trip to the site's most prefetched path and take the page down with any
 * AT outage. The raw trip id is no substitute - it is a 30-character GTFS id,
 * and the timestamp inside it is the feed version, not the departure.
 * @param root0 - Page props.
 * @param root0.params - Promise resolving to the dynamic params `{ id, tripId }`.
 * @param root0.searchParams - Optional query params (`d` = the run's instant).
 * @returns Title, description and card metadata for the trip.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tripId: string }>;
  searchParams?: Promise<{ d?: string }>;
}): Promise<Metadata> {
  const { id, tripId } = await params;
  const { d } = (await searchParams) ?? {};
  const dAt = d ? new Date(d) : null;
  const dayPart =
    dAt && !Number.isNaN(dAt.getTime()) ? `, ${serviceDayLabel(nzServiceDayString(dAt))}` : "";
  const title = `${routeSlug(id)} trip${dayPart}`;
  const description = `Stop-by-stop punctuality of one ${routeSlug(id)} run ${MEASURED_AGAINST}`;
  return {
    title,
    description,
    ...cardMetadata(title, description, cardPath(parseTripCard(id, tripId, d))),
  };
}

/**
 * Trip timeline page: one run's stop-by-stop scheduled-vs-actual punctuality.
 * A trip id that matches no route, no recorded stop and no published schedule
 * is a 404 rather than an empty page.
 * @param root0 - Page props.
 * @param root0.params - Dynamic route params `{ id, tripId }`.
 * @param root0.searchParams - Optional query params (`d` = the run's instant, plus the
 *   route trip board's view to return to).
 * @returns Page markup.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tripId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { id, tripId } = await params;
  const slug = routeSlug(id);
  const sp = (await searchParams) ?? {};
  const d = typeof sp.d === "string" ? sp.d : undefined;
  // One request-time clock read for the whole render (see lib/time/request-now.ts).
  // The reads below need it before they run, not just the live tests further
  // down: the cache policy behind them asks whether this run's day is over.
  const today = await requestServiceDay();
  // Scope to the run's Auckland-local day so other days' runs of the same tripId
  // do not interleave; falls back to the trip's latest day when `d` is absent
  // or unparseable (an Invalid Date would throw inside nzServiceDayRange). The
  // timeline and the cancellation flag must agree on that day, so it is resolved
  // here rather than inside the timeline query.
  const dAt = parseInstantParam(d);
  const day = dAt ? nzServiceDayRange(dAt) : await getLatestTripDay(tripId);
  // An AT outage costs this request its schedule and road path, not the day's
  // cache entries - but a swallowed failure read as "this run has no stops", so
  // `allSettled` keeps the rejection and the page below says which it was.
  // The stored service date the ghost records are keyed on is null only for an
  // undated link to a trip that has never recorded anything.
  const serviceDate = day ? nzServiceDayString(day.start) : null;
  const [timeline, optional, flag, detour, ghostRun, ghostRunHere] = await Promise.all([
    getTripTimeline(tripId, slug, day ?? undefined),
    Promise.allSettled([getTripScheduledStops(tripId), getTripShape(tripId)]),
    getTripCancellation(tripId, day),
    day ? getTripDetour(tripId, day) : Promise.resolve(null),
    // This run's readings were not its own.
    getGhostRun(tripId, serviceDate),
    // Another run's readings were filed under this run's number.
    serviceDate ? getGhostRunFor(tripId, serviceDate) : Promise.resolve<GhostRunRow | null>(null),
  ]);
  const [scheduledResult, roadResult] = optional;
  const scheduleFailed = scheduledResult.status === "rejected";
  const scheduledStops: ScheduledStop[] =
    scheduledResult.status === "fulfilled" ? scheduledResult.value : [];
  const roadPath: Array<[number, number]> =
    roadResult.status === "fulfilled" ? roadResult.value : [];
  const { route, vehicle_id } = timeline;
  // Nothing knows this run: no route row, no arrival on any day, no schedule.
  // Not when the schedule call failed, though - that is an outage, and a 404
  // would tell the reader the run does not exist.
  if (!route && !scheduleFailed && timeline.stops.length === 0 && scheduledStops.length === 0) {
    notFound();
  }
  const routeMode = modeOrBus(route?.mode);
  const vehicleNoun = modeWord(routeMode);
  // The ghost panels' link to the other run keeps this run's day.
  const linkD = d ?? day?.start.toISOString() ?? null;

  // Cancellation: the recorded arrivals against AT's flag tell a trip that never
  // ran from one cut short or reinstated (see lib/trip/cancellation.ts). A trip
  // that stopped reporting at the flag can leave one predicted arrival past it
  // that the vehicle never made, so for those stages it is not a served stop.
  /**
   * When the vehicle reached a recorded stop.
   * @param s - A recorded stop.
   * @returns The ISO arrival instant (schedule plus deviation).
   */
  const actualAt = (s: TripStop): string =>
    new Date(Date.parse(s.scheduled_at) + s.deviation_sec * 1000).toISOString();
  const stage = flag ? cancellationStage(flag.detected_at, timeline.stops.map(actualAt)) : null;
  const recordedStops =
    flag && stage !== "ran"
      ? timeline.stops.filter((s) => arrivedBeforeFlag(flag.detected_at, actualAt(s)))
      : timeline.stops;

  // Only a run on today's service day can have a vehicle out now; a trip id
  // repeats every day, so an older run would otherwise show today's vehicle.
  const isLiveRun = day !== null && nzServiceDayString(day.start) === today;

  // The timetable's stops with each recorded arrival matched in, and the stops
  // the run made off its timetable placed where they came in time.
  const line = buildTripLine({
    scheduled: scheduledStops,
    recorded: recordedStops,
    stage,
    offRoute: detour?.sightings.map((s) => Date.parse(s.at)) ?? [],
    live: isLiveRun,
  });

  // Map shows all stops: recorded ones coloured by deviation, the rest neutral.
  const tripMapStops: MapStop[] = line.stops.map((s) => ({
    stop_id: s.stop_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    avg_delay_sec: s.recorded?.deviation_sec ?? null,
    on_time_pct: null,
  }));
  // The trip's own GTFS shape follows the road; joining the stops is the fallback
  // for a trip AT no longer publishes or a shape not yet ingested.
  const tripPath: Array<[number, number]> =
    roadPath.length > 1 ? roadPath : line.stops.map((s) => [s.lat, s.lon]);

  // When there is neither a trip path nor any stop (AT API failure + no
  // ArrivalEvents), fall back to the route's shapes so at least the map renders.
  let fallbackLines: Array<[number, number]>[] = [];
  if (tripPath.length < 2) {
    const fallback = await buildRouteView(slug, [], routeMode);
    fallbackLines = fallback.routeLines.map((l) => l.points);
  }
  const hasTripMap = tripMapStops.length > 0 || tripPath.length > 1 || fallbackLines.length > 0;

  // Detour: the stop nearest the furthest off-route reading places it for the
  // reader, since the readings carry no street names.
  const furthest = detour?.sightings.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
  const nearest = furthest
    ? line.stops.reduce<{ name: string; stopId: string; d: number } | null>((best, s) => {
        const d = metresBetween([s.lat, s.lon], [furthest.lat, furthest.lon]);
        return best === null || d < best.d ? { name: s.name, stopId: s.stop_id, d } : best;
      }, null)
    : null;

  // A stop or the vehicle opens on the run's day; today's is left off, as those pages default to it.
  const linkDay = isLiveRun ? undefined : dayLinkParam(serviceDate, today);
  const nearestStop = nearest
    ? { name: nearest.name, href: stopHref(nearest.stopId, { day: linkDay }) }
    : null;

  const title = route ? routeDisplayName({ ...route, slug }) : slug;
  const firstServed = line.stops.find((s) => s.recorded)?.recorded;
  const firstDeparture = scheduledStops[0]?.departure_time;
  const departing = firstServed
    ? nzClockTime(firstServed.scheduled_at)
    : firstDeparture
      ? formatGtfsTime(firstDeparture)
      : null;
  // A 12:30am run counts towards the day before, which the date beside it names.
  const departsAfterMidnight = firstServed
    ? isAfterMidnight(new Date(firstServed.scheduled_at))
    : !!firstDeparture && (gtfsServiceSeconds(firstDeparture) ?? 0) >= SEC_PER_DAY;

  const lastServed = recordedStops.reduce<TripStop | null>(
    (last, s) => (last === null || actualAt(s) > actualAt(last) ? s : last),
    null,
  );

  return (
    <main className={cn("space-y-6")}>
      <Link
        href={routeHref(slug, {
          // Today's day is left off, since the route page redirects it away.
          day: linkDay,
          // The board's sort, page and filters, as the run's link brought them.
          ...tripBoardView(sp),
        })}
        className={cn("at-link inline-flex items-center gap-1 text-sm")}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to {title}
      </Link>

      <header className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl leading-headline font-ultra tracking-zero">
          {route && (
            <ModeIcon
              mode={route.mode}
              shortName={route.shortName}
              longName={route.longName}
              className="h-7 w-7"
            />
          )}
          {title}
        </h1>
        <p className="text-at-muted">
          {day && `${serviceDayLabel(nzServiceDayString(day.start))} · `}
          {departing ? `Trip departing ${departing}` : "Trip"}
          {departing && departsAfterMidnight && serviceDate && (
            <>
              {" "}
              <Hint hint={afterMidnightNote(serviceDate)}>(after midnight)</Hint>
            </>
          )}
          {vehicle_id && (
            <>
              {" · "}
              <Link href={vehicleHref(vehicle_id, { day: linkDay })} className="at-link">
                {vehicle_id}
              </Link>
            </>
          )}
        </p>
      </header>

      {detour && (
        <TripDetourNote
          sightings={detour.sightings}
          alert={detour.alert}
          nearestStop={nearestStop}
          noun={vehicleNoun}
        />
      )}

      {flag && stage && (
        <TripCancellationNote
          stage={stage}
          detectedAt={flag.detected_at}
          lastStop={
            lastServed
              ? {
                  name: lastServed.name,
                  at: actualAt(lastServed),
                  href: stopHref(lastServed.stop_id, { day: linkDay }),
                }
              : null
          }
          notServed={
            scheduledStops.length > 0
              ? line.stops.filter((s) => s.state === "not-served").length
              : null
          }
        />
      )}

      {ghostRun && (
        <TripGhostRunNote
          kind="hidden"
          other={ghostRun.belongs_to}
          routeSlug={slug}
          day={linkD}
          noun={vehicleNoun}
        />
      )}

      {ghostRunHere && (
        <TripGhostRunNote
          kind="mirror"
          other={{ trip_id: ghostRunHere.trip_id, label: ghostRunHere.label }}
          routeSlug={slug}
          day={linkD}
          noun={vehicleNoun}
        />
      )}

      {/* On a wide screen the map sits beside the stop list and stays in view as
          the list scrolls: a tall half-width box suits a route's shape far better
          than a full-width strip, and the list no longer stretches across the page. */}
      <div
        className={cn(
          "space-y-6",
          hasTripMap && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0",
        )}
      >
        {hasTripMap && (
          <section className="border border-at-border bg-at-surface p-4 lg:sticky lg:top-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-ultra tracking-zero">Trip map</h2>
              <StopDotKey />
            </div>
            <StopMapWrapper
              stops={tripMapStops}
              routeLines={tripPath.length > 1 ? [tripPath] : fallbackLines}
              routeId={slug}
              live={isLiveRun}
              filterTripId={tripId}
              offRoute={detour?.sightings.map((s) => ({
                lat: s.lat,
                lon: s.lon,
                label: `${nzClockTime(s.at)}, ${formatCount(s.distanceM)} metres off route`,
              }))}
              mode={route ? modeOrBus(route.mode) : undefined}
              colour={route?.colour ?? null}
              stopLinks
              stopDay={linkDay}
              className="h-[min(25rem,60svh)] lg:h-[min(44rem,calc(100dvh-12rem))]"
            />
            <MapMarkKey live={isLiveRun} offRoute={(detour?.sightings.length ?? 0) > 0} />
          </section>
        )}

        {line.stops.length === 0 ? (
          <p
            className={cn(
              "border border-at-border bg-at-surface p-4",
              scheduleFailed ? "text-at-late" : "text-at-muted",
            )}
          >
            {scheduleFailed
              ? "This run's schedule could not be loaded, so its stops are missing. Reload to try again."
              : "No stop records found for this trip."}
          </p>
        ) : (
          <section className="border border-at-border bg-at-surface p-4">
            <TripLine
              line={line}
              mode={routeMode}
              colour={route?.colour ?? null}
              stopDay={linkDay}
            />
          </section>
        )}
      </div>
    </main>
  );
}
