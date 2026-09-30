// src/app/operator/[slug]/page.tsx
// One operator: how its routes ran over a day, week or month, the routes
// themselves, and the vehicles that ran them. Built from the same per-route and
// per-vehicle rows as the Operators, Routes and Vehicles pages, so every figure
// here matches the row it links back to.

import { RangeControls } from "@/components/date/RangeControls";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { ChevronLeft } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { SchoolAdded } from "@/components/SchoolAdded";
import { SortHeader } from "@/components/SortHeader";
import { VehicleLiveBadge } from "@/components/VehicleLiveBadge";
import {
  getCancelledRoutes,
  getEarliestDataDay,
  getLatestEventDate,
  getOperators,
  getRankings,
  getRouteOperators,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { readFallback } from "@/lib/db";
import { getLiveVehicleMap } from "@/lib/feed/vehicles";
import {
  formatCount,
  formatDuration,
  formatHours,
  formatPct,
  plural,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { operatorCodeOf, operatorRows, vehicleOperatorCodes } from "@/lib/operator-stats";
import { operatorBySlug, type Operator } from "@/lib/operators";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/page/range";
import {
  keepSort,
  sortRows,
  tableSort,
  type SortColumn,
  type SortParamNames,
} from "@/lib/page/table-sort";
import { routeSlug } from "@/lib/route/slug";
import { isSchoolBus, parseSchoolFilter, schoolAllows, schoolFilterParam } from "@/lib/school-bus";
import { getFleet, type FleetVehicle } from "@/lib/store/fleet";
import { clampDayParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import type { DateRange } from "@/lib/time/service-day";
import { buildHref, stripUnset } from "@/lib/utils";
import { sortVehicles, type VehicleTotal } from "@/lib/vehicle/rank";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX, ReactNode } from "react";

// Not yet converted to a prerendered shell: this segment reads its search
// params and its data above any Suspense boundary, so it is allowed to block.
export const instant = false;

/** Cache TTL for a week or month's rows (seconds), as on the Operators page. */
const PERIOD_REVALIDATE = 3600;

/** Vehicles listed before the link to the full, filtered Vehicles page. */
const FLEET_SHOWN = 10;

/** Query params for an operator page. */
interface OperatorSearchParams {
  window?: string;
  day?: string;
  period?: string;
  school?: string;
  /** The routes table's sorted column, and "1" to sort it the other way. */
  rsort?: string;
  rrev?: string;
  /** The vehicles table's sorted column, and "1" to sort it the other way. */
  vsort?: string;
  vrev?: string;
}

/** The routes table's sortable columns. */
const ROUTE_COLUMNS: SortColumn<OperatorRoute>[] = [
  { key: "route", value: "name", first: "asc" },
  { key: "ontime", value: "onTime" },
  { key: "off", value: "off" },
  { key: "arrivals", value: "events" },
  { key: "cancelled", value: "cancelled" },
];

/** The vehicles table's sortable columns; the sort picks the ten shown. */
const FLEET_COLUMNS: SortColumn<VehicleTotal>[] = [
  { key: "vehicle", value: "vehicleId", first: "asc" },
  { key: "hours", value: "serviceSec" },
  { key: "runs", value: "runs" },
  { key: "off", value: "avgOffSec" },
];

const ROUTE_SORT: SortParamNames = { sort: "rsort", rev: "rrev" };
const FLEET_SORT: SortParamNames = { sort: "vsort", rev: "vrev" };

/**
 * The operator a slug names, including one missing from the fixed table but
 * present in the route data.
 * @param slug - The `[slug]` segment.
 * @returns The operator, or null.
 */
async function resolveOperator(slug: string): Promise<Operator | null> {
  const [operators, directory] = await Promise.all([
    getRouteOperators().catch(readFallback<Record<string, string>>("route-operators", {})),
    getOperators().catch(readFallback<Operator[]>("operators", [])),
  ]);
  return operatorBySlug(slug, directory, new Set(Object.values(operators)));
}

/**
 * Tab title: the operator's name.
 * @param root0 - Page props.
 * @param root0.params - Route params (`slug`).
 * @returns The metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const op = await resolveOperator((await params).slug);
  if (!op) return { title: "Operator not found" };
  return {
    title: op.name,
    description: `How the Auckland routes ${op.name} runs for AT kept to the timetable, and the vehicles that ran them.`,
  };
}

/**
 * Operator page.
 * @param root0 - Page props.
 * @param root0.params - Route params (`slug`).
 * @param root0.searchParams - Window (`window`, `day`, `period`), `school`, and each table's sort.
 * @returns Page markup.
 */
export default async function OperatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<OperatorSearchParams>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const op = await resolveOperator(slug);
  if (!op) notFound();
  const basePath = `/operator/${op.slug}`;
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  if (window === "day") {
    clampDayParam(basePath, sp, today);
    dropTodayParam(basePath, sp, today);
  }
  const schools = parseSchoolFilter(sp.school);
  const filter = { mode: null, schools };
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let nav: RangeNav;
  let dayParam: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    nav = dayRangeNav(day, earliest, today);
    dayParam = nav.isToday ? undefined : day.serviceDate;
  } else {
    ({ range, period, nav } = periodRangeNav(
      basePath,
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
      today,
    ));
  }
  const revalidate = window === "day" ? TODAY_REVALIDATE : PERIOD_REVALIDATE;

  // With school services included, the same reads without them too, so each
  // figure can show the "+N" they add.
  const withoutSchool = { mode: null, schools: "exclude" as const };
  const [allRows, operators, directory, cancelledRoutes, vehicles, cancelledBase, vehiclesBase] =
    await Promise.all([
      getRankings(range, ON_TIME_LATE_SEC, revalidate),
      getRouteOperators(),
      getOperators().catch(readFallback<Operator[]>("operators", [])),
      getCancelledRoutes(range, filter, 10_000, revalidate),
      getVehicleWork(range, filter, TODAY_REVALIDATE),
      schools === "include" ? getCancelledRoutes(range, withoutSchool, 10_000, revalidate) : null,
      schools === "include" ? getVehicleWork(range, withoutSchool, TODAY_REVALIDATE) : null,
    ]);
  const rows = allRows.filter((r) => schoolAllows(schools, isSchoolBus(r.shortName, r.longName)));
  const cancelled = new Map(cancelledRoutes.map((c) => [c.slug, c.cancelled]));
  const table = operatorRows(rows, operators, cancelled, vehicles, directory);
  const rank = table.findIndex((o) => o.operator.code === op.code);
  const mine = rank === -1 ? null : table[rank]!;
  const base =
    cancelledBase && vehiclesBase
      ? (operatorRows(
          allRows.filter((r) => !isSchoolBus(r.shortName, r.longName)),
          operators,
          new Map(cancelledBase.map((c) => [c.slug, c.cancelled])),
          vehiclesBase,
          directory,
        ).find((o) => o.operator.code === op.code) ?? null)
      : null;
  /**
   * What school services added to one of the operator's figures: all of it when
   * it ran only school services, nothing while they are left out.
   * @param key - The count.
   * @returns The amount added.
   */
  const added = (key: "events" | "cancelled" | "vehicles"): number =>
    schools === "include" && mine ? (mine[key] ?? 0) - (base?.[key] ?? 0) : 0;

  // Its routes, one line per slug, then any route that only cancelled. A route
  // republished mid-window carries two feed versions; their figures are weighted
  // together by arrivals, as the operator's own are.
  const routes = new Map<string, OperatorRoute>();
  for (const r of rows) {
    if (operatorCodeOf(r.routeId, operators) !== op.code) continue;
    const s = routeSlug(r.routeId);
    const prev = routes.get(s);
    const events = r.events + (prev?.events ?? 0);
    routes.set(s, {
      slug: s,
      name: r.shortName ?? s,
      long: r.longName,
      mode: r.mode,
      colour: r.colour,
      events,
      onTime: weigh(prev?.onTime, prev?.events ?? 0, r.on_time_pct, r.events),
      off: weigh(prev?.off, prev?.events ?? 0, r.avg_abs_delay_sec, r.events),
      cancelled: cancelled.get(s) ?? 0,
    });
  }
  for (const c of cancelledRoutes) {
    if (operators[c.slug] !== op.code || routes.has(c.slug)) continue;
    routes.set(c.slug, {
      slug: c.slug,
      name: c.shortName ?? c.slug,
      long: c.longName ?? "",
      mode: c.mode,
      colour: c.colour,
      events: 0,
      onTime: null,
      off: null,
      cancelled: c.cancelled,
    });
  }
  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  const school = schoolFilterParam(schools);
  // Each table's heading links carry the other table's sort, so sorting one
  // leaves the other as it was.
  const routeKeep = keepSort(sp, ROUTE_COLUMNS, "arrivals", ROUTE_SORT);
  const fleetKeep = keepSort(sp, FLEET_COLUMNS, "hours", FLEET_SORT);
  const routeSort = tableSort(
    sp,
    ROUTE_COLUMNS,
    "arrivals",
    (p) => buildHref(basePath, { ...view, school, ...fleetKeep, ...p }),
    ROUTE_SORT,
  );
  const fleetSort = tableSort(
    sp,
    FLEET_COLUMNS,
    "hours",
    (p) => buildHref(basePath, { ...view, school, ...routeKeep, ...p }),
    FLEET_SORT,
  );
  const routeList = sortRows(
    [...routes.values()].sort((a, b) => a.name.localeCompare(b.name, "en-NZ", { numeric: true })),
    ROUTE_COLUMNS,
    routeSort.sort,
  );

  const fleetAll = sortRows(
    sortVehicles(
      vehicles.filter((v) => vehicleOperatorCodes(v, operators).includes(op.code)),
      "hours",
    ),
    FLEET_COLUMNS,
    fleetSort.sort,
  );
  const fleetShown = fleetAll.slice(0, FLEET_SHOWN);
  const live = getLiveVehicleMap();
  const fleet = await getFleet(fleetShown.map((v) => v.vehicleId)).catch(
    readFallback("fleet", new Map<string, FleetVehicle>()),
  );

  const routeQuery = routeLinkQuery(window, dayParam, period);
  const schoolPreserved = stripUnset({ ...view, ...routeKeep, ...fleetKeep });

  return (
    <main className="space-y-6">
      <Link
        href={buildHref("/operators", { ...view, school })}
        className="inline-flex items-center gap-1 text-sm text-at-shore hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All operators
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
            {mine?.modes.map((m) => (
              <ModeIcon key={m} mode={m} className="h-7 w-7" />
            ))}
            {op.name}
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">
            Runs {plural(routeList.length, "route")} for AT in this period.
          </p>
        </div>
        <RangeControls basePath={basePath} nav={nav} />
      </header>

      {/* Only for an operator that ran a school service in the window. */}
      <SchoolBusToggle value={schools} basePath={basePath} preservedParams={schoolPreserved} />

      {mine ? (
        <dl className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="On time">{formatPct(mine.on_time_pct)}</Figure>
          <Figure label="Avg off">
            {mine.avg_abs_delay_sec === null
              ? UNKNOWN_VALUE
              : formatDuration(mine.avg_abs_delay_sec)}
          </Figure>
          <Figure label="Arrivals">
            {formatCount(mine.events)}
            <SchoolAdded n={added("events")} />
          </Figure>
          <Figure label="Cancelled">
            {formatCount(mine.cancelled)}
            <SchoolAdded n={added("cancelled")} />
          </Figure>
          <Figure label="Vehicles">
            {formatCount(mine.vehicles ?? 0)}
            <SchoolAdded n={added("vehicles")} />
          </Figure>
          <Figure label="Operators">
            <Link
              href={buildHref("/operators", { ...view, school })}
              className="text-at-shore hover:underline"
            >
              #{rank + 1}
            </Link>
            <span className="ml-1 text-sm font-normal text-at-muted">of {table.length}</span>
          </Figure>
        </dl>
      ) : (
        <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
          Nothing recorded for {op.name} in this period.
        </div>
      )}

      {routeList.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its routes</h2>
            <Link
              href={buildHref("/routes", { ...view, school, op: op.slug })}
              className="text-sm text-at-shore hover:underline"
            >
              Filter the routes page to {op.name}
            </Link>
          </div>
          <div className="overflow-x-auto border border-at-border bg-at-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                  <SortHeader {...routeSort.head("route")} align="left">
                    Route
                  </SortHeader>
                  <SortHeader {...routeSort.head("ontime")}>On time</SortHeader>
                  <SortHeader {...routeSort.head("off")}>Avg off</SortHeader>
                  <SortHeader {...routeSort.head("arrivals")} className="hidden sm:table-cell">
                    Arrivals
                  </SortHeader>
                  <SortHeader {...routeSort.head("cancelled")} className="hidden sm:table-cell">
                    Cancelled
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {routeList.map((r) => (
                  <tr key={r.slug} className="border-b border-at-border last:border-b-0">
                    <th scope="row" className="p-3 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <ModeIcon
                          mode={r.mode}
                          colour={r.colour}
                          shortName={r.name}
                          longName={r.long}
                          className="h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0">
                          <Link
                            href={`/route/${encodeURIComponent(r.slug)}${routeQuery}`}
                            className="font-semibold text-at-shore hover:underline"
                          >
                            {r.name}
                          </Link>
                          {r.long && r.long !== r.name && (
                            <span className="block truncate text-xs text-at-muted">{r.long}</span>
                          )}
                        </span>
                      </span>
                    </th>
                    <td className="p-3 text-right tabular-nums">{formatPct(r.onTime)}</td>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">
                      {r.off === null ? UNKNOWN_VALUE : formatDuration(r.off)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {formatCount(r.events)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {formatCount(r.cancelled)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {fleetShown.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its vehicles</h2>
            <Link
              href={buildHref("/vehicles", { ...view, school, op: op.slug })}
              className="text-sm text-at-shore hover:underline"
            >
              All {formatCount(fleetAll.length)} on the vehicles board
            </Link>
          </div>
          <div className="overflow-x-auto border border-at-border bg-at-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                  <SortHeader {...fleetSort.head("vehicle")} align="left">
                    Vehicle
                  </SortHeader>
                  <SortHeader {...fleetSort.head("hours")}>In service</SortHeader>
                  <SortHeader {...fleetSort.head("runs")}>Runs</SortHeader>
                  <SortHeader {...fleetSort.head("off")} className="hidden sm:table-cell">
                    Avg off
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {fleetShown.map((v) => (
                  <tr key={v.vehicleId} className="border-b border-at-border last:border-b-0">
                    <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <ModeIcon mode={v.mode} className="h-4 w-4" />
                        <Link
                          href={buildHref(`/vehicle/${v.vehicleId}`, { ...view, op: op.slug })}
                          className="text-at-shore hover:underline"
                        >
                          {fleet.get(v.vehicleId)?.label ?? (
                            <span className="tabular-nums">{v.vehicleId}</span>
                          )}
                        </Link>
                        <VehicleLiveBadge vehicleId={v.vehicleId} live={live} />
                      </span>
                    </th>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">
                      {formatHours(v.serviceSec)}
                    </td>
                    <td className="p-3 text-right tabular-nums">{formatCount(v.runs)}</td>
                    <td className="hidden p-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                      {formatDuration(v.avgOffSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-at-muted">
        On time and the average are weighted by how many arrivals each route recorded. A route
        counts as {op.name}&apos;s when AT&apos;s timetable feed names it as the operator of the
        route&apos;s newest version; a vehicle counts when it ran any of those routes.
      </p>
    </main>
  );
}

/** One of the operator's routes, as its table lists it. */
interface OperatorRoute {
  slug: string;
  name: string;
  long: string;
  mode: string;
  colour?: string | null;
  events: number;
  onTime: number | null;
  off: number | null;
  cancelled: number;
}

/**
 * Two feed versions' figure for one route, weighted by their arrivals.
 * @param a - The figure so far, if any.
 * @param aEvents - Arrivals behind it.
 * @param b - The next version's figure.
 * @param bEvents - Arrivals behind that.
 * @returns The weighted figure, or whichever one exists.
 */
function weigh(
  a: number | null | undefined,
  aEvents: number,
  b: number | null,
  bEvents: number,
): number | null {
  if (a == null || aEvents === 0) return b;
  if (b === null || bEvents === 0) return a;
  return (a * aEvents + b * bEvents) / (aEvents + bEvents);
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
