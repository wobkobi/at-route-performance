// src/app/vehicle/[id]/page.tsx
// One vehicle: what it is, where it is now, and how hard it was worked over a
// day, week or month - its runs on a day, or its days across a week or month.

import { RangeControls } from "@/components/date/RangeControls";
import { MapMarkKey, StopDotKey } from "@/components/map/MapLegend";
import StopMapWrapper from "@/components/map/StopMapWrapper";
import { ModeIcon } from "@/components/ModeIcon";
import { SortHeader } from "@/components/SortHeader";
import { BackLink } from "@/components/ui/BackLink";
import { LiveBadge } from "@/components/ui/Badge";
import { DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Figure, FigureStrip } from "@/components/ui/FigureStrip";
import { OffScheduleValue } from "@/components/ui/OffScheduleValue";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TRAIN_COUNT_NOTE } from "@/components/VehiclesSection";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getOperatorDirectory,
  getRouteNames,
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
  formatCount,
  formatDuration,
  formatHours,
  OFF_SCHEDULE_TONE_CLASS,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { MODE_NAME, type Mode } from "@/lib/mode";
import { vehicleOperatorCodes } from "@/lib/operator-stats";
import { operatorHref, operatorOf } from "@/lib/operators";
import { pickParams, VEHICLE_LIST_PARAMS } from "@/lib/page/filter-params";
import { routeHref, tripHref, vehicleHref, type LinkQuery } from "@/lib/page/hrefs";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  rangeViewParams,
  routeLinkParams,
  windowPhrase,
  type RangeNav,
} from "@/lib/page/range";
import { sortRows, tableSort, type SortColumn, type SortParamNames } from "@/lib/page/table-sort";
import { routeSlug } from "@/lib/route/slug";
import type { MapStop } from "@/lib/route/view";
import { getFleet, type FleetVehicle } from "@/lib/store/fleet";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { nzClockTime } from "@/lib/time/format";
import { requestServiceDay } from "@/lib/time/request-now";
import {
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
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

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
  const basePath = vehicleHref(id);
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
  const [latest, earliest, fleet, live, modeOf, [operators, directory]] = await Promise.all([
    getLatestEventDate(),
    getEarliestDataDay(1),
    getFleet([id]).catch(readFallback("fleet", new Map<string, FleetVehicle>())),
    getLiveVehicleMap(),
    getRouteModeMap(),
    getOperatorDirectory(),
  ]);

  let range: DateRange;
  let nav: RangeNav;
  let days: { date: string; rows: VehicleDayRow[] }[];
  let linkDay: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    days = await getVehicleWorkByDay(range, filter, TODAY_REVALIDATE);
    nav = dayRangeNav(day, earliest, today);
    linkDay = dayLinkParam(day.serviceDate, today);
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
    liveOnMap?.tripId
      ? liveRunMap(liveOnMap.routeId, liveOnMap.tripId, today)
      : Promise.resolve(null),
    window === "day" && total
      ? getVehicleDayMap(id, serviceDate, TODAY_REVALIDATE)
      : Promise.resolve(null),
  ]);
  const map = dayRunMap(dayMap, liveMap);
  const routeParams = routeLinkParams(window, linkDay, period);
  const view = rangeViewParams(window, linkDay, period);
  // How the vehicles list was left. Every link that stays on this vehicle
  // carries it, so the back link still returns to the list the reader came from
  // rather than to the default board.
  const listState = pickParams(sp, VEHICLE_LIST_PARAMS);
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
      <BackLink
        href={buildHref("/vehicles", { ...view, ...listState })}
        to="hardest-worked vehicles"
      />

      <PageHeader
        title={name}
        icon={mode && <ModeIcon mode={mode} className="h-7 w-7" />}
        actions={<RangeControls basePath={basePath} nav={nav} />}
      >
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
                  <Link href={buildHref(operatorHref(op), view)} className="at-link">
                    {op.name}
                  </Link>
                </span>
              ))}
            </span>
          )}
        </p>
      </PageHeader>

      <LiveCard now={now} register={register} mode={mode} names={names} today={today} />

      {map && (
        <Panel pad="sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionHeading>
              {serviceDate === today
                ? "Where it ran today"
                : `Where it ran on ${serviceDayLabel(serviceDate)}`}
            </SectionHeading>
            <StopDotKey noReading={liveMap !== null} />
          </div>
          <StopMapWrapper
            stops={map.stops}
            routeLines={map.lines}
            routeId={liveOnMap ? routeSlug(liveOnMap.routeId) : undefined}
            live={liveOnMap !== null}
            filterTripId={liveOnMap?.tripId ?? undefined}
            mode={mode ?? undefined}
            stopLinks
            stopDay={linkDay}
            className="h-[min(25rem,60svh)]"
          />
          <p className="mt-2 text-xs text-at-muted">
            Every run it made{serviceDate === today ? " so far" : ""}, with each stop coloured by
            how late it was there on average.
            {liveMap && " Stops still ahead on its current run have no reading yet."}
          </p>
          <MapMarkKey live={liveOnMap !== null} offRoute={false} />
        </Panel>
      )}

      <section className="space-y-3">
        <SectionHeading>Its record</SectionHeading>
        {total ? (
          <FigureStrip>
            <Figure label="In service">{formatHours(total.serviceSec)}</Figure>
            <Figure label="Runs">{formatCount(total.runs)}</Figure>
            <Figure label="Arrivals">{formatCount(total.arrivals)}</Figure>
            <Figure label="Avg off">{formatDuration(total.avgOffSec)}</Figure>
            {rank && (
              <Figure label="Hardest worked">
                <Link href={buildHref("/vehicles", { ...view, school: "1" })} className="at-link">
                  #{formatCount(rank.rank)}
                </Link>
                <span className="ml-1 text-sm font-normal text-at-muted">
                  of {formatCount(rank.of)}
                </span>
              </Figure>
            )}
          </FigureStrip>
        ) : (
          <EmptyState>No runs recorded for this vehicle {windowPhrase(nav, period)}.</EmptyState>
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
              routeParams={routeParams}
              sp={sp}
              hrefFor={tableHref}
              today={today}
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
              today={today}
            />
          )}
    </main>
  );
}

