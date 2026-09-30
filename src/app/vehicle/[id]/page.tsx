// src/app/vehicle/[id]/page.tsx
// One vehicle: what it is, where it is now, and how hard it was worked over a
// day, week or month - its runs on a day, or its days across a week or month.

import { RangeControls } from "@/components/date/RangeControls";
import { ChevronLeft } from "@/components/icons";
import { MapMarkKey, StopDotKey } from "@/components/map/MapLegend";
import StopMapWrapper from "@/components/map/StopMapWrapper";
import { ModeIcon } from "@/components/ModeIcon";
import { SortHeader } from "@/components/SortHeader";
import { TRAIN_COUNT_NOTE } from "@/components/VehiclesSection";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getOperators,
  getRouteNames,
  getRouteOperators,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
  getVehicleDayMap,
  getVehicleRunsOfDay,
  getVehicleWorkByDay,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { getRouteModeMap } from "@/lib/data/routes";
import { readFallback } from "@/lib/db";
import { getLiveVehicleMap, type LiveVehicle } from "@/lib/feed/vehicles";
import {
  formatDuration,
  formatHours,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { MODE_NAME, type Mode } from "@/lib/mode";
import { vehicleOperatorCodes } from "@/lib/operator-stats";
import { operatorHref, operatorOf, type Operator } from "@/lib/operators";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/page/range";
import { sortRows, tableSort, type SortColumn, type SortParamNames } from "@/lib/page/table-sort";
import { routeSlug } from "@/lib/route/slug";
import { getFleet, type FleetVehicle } from "@/lib/store/fleet";
import { clampDayParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import {
  nzClockTime,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDayLabel,
  type DateRange,
} from "@/lib/time/service-day";
import { buildHref } from "@/lib/utils";
import {
  liveRunHref,
  occupancyLabel,
  runFigures,
  VEHICLE_ID,
  vehicleName,
  vehicleRank,
  type VehicleRunRow,
} from "@/lib/vehicle/detail";
import { mergeVehicleDays, sortVehicles, type VehicleDayRow } from "@/lib/vehicle/rank";
import { vehicleStatus } from "@/lib/vehicle/status";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX, ReactNode } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

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
  /** The vehicles list's filters, sort and length, handed back by the back link. */
  mode?: string;
  school?: string;
  sort?: string;
  rev?: string;
  show?: string;
  op?: string;
  /** This page's own table (runs or days): its sorted column, and "1" to flip it. */
  tsort?: string;
  trev?: string;
}

/**
 * This page's table sorts on its own param names: `sort` and `rev` belong to the
 * vehicles list, handed back by the back link.
 */
const TABLE_SORT: SortParamNames = { sort: "tsort", rev: "trev" };

/** One run as its table sorts and shows it. */
interface RunLine extends VehicleRunRow {
  route: string;
  durationSec: number;
  avgSec: number;
  avgAbsSec: number;
}

const RUN_COLUMNS: SortColumn<RunLine>[] = [
  { key: "start", value: "startMs", first: "asc" },
  { key: "route", value: "route", first: "asc" },
  { key: "length", value: "durationSec" },
  { key: "arrivals", value: "e" },
  { key: "cars", value: "cars" },
  { key: "off", value: "avgAbsSec" },
];

/** One day as its table sorts and shows it; the figures are null on a day it did not run. */
interface DayLine {
  date: string;
  ran: boolean;
  serviceSec: number | null;
  runs: number | null;
  arrivals: number | null;
  offSec: number | null;
}

