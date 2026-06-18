// src/app/route/[id]/page.tsx
import { RouteLineDiagram } from "@/components/RouteLineDiagram";
import StopMapWrapper from "@/components/StopMapWrapper";
import { WorstTripsBoard } from "@/components/WorstTripsBoard";
import { cn } from "@/lib/cn";
import { getMostRecentDataDay, getRouteStats, getWorstTripsOfDay } from "@/lib/data";
import { prisma } from "@/lib/db";
import { formatDelay } from "@/lib/format";
import { linkColour } from "@/lib/link-colour";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { getRoutePattern } from "@/lib/route-pattern";
import { nzDayRange, type DateRange } from "@/lib/time";
import { routeStatsQuery } from "@/lib/validate";
import type { RoutePattern } from "@/types/api";
import type { JSX } from "react";

/** Query params for route detail (raw strings). */
interface StatsSearchParams {
  thresholdSec?: string;
}

/** A stop plotted on the route map. */
interface MapStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

/**
 * Auckland-local day label (e.g. `18 Jun`) for a day window's start.
 * @param at - An instant within the local day.
 * @returns The label.
 */
function dayLabelFor(at: Date): string {
  return at.toLocaleDateString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
  });
}

/** The route map + line-diagram inputs derived from the schedule pattern. */
interface RouteView {
  stops: MapStop[];
  routeLines: Array<Array<[number, number]>>;
  directions: RoutePattern["directions"];
  nameByStop: Map<string, string>;
}

/**
 * Build the route map (stops + per-variant path lines) and the line-diagram
 * inputs from the schedule pattern, colouring stops by the day's average delay.
 * Falls back to the day's busiest stops (no path, no diagram) when the pattern
 * is unavailable.
 * @param routeId - AT route id.
 * @param byStop - The day's per-stop stats (carries the delay colour + coords).
 * @returns Map stops, path lines, pattern directions, and stop names.
 */
async function buildRouteView(routeId: string, byStop: MapStop[]): Promise<RouteView> {
  const empty = { stops: byStop, routeLines: [], directions: {}, nameByStop: new Map() };
  const pattern = await getRoutePattern(routeId).catch(() => ({ directions: {} }));
  const variants = Object.values(pattern.directions).flatMap((d) => d.variants);
  const patternStopIds = [...new Set(variants.flatMap((v) => v.stopIds))];
  if (patternStopIds.length === 0) return empty;

  const stopDocs = await prisma.stop.findMany({
    where: { id: { in: patternStopIds } },
    select: { id: true, name: true, lat: true, lon: true },
  });
  if (stopDocs.length === 0) return empty;

  const coordById = new Map(stopDocs.map((s) => [s.id, s]));
  const nameByStop = new Map(stopDocs.map((s) => [s.id, s.name]));
  const delayById = new Map(byStop.map((s) => [s.stop_id, s]));

  const stops: MapStop[] = stopDocs.map((s) => {
    const stat = delayById.get(s.id);
    return {
      stop_id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      avg_delay_sec: stat?.avg_delay_sec ?? null,
      on_time_pct: stat?.on_time_pct ?? null,
    };
  });

  const routeLines = variants
    .map((v) =>
      v.stopIds
        .map((id) => coordById.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => [s.lat, s.lon] as [number, number]),
    )
    .filter((line) => line.length > 1);

  return { stops, routeLines, directions: pattern.directions, nameByStop };
}

/**
 * Route detail page: the day's "worst bus" ranking, a route map, and stops.
 * Day-focused like the home page: shows today, falling back to the most recent
 * day with data when today is empty.
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
  const parsed = routeStatsQuery.safeParse(sp);
  const thresholdSec = (parsed.success ? parsed.data : routeStatsQuery.parse({})).thresholdSec;

  // Today (Auckland); fall back to the most recent day with data when empty.
  let range: DateRange = nzDayRange();
  let dayLabel = "today";
  let stats = await getRouteStats({ routeId: id, from: range.start, to: range.end, thresholdSec });
  if ((stats.summary?.events ?? 0) === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzDayRange(latestDay);
      dayLabel = dayLabelFor(range.start);
      stats = await getRouteStats({ routeId: id, from: range.start, to: range.end, thresholdSec });
    }
  }
  const { route, summary, byStop } = stats;

  const [trips, view] = await Promise.all([
    getWorstTripsOfDay({ routeId: id, range, thresholdSec }),
    buildRouteView(id, byStop),
  ]);
  const delayByStop = new Map(byStop.map((s) => [s.stop_id, s.avg_delay_sec]));

  const title = route?.shortName ?? id;
  const colour = linkColour(route?.shortName, route?.longName);

  return (
    <main className={cn("space-y-6")}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-3 text-3xl leading-headline font-ultra tracking-zero">
            {colour && (
              <span
                aria-hidden="true"
                className={cn("inline-block h-4 w-4 shrink-0 rounded-full", colour)}
              />
            )}
            {title}
          </h1>
          {route?.longName && <p className="text-at-muted">{route.longName}</p>}
        </div>
        <span className={cn("text-sm text-at-muted")}>Showing {dayLabel}</span>
      </header>

      <section className={cn("grid grid-cols-2 gap-4 sm:grid-cols-4")}>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">Events</p>
          <p className="text-2xl font-semibold tabular-nums">{summary?.events ?? 0}</p>
        </div>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">Trips</p>
          <p className="text-2xl font-semibold tabular-nums">{trips.length}</p>
        </div>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">Avg delay</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary?.avg_delay_sec == null ? "—" : formatDelay(summary.avg_delay_sec)}
          </p>
        </div>
        <div className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <p className="text-sm text-at-muted">On-time (%)</p>
          <p className="text-2xl font-semibold tabular-nums">
            {summary?.on_time_pct?.toFixed(1) ?? "—"}
          </p>
        </div>
      </section>

      <WorstTripsBoard routeId={id} trips={trips} thresholdSec={thresholdSec} />

      {view.stops.length > 0 && (
        <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Route map</h2>
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
            stops={view.stops}
            routeLines={view.routeLines}
            routeId={id}
            className="h-100 rounded-lg"
          />
        </section>
      )}

      {Object.keys(view.directions).length > 0 && (
        <RouteLineDiagram
          directions={view.directions}
          delayByStop={delayByStop}
          nameByStop={view.nameByStop}
          thresholdSec={thresholdSec}
        />
      )}

      {byStop.length > 0 && (
        <details className={cn("rounded-xl bg-at-surface shadow-sm")}>
          <summary className={cn("cursor-pointer px-4 py-3 font-semibold")}>Stops</summary>
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
                  <tr key={s.stop_id} className="border-t border-at-border">
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.events}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.avg_delay_sec == null ? "—" : formatDelay(s.avg_delay_sec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </main>
  );
}
