// src/app/vehicle/[id]/page.tsx
// One vehicle: what it is, where it is now, and how hard it was worked over a
// day, week or month - its runs on a day, or its days across a week or month.

import { ChevronLeft } from "@/components/icons";
import { MapMarkKey, StopDotKey } from "@/components/MapLegend";
import { ModeIcon } from "@/components/ModeIcon";
import { RangeControls } from "@/components/RangeControls";
import StopMapWrapper from "@/components/StopMapWrapper";
import { TRAIN_COUNT_NOTE } from "@/components/VehiclesSection";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getRouteNames,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
  getVehicleRunsOfDay,
  getVehicleWorkByDay,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { getRouteModeMap } from "@/lib/data/routes";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { getFleet, type FleetVehicle } from "@/lib/fleet-store";
import {
  formatDuration,
  formatHours,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/range-page";
import { routeSlug } from "@/lib/route-slug";
import {
  nzClockTime,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDayLabel,
  type DateRange,
} from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { VehicleMode } from "@/lib/vehicle-counts";
import {
  liveRunHref,
  occupancyLabel,
  runFigures,
  VEHICLE_ID,
  vehicleName,
  vehicleRank,
  type VehicleRunRow,
} from "@/lib/vehicle-detail";
import { mergeVehicleDays, sortVehicles, type VehicleDayRow } from "@/lib/vehicle-rank";
import { vehicleStatus } from "@/lib/vehicle-status";
import { getLiveVehicleMap, type LiveVehicle } from "@/lib/vehicles";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX, ReactNode } from "react";

const MODE_NAME: Record<VehicleMode, string> = { BUS: "Bus", TRAIN: "Train", FERRY: "Ferry" };

/** Text colour for a live status band; no live delay stays muted. */
const STATUS_CLASS = {
  late: "text-at-late",
  early: "text-at-early-strong",
  ontime: "text-at-ontime",
  unknown: "text-at-muted",
} as const;

/** Query params for a vehicle page. */
interface VehicleSearchParams {
  window?: string;
  day?: string;
  period?: string;
}

/**
 * Tab title: the vehicle's fleet label, from the register or the live feed.
 * @param root0 - Page props.
 * @param root0.params - Route params (`id`).
 * @returns The metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!VEHICLE_ID.test(id)) return { title: "Vehicle not found" };
  const [fleet, live] = await Promise.all([
    getFleet([id]).catch(() => new Map<string, FleetVehicle>()),
    getLiveVehicleMap(),
  ]);
  const name = vehicleName(fleet.get(id)?.label ?? live.get(id)?.label, id);
  return {
    title: name,
    description: `${name}: where it is now and how hard it was worked, run by run.`,
  };
}

/**
 * Vehicle page.
 * @param root0 - Page props.
 * @param root0.params - Route params (`id`, the feed vehicle id).
 * @param root0.searchParams - Window (`window`, `day`, `period`).
 * @returns Page markup.
 */
