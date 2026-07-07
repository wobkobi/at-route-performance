// src/app/route/[id]/trip/[tripId]/page.tsx
/**
 * @description Trip timeline page showing one run's stop-by-stop scheduled-vs-actual punctuality.
 */
import { ChevronLeft } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import StopMapWrapper from "@/components/StopMapWrapper";
import { cn } from "@/lib/cn";
import { getTripScheduledStops, getTripTimeline, type ScheduledStop } from "@/lib/data";
import { formatDelay, formatGtfsTime } from "@/lib/format";
import { delayBand } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import { buildRouteView, type MapStop } from "@/lib/route-view";
import { nzClockTime, nzServiceDayRange } from "@/lib/time";
import type { TripStop } from "@/types/api";
import type { JSX } from "react";

/**
 * Trip timeline page: one run's stop-by-stop scheduled-vs-actual punctuality.
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
  // or unparseable (an Invalid Date would throw inside nzServiceDayRange).
  const dAt = d ? new Date(d) : null;
  const day = dAt && !Number.isNaN(dAt.getTime()) ? nzServiceDayRange(dAt) : undefined;
  const [timeline, scheduledStops] = await Promise.all([
    getTripTimeline(tripId, slug, day),
    getTripScheduledStops(tripId),
  ]);
  const { route, vehicle_id } = timeline;
  const routeMode = route?.mode ?? "BUS";

  // Merge served stops (with actual deviation data) and unserved scheduled stops
  // (future stops for a live trip). Served stops are matched by station-canonical
  // stop_id so train-platform variants don't create duplicates.
  type MergedStop = ({ kind: "served" } & TripStop) | ({ kind: "future" } & ScheduledStop);

  const servedById = new Map(timeline.stops.map((s) => [s.stop_id, s]));
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
          ...timeline.stops
            .filter((s) => !seenInSchedule.has(s.stop_id))
            .map((s): MergedStop => ({ kind: "served", ...s })),
        ]
      : timeline.stops.map((s): MergedStop => ({ kind: "served", ...s }));

  // Map shows all stops: served ones coloured by deviation, future ones neutral.
  const tripMapStops: MapStop[] = mergedStops.map((s) => ({
    stop_id: s.stop_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    avg_delay_sec: s.kind === "served" ? s.deviation_sec : null,
    on_time_pct: null,
  }));
  const tripPath: Array<[number, number]> = mergedStops.map((s) => [s.lat, s.lon]);

  // When no stops are available (AT API failure + no ArrivalEvents), fall back to
  // the route shape from GTFS so at least the map renders.
  let fallbackLines: Array<[number, number]>[] = [];
  if (tripMapStops.length === 0) {
    const fallback = await buildRouteView(slug, [], routeMode);
    fallbackLines = fallback.routeLines.map((l) => l.points);
  }

  const title = route?.shortName ?? slug;
  const firstServed = mergedStops.find(
    (s): s is { kind: "served" } & TripStop => s.kind === "served",
  );
  const departing = firstServed?.scheduled_at;

  return (
    <main className={cn("space-y-6")}>
      <a
        href={`/route/${encodeURIComponent(slug)}`}
        className={cn("inline-flex items-center gap-1 text-sm text-at-shore hover:underline")}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to {title}
      </a>

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
          {departing ? `Trip departing ${nzClockTime(departing)}` : "Trip"}
          {vehicle_id && ` · ${vehicle_id}`}
        </p>
      </header>

      {(tripMapStops.length > 0 || fallbackLines.length > 0) && (
        <section className="border border-at-border bg-at-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-ultra tracking-zero">Trip map</h2>
            <span className="flex items-center gap-3 text-xs text-at-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-late" /> late
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-early" /> early
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-ontime" /> on time
              </span>
            </span>
          </div>
          <StopMapWrapper
            stops={tripMapStops}
            routeLines={tripPath.length > 1 ? [tripPath] : fallbackLines}
            routeId={slug}
            filterTripId={tripId}
            mode={route?.mode as "BUS" | "TRAIN" | "FERRY" | undefined}
            className="h-100"
          />
        </section>
      )}

      {mergedStops.length === 0 ? (
        <p className="border border-at-border bg-at-surface p-4 text-at-muted">
          No stop records found for this trip.
        </p>
      ) : (
        <section className="border border-at-border bg-at-surface p-4">
          <ol className="space-y-0">
            {mergedStops.map((s, i) => {
              const isFuture = s.kind === "future";
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
                    <span className={cn("h-3 w-3 shrink-0 rounded-full", dotColour)} />
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
                      <p className={cn("truncate font-medium", isFuture && "text-at-muted")}>
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
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}
