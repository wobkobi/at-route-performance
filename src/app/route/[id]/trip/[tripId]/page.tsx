// src/app/route/[id]/trip/[tripId]/page.tsx
// Trip timeline page showing one run's stop-by-stop scheduled-vs-actual punctuality.

import { ChevronLeft } from "@/components/icons";
import { MapMarkKey, StopDotKey } from "@/components/MapLegend";
import { ModeIcon } from "@/components/ModeIcon";
import StopMapWrapper from "@/components/StopMapWrapper";
import { TripCancellationNote } from "@/components/TripCancellationNote";
import { TripDetourNote } from "@/components/TripDetourNote";
import { arrivedBeforeFlag, cancellationStage } from "@/lib/cancellation";
import { cn } from "@/lib/cn";
import {
  getLatestTripDay,
  getTripCancellation,
  getTripDetour,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
  type ScheduledStop,
} from "@/lib/data";
import { formatDelay, formatGtfsTime } from "@/lib/format";
import { cardMetadata, cardPath, parseTripCard } from "@/lib/og";
import { delayBand } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import { buildRouteView, type MapStop } from "@/lib/route-view";
import { nzClockTime, nzServiceDayRange, nzServiceDayString, serviceDayLabel } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { TripStop } from "@/types/api";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";

/**
 * Per-trip page title, so a tab and a shared link name the route, the run and,
 * when the link carries one, the day it ran. AT reuses a trip id every day its
 * timetable runs, so without the day two tabs of one id read the same.
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
  const title = `Trip ${tripId} on ${routeSlug(id)}${dayPart}`;
  const description = `Stop-by-stop punctuality of one ${routeSlug(id)} run against Auckland Transport's published schedule.`;
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
 * @param root0.searchParams - Optional query params (`d` = the run's instant).
 * @returns Page markup.
 */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tripId: string }>;
  searchParams?: Promise<{ d?: string }>;
}): Promise<JSX.Element> {
  const { id, tripId } = await params;
  const slug = routeSlug(id);
  const { d } = (await searchParams) ?? {};
  // Scope to the run's Auckland-local day so other days' runs of the same tripId
  // do not interleave; falls back to the trip's latest day when `d` is absent
  // or unparseable (an Invalid Date would throw inside nzServiceDayRange). The
  // timeline and the cancellation flag must agree on that day, so it is resolved
  // here rather than inside the timeline query.
  const dAt = d ? new Date(d) : null;
  const day =
    dAt && !Number.isNaN(dAt.getTime()) ? nzServiceDayRange(dAt) : await getLatestTripDay(tripId);
  // An AT outage costs this request its schedule and road path, not the day's
  // cache entries - but a swallowed failure read as "this run has no stops", so
  // `allSettled` keeps the rejection and the page below says which it was.
  const [timeline, optional, flag, detour] = await Promise.all([
    getTripTimeline(tripId, slug, day ?? undefined),
    Promise.allSettled([getTripScheduledStops(tripId), getTripShape(tripId)]),
    getTripCancellation(tripId, day),
    day ? getTripDetour(tripId, day) : Promise.resolve(null),
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
  const routeMode = route?.mode ?? "BUS";

  // Cancellation: the recorded arrivals against AT's flag tell a trip that never
  // ran from one cut short or reinstated (see lib/cancellation.ts). A trip that
  // stopped reporting at the flag can leave one predicted arrival past it that
  // the vehicle never made, so for those stages it is not a served stop.
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

  // Merge served stops (with actual deviation data) and unserved scheduled stops
  // (future stops for a live trip). Served stops are matched by station-canonical
  // stop_id so train-platform variants don't create duplicates.
  type MergedStop = ({ kind: "served" } & TripStop) | ({ kind: "future" } & ScheduledStop);

  const servedById = new Map(recordedStops.map((s) => [s.stop_id, s]));
  const seenInSchedule = new Set<string>();

  const mergedStops: MergedStop[] =
    scheduledStops.length > 0
      ? [
          ...scheduledStops.map((s): MergedStop => {
            seenInSchedule.add(s.stop_id);
            const served = servedById.get(s.stop_id);
            return served ? { kind: "served", ...served } : { kind: "future", ...s };
          }),
          // Append any served stops absent from the schedule (diversions / id gaps).
          ...recordedStops
            .filter((s) => !seenInSchedule.has(s.stop_id))
            .map((s): MergedStop => ({ kind: "served", ...s })),
        ]
      : recordedStops.map((s): MergedStop => ({ kind: "served", ...s }));

  // Map shows all stops: served ones coloured by deviation, future ones neutral.
  const tripMapStops: MapStop[] = mergedStops.map((s) => ({
    stop_id: s.stop_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    avg_delay_sec: s.kind === "served" ? s.deviation_sec : null,
    on_time_pct: null,
  }));
  // The trip's own GTFS shape follows the road; joining the stops is the fallback
  // for a trip AT no longer publishes or a shape not yet ingested.
  const tripPath: Array<[number, number]> =
    roadPath.length > 1 ? roadPath : mergedStops.map((s) => [s.lat, s.lon]);

  // When there is neither a trip path nor any stop (AT API failure + no
  // ArrivalEvents), fall back to the route's shapes so at least the map renders.
  let fallbackLines: Array<[number, number]>[] = [];
  if (tripPath.length < 2) {
    const fallback = await buildRouteView(slug, [], routeMode);
    fallbackLines = fallback.routeLines.map((l) => l.points);
  }

  // Only a run on today's service day can have a vehicle out now; a trip id
  // repeats every day, so an older run would otherwise show today's vehicle.
  const isLiveRun = day !== null && nzServiceDayString(day.start) === nzServiceDayString();

  // Detour: the stop nearest the furthest off-route reading places it for the
  // reader, since the readings carry no street names.
  const furthest = detour?.sightings.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
  const nearestStop = furthest
    ? (mergedStops.reduce<{ name: string; d: number } | null>((best, s) => {
        const d = Math.hypot(
          s.lat - furthest.lat,
          (s.lon - furthest.lon) * Math.cos((s.lat * Math.PI) / 180),
        );
        return best === null || d < best.d ? { name: s.name, d } : best;
      }, null)?.name ?? null)
    : null;

  const title = route?.shortName ?? slug;
  const firstServed = mergedStops.find(
    (s): s is { kind: "served" } & TripStop => s.kind === "served",
  );
  const departing = firstServed
    ? nzClockTime(firstServed.scheduled_at)
    : scheduledStops[0]?.departure_time
      ? formatGtfsTime(scheduledStops[0].departure_time)
      : null;

  // The stops a cut-short trip never reached are the scheduled ones after its
  // last recorded arrival; gaps before that are only polls that missed a stop.
  const lastServed = recordedStops.reduce<TripStop | null>(
    (last, s) => (last === null || actualAt(s) > actualAt(last) ? s : last),
    null,
  );
  const scheduledPart = mergedStops.slice(0, scheduledStops.length);
  const lastServedIndex = scheduledPart.findLastIndex((s) => s.kind === "served");
  const notServedFrom =
    stage === "before" ? 0 : stage === "mid-trip" ? lastServedIndex + 1 : scheduledStops.length;
  // Which of the timeline's two unlabelled dot states are on screen, so the key
  // under it names only what the reader can actually see.
  const hasUnrecorded = mergedStops.some((s, i) => s.kind === "future" && i < notServedFrom);
  const hasNotServed = mergedStops.some((s, i) => s.kind === "future" && i >= notServedFrom);

  return (
    <main className={cn("space-y-6")}>
      <Link
        href={buildHref(`/route/${encodeURIComponent(slug)}`, {
          day: day && !isLiveRun ? nzServiceDayString(day.start) : undefined,
        })}
        className={cn("inline-flex items-center gap-1 text-sm text-at-shore hover:underline")}
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
              colour={route.colour}
              className="h-7 w-7"
            />
          )}
          {title}
        </h1>
        <p className="text-at-muted">
          {day && `${serviceDayLabel(nzServiceDayString(day.start))} · `}
          {departing ? `Trip departing ${departing}` : "Trip"}
          {vehicle_id && ` · ${vehicle_id}`}
        </p>
      </header>

      {detour && (
        <TripDetourNote
          sightings={detour.sightings}
          alert={detour.alert}
          nearestStop={nearestStop}
          noun={routeMode === "TRAIN" ? "train" : routeMode === "FERRY" ? "ferry" : "bus"}
        />
      )}

      {flag && stage && (
        <TripCancellationNote
          stage={stage}
          detectedAt={flag.detected_at}
          lastStop={lastServed ? { name: lastServed.name, at: actualAt(lastServed) } : null}
          notServed={
            scheduledStops.length > 0 ? scheduledStops.length - Math.max(notServedFrom, 0) : null
          }
        />
      )}

      {(tripMapStops.length > 0 || tripPath.length > 1 || fallbackLines.length > 0) && (
        <section className="border border-at-border bg-at-surface p-4">
          <div className="mb-2 flex items-center justify-between">
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
              label: `${nzClockTime(s.at)}, ${s.distanceM.toLocaleString()} m off route`,
            }))}
            mode={route?.mode as "BUS" | "TRAIN" | "FERRY" | undefined}
            className="h-100"
          />
          <MapMarkKey live={isLiveRun} offRoute={(detour?.sightings.length ?? 0) > 0} />
        </section>
      )}

      {mergedStops.length === 0 ? (
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
          <ol className="space-y-0">
            {mergedStops.map((s, i) => {
              const isFuture = s.kind === "future";
              const notServed = isFuture && i >= notServedFrom;
              const stopBand = isFuture ? "ontime" : delayBand(s.deviation_sec, routeMode);
              const band = isFuture
                ? "text-at-muted"
                : stopBand === "late"
                  ? "text-at-late"
                  : stopBand === "early"
                    ? "text-at-early"
                    : "text-at-ink";
              const dotColour = isFuture
                ? "bg-at-border"
                : stopBand === "late"
                  ? "bg-at-late"
                  : stopBand === "early"
                    ? "bg-at-early"
                    : "bg-at-ontime";
              return (
                <li key={`${s.stop_id}-${i}`} className="flex items-stretch gap-3">
                  {/* Rail: line above, dot, line below so the circle sits centred on a continuous rail. */}
                  <div className="flex w-3 flex-col items-center">
                    <span
                      className={cn("w-px flex-1", i > 0 ? "bg-at-border" : "")}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "h-3 w-3 shrink-0 rounded-full",
                        notServed ? "border-2 border-at-late bg-at-surface" : dotColour,
                      )}
                    />
                    <span
                      className={cn(
                        "w-px flex-1",
                        i < mergedStops.length - 1 ? "bg-at-border" : "",
                      )}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="flex flex-1 items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "truncate font-medium",
                          isFuture && "text-at-muted",
                          notServed && "line-through",
                        )}
                      >
                        {s.name}
                      </p>
                      <p className="text-xs text-at-muted tabular-nums">
                        {isFuture ? (
                          <>
                            Sched{" "}
                            <span className="text-at-ink">
                              {s.departure_time ? formatGtfsTime(s.departure_time) : "—"}
                            </span>
                          </>
                        ) : (
                          <>
                            Sched <span className="text-at-ink">{nzClockTime(s.scheduled_at)}</span>{" "}
                            · Actual{" "}
                            <span className={cn(band)}>
                              {nzClockTime(
                                new Date(
                                  new Date(s.scheduled_at).getTime() + s.deviation_sec * 1000,
                                ).toISOString(),
                              )}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {!isFuture && (
                      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", band)}>
                        {formatDelay(s.deviation_sec, { mode: routeMode })}
                      </span>
                    )}
                    {notServed && (
                      <span className="shrink-0 text-sm font-semibold text-at-late">
                        Not served
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {/* The rail's two grey states carry meaning that no text on the row says.
              A struck row at least prints "Not served"; a plain grey one prints
              nothing at all, and the map legend above covers only the three delay
              colours, which are a different thing entirely. */}
          {(hasUnrecorded || hasNotServed) && (
            <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-at-muted">
              {hasUnrecorded && (
                <div className="flex items-center gap-1.5">
                  <dt className="h-3 w-3 shrink-0 rounded-full bg-at-border" />
                  <dd>Scheduled, with no arrival recorded</dd>
                </div>
              )}
              {hasNotServed && (
                <div className="flex items-center gap-1.5">
                  <dt className="h-3 w-3 shrink-0 rounded-full border-2 border-at-late bg-at-surface" />
                  <dd>The run never reached this stop</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      )}
    </main>
  );
}