/**
 * The map for the run a vehicle is on now: its scheduled stops, the ones already
 * reached coloured by how late it was there, along the run's road path. Built
 * as the trip page builds its map, so the two show one run the same way.
 * @param routeId - The run's route id.
 * @param tripId - The run's trip id.
 * @param today - Today's service date, the day the live run is on.
 * @returns The stops and path, or null when AT gave neither.
 */
async function liveRunMap(
  routeId: string,
  tripId: string,
  today: string,
): Promise<{ stops: MapStop[]; path: Array<[number, number]> } | null> {
  const [timeline, scheduled, shape] = await Promise.allSettled([
    getTripTimeline(tripId, routeSlug(routeId), nzServiceDayRange(today)),
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
 * Where the vehicle is now: its run, how late, how full, how fast, or when it
 * was last seen when it is not on a run.
 * @param root0 - Props.
 * @param root0.now - The vehicle in the live feed, if it is in it.
 * @param root0.register - Its fleet register row, if any.
 * @param root0.mode - Its mode, for the on-time window.
 * @param root0.names - Route id > short name.
 * @param root0.today - Today's service date, for the last-seen label.
 * @returns The card.
 */
function LiveCard({
  now,
  register,
  mode,
  names,
  today,
}: {
  now: LiveVehicle | undefined;
  register: FleetVehicle | undefined;
  mode: Mode | null;
  names: Record<string, string>;
  today: string;
}): JSX.Element {
  if (!now?.tripId) {
    const last = now?.seenAt ? new Date(now.seenAt * 1000) : register?.lastSeenAt;
    return (
      <EmptyState>
        Not on a run right now.
        {last && ` Last seen ${lastSeenLabel(last, today)}.`}
      </EmptyState>
    );
  }
  const status = vehicleStatus(now.delaySec, mode ?? "BUS");
  const route = names[now.routeId] ?? routeSlug(now.routeId);
  const occupancy = occupancyLabel(now.occupancy);
  const facts: [string, string][] = [];
  if (occupancy) facts.push(["Occupancy", occupancy]);
  if (now.speedKmh != null) facts.push(["Speed", `${now.speedKmh} km/h`]);
  if (now.cars != null) facts.push(["Carriages", String(now.cars)]);
  if (now.odometerKm != null) facts.push(["Odometer", `${formatCount(now.odometerKm)} km`]);
  if (now.seenAt)
    facts.push(["Position at", nzClockTime(new Date(now.seenAt * 1000).toISOString())]);
  return (
    <Panel pad="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="at-eyebrow flex items-center gap-2 text-at-muted">
            <LiveBadge />
            On a run now
          </p>
          <p className="text-2xl font-ultra tracking-zero text-at-ink">
            Route{" "}
            <Link href={routeHref(now.routeId)} className="at-link">
              {route}
            </Link>
          </p>
          <p className={cn("text-sm font-semibold", OFF_SCHEDULE_TONE_CLASS[status.band])}>
            {status.detail}
          </p>
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
            <Figure key={label} label={label} size="sm" className="text-at-ink">
              {value}
            </Figure>
          ))}
        </dl>
      )}
    </Panel>
  );
}