export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<VehicleSearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  if (!VEHICLE_ID.test(id)) notFound();
  const basePath = `/vehicle/${id}`;
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window === "day") {
    clampDayParam(basePath, sp);
    dropTodayParam(basePath, sp);
  }
  // Every mode and school runs too, so a school bus's own page is not empty; the
  // rank is then against that board, which the rank links to.
  const filter = { mode: null, includeSchool: true };
  const [latest, earliest, fleet, live, modeOf] = await Promise.all([
    getLatestEventDate(),
    getEarliestDataDay(1),
    getFleet([id]).catch(() => new Map<string, FleetVehicle>()),
    getLiveVehicleMap(),
    getRouteModeMap(),
  ]);

  let range: DateRange;
  let nav: RangeNav;
  let days: { date: string; rows: VehicleDayRow[] }[];
  let dayParam: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day));
    range = day.range;
    days = await getVehicleWorkByDay(range, filter, TODAY_REVALIDATE);
    nav = dayRangeNav(day, earliest);
    dayParam = nav.isToday ? undefined : day.serviceDate;
  } else {
    ({ range, period, nav } = periodRangeNav(
      basePath,
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
    ));
    days = await getVehicleWorkByDay(range, filter, TODAY_REVALIDATE);
  }

  const board = sortVehicles(mergeVehicleDays(days.map((d) => d.rows)), "hours");
  const total = board.find((v) => v.vehicleId === id) ?? null;
  const register = fleet.get(id);
  const now = live.get(id);
  if (!total && !register && !now) notFound();

  const serviceDate = nzServiceDayString(range.start);
  const runs =
    window === "day" && total ? await getVehicleRunsOfDay(id, serviceDate, TODAY_REVALIDATE) : [];
  const liveMode = now ? modeOf.get(now.routeId) : undefined;
  const mode = total?.mode ?? liveMode ?? null;
  const routeIds = [
    ...new Set([
      ...(total?.routes ?? []),
      ...runs.map((r) => r.routeId),
      ...(now ? [now.routeId] : []),
    ]),
  ];
  const [names, liveMap] = await Promise.all([
    getRouteNames(routeIds),
    now?.tripId ? liveRunMap(now.routeId, now.tripId) : Promise.resolve(null),
  ]);
  const routeQuery = routeLinkQuery(window, dayParam, period);
  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  const rank = vehicleRank(board, id);
  const name = vehicleName(register?.label ?? now?.label, id);
  const plate = register?.plate ?? now?.plate ?? null;

  return (
    <main className="space-y-6">
      <Link
        href={buildHref("/vehicles", view)}
        className="inline-flex items-center gap-1 text-sm text-at-shore hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to hardest-worked vehicles
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
            {mode && <ModeIcon mode={mode} className="h-7 w-7" />}
            {name}
          </h1>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-at-muted">
            {mode && <span>{MODE_NAME[mode]}</span>}
            <span className="tabular-nums">Feed id {id}</span>
            {plate && <span>Plate {plate}</span>}
          </p>
        </div>
        <RangeControls basePath={basePath} nav={nav} />
      </header>

      <LiveCard now={now} register={register} mode={mode} names={names} />

      {now?.tripId && liveMap && (
        <section className="border border-at-border bg-at-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-ultra tracking-zero">Where it is now</h2>
            <StopDotKey />
          </div>
          <StopMapWrapper
            stops={liveMap.stops}
            routeLines={liveMap.path.length > 1 ? [liveMap.path] : []}
            routeId={routeSlug(now.routeId)}
            live
            filterTripId={now.tripId}
            mode={mode ?? undefined}
            className="h-100"
          />
          <MapMarkKey live offRoute={false} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its record</h2>
        {total ? (
          <dl className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-3 lg:grid-cols-5">
            <Figure label="In service">{formatHours(total.serviceSec)}</Figure>
            <Figure label="Runs">{total.runs.toLocaleString("en-NZ")}</Figure>
            <Figure label="Arrivals">{total.arrivals.toLocaleString("en-NZ")}</Figure>
            <Figure label="Avg off">{formatDuration(total.avgOffSec)}</Figure>
            {rank && (
              <Figure label="Hardest worked">
                <Link
                  href={buildHref("/vehicles", { ...view, school: "1" })}
                  className="text-at-shore hover:underline"
                >
                  #{rank.rank.toLocaleString("en-NZ")}
                </Link>
                <span className="ml-1 text-sm font-normal text-at-muted">
                  of {rank.of.toLocaleString("en-NZ")}
                </span>
              </Figure>
            )}
          </dl>
        ) : (
          <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
            No runs recorded for this vehicle in this period.
          </div>
        )}
        {total && (
          <p className="text-xs text-at-muted">
            Ranked by time in service against every vehicle that ran, school runs included.
            {mode === "TRAIN" && ` ${TRAIN_COUNT_NOTE}`}
          </p>
        )}
      </section>

      {window === "day"
        ? runs.length > 0 && (
            <RunsTable runs={runs} mode={mode ?? "BUS"} names={names} routeQuery={routeQuery} />
          )
        : total && <DaysTable days={days} id={id} basePath={basePath} />}
    </main>
  );
}

/** A stop as the map draws it. */
interface MapStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: null;
}

/**
 * The map for the run a vehicle is on now: its scheduled stops, the ones already
 * reached coloured by how late it was there, along the run's road path. Built
 * as the trip page builds its map, so the two show one run the same way.
 * @param routeId - The run's route id.
 * @param tripId - The run's trip id.
 * @returns The stops and path, or null when AT gave neither.
 */