const DAY_COLUMNS: SortColumn<DayLine>[] = [
  { key: "day", value: "date" },
  { key: "hours", value: "serviceSec" },
  { key: "runs", value: "runs" },
  { key: "arrivals", value: "arrivals" },
  { key: "off", value: "offSec" },
];

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
    getFleet([id]).catch(readFallback("fleet", new Map<string, FleetVehicle>())),
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
 * @param root0.searchParams - Window (`window`, `day`, `period`), and the vehicles list's
 *   `mode`, `school`, `sort`, `rev`, `show` and `op` for the back link, and
 *   `tsort` and `trev` for its own table.
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
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  if (window === "day") {
    clampDayParam(basePath, sp, today);
    dropTodayParam(basePath, sp, today);
  }
  // Every mode and school runs too, so a school bus's own page is not empty; the
  // rank is then against that board, which the rank links to.
  const filter = { mode: null, schools: "include" as const };
  const [latest, earliest, fleet, live, modeOf, operators, directory] = await Promise.all([
    getLatestEventDate(),
    getEarliestDataDay(1),
    getFleet([id]).catch(readFallback("fleet", new Map<string, FleetVehicle>())),
    getLiveVehicleMap(),
    getRouteModeMap(),
    getRouteOperators().catch(readFallback<Record<string, string>>("route-operators", {})),
    getOperators().catch(readFallback<Operator[]>("operators", [])),
  ]);

  let range: DateRange;
  let nav: RangeNav;
  let days: { date: string; rows: VehicleDayRow[] }[];
  let dayParam: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    days = await getVehicleWorkByDay(range, filter, TODAY_REVALIDATE);
    nav = dayRangeNav(day, earliest, today);
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
  // The live run only belongs on the map of today; a past day shows that day alone.
  const liveOnMap = window === "day" && serviceDate === today && now?.tripId ? now : null;
  const [names, liveMap, dayMap] = await Promise.all([
    getRouteNames(routeIds),
    liveOnMap?.tripId ? liveRunMap(liveOnMap.routeId, liveOnMap.tripId) : Promise.resolve(null),
    window === "day" && total
      ? getVehicleDayMap(id, serviceDate, TODAY_REVALIDATE)
      : Promise.resolve(null),
  ]);
  const map = dayRunMap(dayMap, liveMap);
  const routeQuery = routeLinkQuery(window, dayParam, period);
  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  // How the vehicles list was left. Every link that stays on this vehicle
  // carries it, so the back link still returns to the list the reader came from
  // rather than to the default board.
  const listState = {
    mode: sp.mode,
    school: sp.school,
    sort: sp.sort,
    rev: sp.rev,
    show: sp.show,
    op: sp.op,
  };
  /**
   * This page with its own table's sort set, for that table's headings.
   * @param p - The sort params.
   * @returns The href.
   */
  const tableHref = (p: Record<string, string | undefined>): string =>
    buildHref(basePath, { ...view, ...listState, ...p });
  const runBy = vehicleOperatorCodes({ routes: routeIds }, operators).map((c) =>
    operatorOf(c, directory)!,
  );
  const rank = vehicleRank(board, id);
  const name = vehicleName(register?.label ?? now?.label, id);
  const plate = register?.plate ?? now?.plate ?? null;

  return (
    <main className="space-y-6">
      <Link
        href={buildHref("/vehicles", {
          ...view,
          ...listState,
        })}
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
            {runBy.length > 0 && (
              <span>
                Run by{" "}
                {runBy.map((op, i) => (
                  <span key={op.code}>
                    {i > 0 && " and "}
                    <Link
                      href={buildHref(operatorHref(op), view)}
                      className="text-at-shore hover:underline"
                    >
                      {op.name}
                    </Link>
                  </span>
                ))}
              </span>
            )}
          </p>
        </div>
        <RangeControls basePath={basePath} nav={nav} />
      </header>

      <LiveCard now={now} register={register} mode={mode} names={names} />

      {map && (
        <section className="border border-at-border bg-at-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-ultra tracking-zero">
              {serviceDate === today
                ? "Where it ran today"
                : `Where it ran on ${serviceDayLabel(serviceDate)}`}
            </h2>
            <StopDotKey noReading={liveMap !== null} />
          </div>
          <StopMapWrapper
            stops={map.stops}
            routeLines={map.lines}
            routeId={liveOnMap ? routeSlug(liveOnMap.routeId) : undefined}
            live={liveOnMap !== null}
            filterTripId={liveOnMap?.tripId ?? undefined}
            mode={mode ?? undefined}
            stopQuery={dayParam ? `?day=${dayParam}` : ""}
            className="h-[min(25rem,60svh)]"
          />
          <p className="mt-2 text-xs text-at-muted">
            Every run it made{serviceDate === today ? " so far" : ""}, with each stop coloured by
            how late it was there on average.
            {liveMap && " Stops still ahead on its current run have no reading yet."}
          </p>
          <MapMarkKey live={liveOnMap !== null} offRoute={false} />
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
            <RunsTable
              runs={runs}
              mode={mode ?? "BUS"}
              names={names}
              routeQuery={routeQuery}
              sp={sp}
              hrefFor={tableHref}
            />
          )
        : total && (
            <DaysTable
              days={days}
              id={id}
              basePath={basePath}
              listState={listState}
              sp={sp}
              hrefFor={tableHref}
            />
          )}
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
 * The day map: every run's road path and stop from the day's arrivals, with the
 * live run laid over it. The live run adds its whole planned path and the stops
 * it has yet to reach, which the arrivals cannot know about; a stop both lists
 * keeps the day's average, since that is what the map's colours describe.
 * @param day - Where the vehicle ran that day, or null off the day view.
 * @param live - The run it is on now, or null when it is not on one today.
 * @returns The stops and paths to draw, or null when there is nothing to draw.
 */
function dayRunMap(
  day: { stops: MapStop[]; lines: Array<Array<[number, number]>> } | null,
  live: { stops: MapStop[]; path: Array<[number, number]> } | null,
): { stops: MapStop[]; lines: Array<Array<[number, number]>> } | null {
  const stops = [...(day?.stops ?? [])];
  const seen = new Set(stops.map((s) => s.stop_id));
  for (const s of live?.stops ?? []) {
    if (!seen.has(s.stop_id)) stops.push(s);
  }
  const lines = [...(day?.lines ?? [])];
  if (live && live.path.length > 1) lines.push(live.path);
  return stops.length === 0 && lines.length === 0 ? null : { stops, lines };
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
  mode: Mode | null;
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
 * The day's runs, earliest first unless a heading re-sorts them, each linking
 * to its trip page.
 * @param root0 - Props.
 * @param root0.runs - The runs.
 * @param root0.mode - The vehicle's mode, for the on-time window.
 * @param root0.names - Route id > short name.
 * @param root0.routeQuery - The route-page query for the window shown, with its `?`.
 * @param root0.sp - The page's search params, for the table's sort.
 * @param root0.hrefFor - This page with the table's sort params set.
 * @returns The table.
 */
function RunsTable({
  runs,
  mode,
  names,
  routeQuery,
  sp,
  hrefFor,
}: {
  runs: VehicleRunRow[];
  mode: Mode;
  names: Record<string, string>;
  routeQuery: string;
  sp: VehicleSearchParams;
  hrefFor: (p: Record<string, string | undefined>) => string;
}): JSX.Element {
  const showCars = runs.some((r) => r.cars != null);
  const { sort, head } = tableSort(sp, RUN_COLUMNS, "start", hrefFor, TABLE_SORT);
  const lines = sortRows(
    runs.map((r) => ({ ...r, ...runFigures(r), route: names[r.routeId] ?? routeSlug(r.routeId) })),
    RUN_COLUMNS,
    sort,
  );
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its runs</h2>
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <SortHeader {...head("start")} align="left">
                Start
              </SortHeader>
              <SortHeader {...head("route")} align="left">
                Route
              </SortHeader>
              <SortHeader {...head("length")}>Length</SortHeader>
              <SortHeader {...head("arrivals")} className="hidden sm:table-cell">
                Arrivals
              </SortHeader>
              {showCars && (
                <SortHeader {...head("cars")} className="hidden sm:table-cell">
                  Cars
                </SortHeader>
              )}
              <SortHeader {...head("off")}>Off schedule</SortHeader>
            </tr>
          </thead>
          <tbody>
            {lines.map((r) => {
              const off = offScheduleValue(r.avgSec, r.avgAbsSec, mode);
              const start = new Date(r.startMs).toISOString();
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
                      {r.route}
                    </Link>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {formatHours(r.durationSec)}
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
 * The vehicle's days across a week or month, each linking to that day's runs,
 * newest first so the latest day tops the table. A day it did not run stays in
 * the table, so a gap reads as a gap.
 * @param root0 - Props.
 * @param root0.days - Every day's rows, oldest first.
 * @param root0.id - The vehicle.
 * @param root0.basePath - This page's path.
 * @param root0.listState - How the vehicles list was left, carried by each day's link.
 * @param root0.sp - The page's search params, for the table's sort.
 * @param root0.hrefFor - This page with the table's sort params set.
 * @returns The table.
 */
function DaysTable({
  days,
  id,
  basePath,
  listState,
  sp,
  hrefFor,
}: {
  days: { date: string; rows: VehicleDayRow[] }[];
  id: string;
  basePath: string;
  listState: Readonly<Record<string, string | undefined>>;
  sp: VehicleSearchParams;
  hrefFor: (p: Record<string, string | undefined>) => string;
}): JSX.Element {
  const { sort, head } = tableSort(sp, DAY_COLUMNS, "day", hrefFor, TABLE_SORT);
  const lines = sortRows(
    days.map(({ date, rows }): DayLine => {
      const row = rows.find((r) => r.v === id);
      return {
        date,
        ran: row !== undefined,
        serviceSec: row?.s ?? null,
        runs: row?.r ?? null,
        arrivals: row?.e ?? null,
        offSec: row ? (row.e > 0 ? row.a / row.e : 0) : null,
      };
    }),
    DAY_COLUMNS,
    sort,
  );
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Day by day</h2>
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
              <SortHeader {...head("day")} align="left">
                Day
              </SortHeader>
              <SortHeader {...head("hours")}>In service</SortHeader>
              <SortHeader {...head("runs")}>Runs</SortHeader>
              <SortHeader {...head("arrivals")} className="hidden sm:table-cell">
                Arrivals
              </SortHeader>
              <SortHeader {...head("off")} className="hidden sm:table-cell">
                Avg off
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ date, ran, serviceSec, runs, arrivals, offSec }) => {
              return (
                <tr key={date} className="border-b border-at-border last:border-b-0">
                  <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                    {ran ? (
                      <Link
                        href={buildHref(basePath, {
                          day: date === nzServiceDayString() ? undefined : date,
                          ...listState,
                        })}
                        className="text-at-shore hover:underline"
                      >
                        {serviceDayLabel(date)}
                      </Link>
                    ) : (
                      <span className="text-at-muted">{serviceDayLabel(date)}</span>
                    )}
                  </th>
                  {ran ? (
                    <>
                      <td className="p-3 text-right whitespace-nowrap tabular-nums">
                        {formatHours(serviceSec ?? 0)}
                      </td>
                      <td className="p-3 text-right tabular-nums">{runs}</td>
                      <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                        {arrivals}
                      </td>
                      <td className="hidden p-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                        {formatDuration(offSec ?? 0)}
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