/**
 * When a vehicle was last seen: a clock time today, else the day and time.
 * @param at - The sighting.
 * @param today - Today's service date.
 * @returns The label.
 */
function lastSeenLabel(at: Date, today: string): string {
  const time = nzClockTime(at.toISOString());
  const day = nzServiceDayString(at);
  return day === today ? `at ${time}` : `${serviceDayLabel(day)}, ${time}`;
}

/**
 * The day's runs, earliest first unless a heading re-sorts them, each linking
 * to its trip page.
 * @param root0 - Props.
 * @param root0.runs - The runs.
 * @param root0.mode - The vehicle's mode, for the on-time window.
 * @param root0.names - Route id > short name.
 * @param root0.routeParams - The route-page params for the window shown.
 * @param root0.sp - The page's search params, for the table's sort.
 * @param root0.hrefFor - This page with the table's sort params set.
 * @param root0.today - Today's service date, which each day's link leaves unnamed.
 * @returns The table.
 */
function RunsTable({
  runs,
  mode,
  names,
  routeParams,
  sp,
  hrefFor,
}: {
  runs: VehicleRunRow[];
  mode: Mode;
  names: Record<string, string>;
  routeParams: LinkQuery;
  sp: VehicleSearchParams;
  hrefFor: (p: Record<string, string | undefined>) => string;
  today: string;
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
      <SectionHeading>Its runs</SectionHeading>
      <DataTable caption="Each run that day">
        <thead>
          <tr className="at-th-row">
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
            const start = new Date(r.startMs).toISOString();
            return (
              <tr key={r.tripId} className={ROW_CLASS}>
                <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                  <Link
                    href={tripHref(r.routeId, r.tripId, start)}
                    className="text-at-shore tabular-nums hover:underline"
                  >
                    {nzClockTime(start)}
                  </Link>
                </th>
                <td className="p-3">
                  <Link href={routeHref(r.routeId, routeParams)} className="at-link font-semibold">
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
                <td className="p-3 text-right whitespace-nowrap">
                  <OffScheduleValue signedSec={r.avgSec} absSec={r.avgAbsSec} mode={mode} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
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
 * @param root0.today - Today's service date, which each day's link leaves unnamed.
 * @returns The table.
 */
function DaysTable({
  days,
  id,
  basePath,
  listState,
  sp,
  hrefFor,
  today,
}: {
  days: { date: string; rows: VehicleDayRow[] }[];
  id: string;
  basePath: string;
  listState: Readonly<Record<string, string>>;
  sp: VehicleSearchParams;
  hrefFor: (p: Record<string, string | undefined>) => string;
  today: string;
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
      <SectionHeading>Day by day</SectionHeading>
      <DataTable caption="Each day's time in service">
        <thead>
          <tr className="at-th-row">
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
              <tr key={date} className={ROW_CLASS}>
                <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                  {ran ? (
                    <Link
                      href={buildHref(basePath, {
                        day: dayLinkParam(date, today),
                        ...listState,
                      })}
                      className="at-link"
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
                    <td className="p-3 text-right tabular-nums">
                      {runs == null ? UNKNOWN_VALUE : formatCount(runs)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {arrivals == null ? UNKNOWN_VALUE : formatCount(arrivals)}
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
      </DataTable>
    </section>
  );
}
