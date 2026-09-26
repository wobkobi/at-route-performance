// src/app/operator/[slug]/page.tsx
// One operator: how its routes ran over a day, week or month, the routes
// themselves, and the vehicles that ran them. Built from the same per-route and
// per-vehicle rows as the Operators, Routes and Vehicles pages, so every figure
// here matches the row it links back to.

import { ChevronLeft } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { VehicleLiveBadge } from "@/components/VehicleLiveBadge";
import {
  getCancelledRoutes,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getRouteOperators,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { readFallback } from "@/lib/db";
import { getFleet, type FleetVehicle } from "@/lib/fleet-store";
import { formatDuration, formatHours } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { operatorCodeOf, operatorRows, vehicleOperatorCodes } from "@/lib/operator-stats";
import { operatorBySlug, type Operator } from "@/lib/operators";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/range-page";
import { requestServiceDay } from "@/lib/request-now";
import { routeSlug } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import type { DateRange } from "@/lib/time";
import { buildHref, stripUnset } from "@/lib/utils";
import { sortVehicles } from "@/lib/vehicle-rank";
import { getLiveVehicleMap } from "@/lib/vehicles";
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
}

/**
 * The operator a slug names, including one missing from the fixed table but
 * present in the route data.
 * @param slug - The `[slug]` segment.
 * @returns The operator, or null.
 */
async function resolveOperator(slug: string): Promise<Operator | null> {
  const operators = await getRouteOperators().catch(
    readFallback<Record<string, string>>("route-operators", {}),
  );
  return operatorBySlug(slug, new Set(Object.values(operators)));
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
 * @param root0.searchParams - Window (`window`, `day`, `period`) and `school`.
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
  if (window === "day") {
    clampDayParam(basePath, sp);
    dropTodayParam(basePath, sp);
  }
  const includeSchool = sp.school === "1";
  const filter = { mode: null, includeSchool };
  const [today, latest, earliest] = await Promise.all([
    requestServiceDay(),
    getLatestEventDate(),
    getEarliestDataDay(1),
  ]);

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

  const [allRows, operators, cancelledRoutes, vehicles] = await Promise.all([
    getRankings(range, ON_TIME_LATE_SEC, revalidate),
    getRouteOperators(),
    getCancelledRoutes(range, filter, 10_000, revalidate),
    getVehicleWork(range, filter, TODAY_REVALIDATE),
  ]);
  const rows = allRows.filter((r) => includeSchool || !isSchoolBus(r.short_name, r.long_name));
  const cancelled = new Map(cancelledRoutes.map((c) => [c.route_id, c.cancelled]));
  const table = operatorRows(rows, operators, cancelled, vehicles);
  const rank = table.findIndex((o) => o.operator.code === op.code);
  const mine = rank === -1 ? null : table[rank]!;

  // Its routes, one line per slug, then any route that only cancelled. A route
  // republished mid-window carries two feed versions; their figures are weighted
  // together by arrivals, as the operator's own are.
  const routes = new Map<string, OperatorRoute>();
  for (const r of rows) {
    if (operatorCodeOf(r.route_id, operators) !== op.code) continue;
    const s = routeSlug(r.route_id);
    const prev = routes.get(s);
    const events = r.events + (prev?.events ?? 0);
    routes.set(s, {
      slug: s,
      name: r.short_name ?? s,
      long: r.long_name,
      mode: r.mode,
      colour: r.colour,
      events,
      onTime: weigh(prev?.onTime, prev?.events ?? 0, r.on_time_pct, r.events),
      off: weigh(prev?.off, prev?.events ?? 0, r.avg_abs_delay_sec, r.events),
      cancelled: cancelled.get(s) ?? 0,
    });
  }
  for (const c of cancelledRoutes) {
    if (operators[c.route_id] !== op.code || routes.has(c.route_id)) continue;
    routes.set(c.route_id, {
      slug: c.route_id,
      name: c.short_name ?? c.route_id,
      long: c.long_name ?? "",
      mode: c.mode,
      colour: c.colour,
      events: 0,
      onTime: null,
      off: null,
      cancelled: c.cancelled,
    });
  }
  const routeList = [...routes.values()].sort(
    (a, b) => b.events - a.events || a.name.localeCompare(b.name, "en-NZ", { numeric: true }),
  );

  const fleetAll = sortVehicles(
    vehicles.filter((v) => vehicleOperatorCodes(v, operators).includes(op.code)),
    "hours",
  );
  const fleetShown = fleetAll.slice(0, FLEET_SHOWN);
  const live = getLiveVehicleMap();
  const fleet = await getFleet(fleetShown.map((v) => v.vehicleId)).catch(
    readFallback("fleet", new Map<string, FleetVehicle>()),
  );

  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  const school = includeSchool ? "1" : undefined;
  const routeQuery = routeLinkQuery(window, dayParam, period);
  const schoolPreserved = stripUnset(view);

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
            Runs {routeList.length === 1 ? "1 route" : `${routeList.length} routes`} for AT in this
            period.
          </p>
        </div>
        <RangeControls basePath={basePath} nav={nav} />
      </header>

      <SchoolBusToggle
        active={includeSchool}
        basePath={basePath}
        preservedParams={schoolPreserved}
      />

      {mine ? (
        <dl className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="On time">
            {mine.on_time_pct === null ? "-" : `${mine.on_time_pct.toFixed(1)}%`}
          </Figure>
          <Figure label="Avg off">
            {mine.avg_abs_delay_sec === null ? "-" : formatDuration(mine.avg_abs_delay_sec)}
          </Figure>
          <Figure label="Arrivals">{mine.events.toLocaleString("en-NZ")}</Figure>
          <Figure label="Cancelled">{mine.cancelled.toLocaleString("en-NZ")}</Figure>
          <Figure label="Vehicles">{(mine.vehicles ?? 0).toLocaleString("en-NZ")}</Figure>
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
          <h2 className="text-lg font-ultra tracking-zero text-at-ink">Its routes</h2>
          <div className="overflow-x-auto border border-at-border bg-at-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                  <th scope="col" className="p-3 font-semibold">
                    Route
                  </th>
                  <th scope="col" className="p-3 text-right font-semibold">
                    On time
                  </th>
                  <th scope="col" className="p-3 text-right font-semibold">
                    Avg off
                  </th>
                  <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                    Arrivals
                  </th>
                  <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                    Cancelled
                  </th>
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
                    <td className="p-3 text-right tabular-nums">
                      {r.onTime === null ? "-" : `${r.onTime.toFixed(1)}%`}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">
                      {r.off === null ? "-" : formatDuration(r.off)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {r.events.toLocaleString("en-NZ")}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {r.cancelled.toLocaleString("en-NZ")}
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
              All {fleetAll.length.toLocaleString("en-NZ")} on the vehicles board
            </Link>
          </div>
          <div className="overflow-x-auto border border-at-border bg-at-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                  <th scope="col" className="p-3 font-semibold">
                    Vehicle
                  </th>
                  <th scope="col" className="p-3 text-right font-semibold">
                    In service
                  </th>
                  <th scope="col" className="p-3 text-right font-semibold">
                    Runs
                  </th>
                  <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                    Avg off
                  </th>
                </tr>
              </thead>
              <tbody>
                {fleetShown.map((v) => (
                  <tr key={v.vehicleId} className="border-b border-at-border last:border-b-0">
                    <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        <ModeIcon mode={v.mode} className="h-4 w-4" />
                        <Link
                          href={buildHref(`/vehicle/${v.vehicleId}`, view)}
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
                    <td className="p-3 text-right tabular-nums">
                      {v.runs.toLocaleString("en-NZ")}
                    </td>
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