async function liveRunMap(
  routeId: string,
  tripId: string,
): Promise<{ stops: MapStop[]; path: Array<[number, number]> } | null> {
  const [timeline, scheduled, shape] = await Promise.allSettled([
    getTripTimeline(tripId, routeSlug(routeId), nzServiceDayRange(new Date())),
    getTripScheduledStops(tripId),
    getTripShape(tripId),
  ]);
  const served = new Map(
    (timeline.status === "fulfilled" ? timeline.value.stops : []).map((s) => [s.stop_id, s]),
  );
  const planned = scheduled.status === "fulfilled" ? scheduled.value : [];
  // Without a schedule, the stops already reached are all there is to draw.
  const base = planned.length > 0 ? planned : [...served.values()];
  const stops: MapStop[] = base.map((s) => ({
    stop_id: s.stop_id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    avg_delay_sec: served.get(s.stop_id)?.deviation_sec ?? null,
    on_time_pct: null,
  }));
  const road = shape.status === "fulfilled" ? shape.value : [];
  const path = road.length > 1 ? road : stops.map((s): [number, number] => [s.lat, s.lon]);
  return stops.length === 0 && path.length < 2 ? null : { stops, path };
}

/**
 * One figure in the record strip.
 * @param root0 - Props.
 * @param root0.label - What it counts.
 * @param root0.children - The value.
 * @returns The term and its value.
 */
function Figure({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-zero text-at-muted uppercase">{label}</dt>
      <dd className="text-2xl font-ultra tracking-zero text-at-ink tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Where the vehicle is now: its run, how late, how full, how fast, or when it
 * was last seen when it is not on a run.
 * @param root0 - Props.
 * @param root0.now - The vehicle in the live feed, if it is in it.
 * @param root0.register - Its fleet register row, if any.
 * @param root0.mode - Its mode, for the on-time window.
 * @param root0.names - Route id > short name.
 * @returns The card.
 */
function LiveCard({
  now,
  register,
  mode,
  names,
}: {
  now: LiveVehicle | undefined;
  register: FleetVehicle | undefined;
  mode: VehicleMode | null;
  names: Record<string, string>;
}): JSX.Element {
  if (!now?.tripId) {
    const last = now?.seenAt ? new Date(now.seenAt * 1000) : register?.lastSeenAt;
    return (
      <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
        Not on a run right now.
        {last && ` Last seen ${lastSeenLabel(last)}.`}
      </div>
    );
  }
  const status = vehicleStatus(now.delaySec, mode ?? "BUS");
  const route = names[now.routeId] ?? routeSlug(now.routeId);
  const occupancy = occupancyLabel(now.occupancy);
  const facts: [string, string][] = [];
  if (occupancy) facts.push(["Occupancy", occupancy]);
  if (now.speedKmh != null) facts.push(["Speed", `${now.speedKmh} km/h`]);
  if (now.cars != null) facts.push(["Carriages", String(now.cars)]);
  if (now.odometerKm != null)
    facts.push(["Odometer", `${now.odometerKm.toLocaleString("en-NZ")} km`]);
  if (now.seenAt)
    facts.push(["Position at", nzClockTime(new Date(now.seenAt * 1000).toISOString())]);
  return (
    <section className="space-y-4 border border-at-border bg-at-surface px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-zero text-at-muted uppercase">
            <span className="rounded bg-at-ontime px-1.5 py-0.5 text-xs font-bold text-white">
              LIVE
            </span>
            On a run now
          </p>
          <p className="text-2xl font-ultra tracking-zero text-at-ink">
            Route{" "}
            <Link
              href={`/route/${encodeURIComponent(routeSlug(now.routeId))}`}
              className="text-at-shore hover:underline"
            >
              {route}
            </Link>
          </p>
          <p className={cn("text-sm font-semibold", STATUS_CLASS[status.band])}>{status.detail}</p>
        </div>
        <Link
          href={liveRunHref({ routeId: now.routeId, tripId: now.tripId })}
          className="chip chip-on"
        >
          Open this run
        </Link>
      </div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs tracking-zero text-at-muted uppercase">{label}</dt>
              <dd className="text-sm font-semibold text-at-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * When a vehicle was last seen: a clock time today, else the day and time.
 * @param at - The sighting.
 * @returns The label.
 */
function lastSeenLabel(at: Date): string {
  const time = nzClockTime(at.toISOString());
  const day = nzServiceDayString(at);
  return day === nzServiceDayString() ? `at ${time}` : `${serviceDayLabel(day)}, ${time}`;
}

/**
 * The day's runs, earliest first, each linking to its trip page.
 * @param root0 - Props.
 * @param root0.runs - The runs.
 * @param root0.mode - The vehicle's mode, for the on-time window.
 * @param root0.names - Route id > short name.
 * @param root0.routeQuery - The route-page query for the window shown, with its `?`.
 * @returns The table.
 */
function RunsTable({
  runs,
  mode,
  names,
  routeQuery,
}: {
  runs: VehicleRunRow[];
  mode: VehicleMode;
  names: Record<string, string>;
  routeQuery: string;
}): JSX.Element {
  const showCars = runs.some((r) => r.cars != null);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its runs</h2>
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <th scope="col" className="p-3 font-semibold">
                Start
              </th>
              <th scope="col" className="p-3 font-semibold">
                Route
              </th>
              <th scope="col" className="p-3 text-right font-semibold">
                Length
              </th>
              <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                Arrivals
              </th>
              {showCars && (
                <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                  Cars
                </th>
              )}
              <th scope="col" className="p-3 text-right font-semibold">
                Off schedule
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const f = runFigures(r);
              const off = offScheduleValue(f.avgSec, f.avgAbsSec, mode);
              const start = new Date(r.startMs).toISOString();
              const route = names[r.routeId] ?? routeSlug(r.routeId);
              return (
                <tr key={r.tripId} className="border-b border-at-border last:border-b-0">
                  <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                    <Link
                      href={`/route/${encodeURIComponent(routeSlug(r.routeId))}/trip/${encodeURIComponent(r.tripId)}?d=${encodeURIComponent(start)}`}
                      className="text-at-shore tabular-nums hover:underline"
                    >
                      {nzClockTime(start)}
                    </Link>
                  </th>
                  <td className="p-3">
                    <Link
                      href={`/route/${encodeURIComponent(routeSlug(r.routeId))}${routeQuery}`}
                      className="font-semibold text-at-shore hover:underline"
                    >
                      {route}
                    </Link>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {formatHours(f.durationSec)}
                  </td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">{r.e}</td>
                  {showCars && (
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {r.cars ?? UNKNOWN_VALUE}
                    </td>
                  )}
                  <td
                    className={cn(
                      "p-3 text-right whitespace-nowrap tabular-nums",
                      OFF_SCHEDULE_TONE_CLASS[off.tone],
                    )}
                  >
                    {off.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-at-muted">
        Length runs from the first recorded stop to the last. Off schedule is the average over the
        run&apos;s recorded stops.
      </p>
    </section>
  );
}

/**
 * The vehicle's days across a week or month, each linking to that day's runs. A
 * day it did not run stays in the table, so a gap reads as a gap.
 * @param root0 - Props.
 * @param root0.days - Every day's rows, oldest first.
 * @param root0.id - The vehicle.
 * @param root0.basePath - This page's path.
 * @returns The table.
 */
function DaysTable({
  days,
  id,
  basePath,
}: {
  days: { date: string; rows: VehicleDayRow[] }[];
  id: string;
  basePath: string;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Day by day</h2>
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <th scope="col" className="p-3 font-semibold">
                Day
              </th>
              <th scope="col" className="p-3 text-right font-semibold">
                In service
              </th>
              <th scope="col" className="p-3 text-right font-semibold">
                Runs
              </th>
              <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                Arrivals
              </th>
              <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                Avg off
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ date, rows }) => {
              const row = rows.find((r) => r.v === id);
              return (
                <tr key={date} className="border-b border-at-border last:border-b-0">
                  <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                    {row ? (
                      <Link
                        href={buildHref(basePath, {
                          day: date === nzServiceDayString() ? undefined : date,
                        })}
                        className="text-at-shore hover:underline"
                      >
                        {serviceDayLabel(date)}
                      </Link>
                    ) : (
                      <span className="text-at-muted">{serviceDayLabel(date)}</span>
                    )}
                  </th>
                  {row ? (
                    <>
                      <td className="p-3 text-right whitespace-nowrap tabular-nums">
                        {formatHours(row.s)}
                      </td>
                      <td className="p-3 text-right tabular-nums">{row.r}</td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">{row.e}</td>
                      <td className="hidden p-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                        {formatDuration(row.e > 0 ? row.a / row.e : 0)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="p-3 text-right text-at-muted">
                      Did not run
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
