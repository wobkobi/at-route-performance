// src/app/operators/page.tsx
// Operators: the companies AT contracts to run its routes, compared over a day,
// week or month. Folded from the Routes page's per-route rows (see
// lib/operator-stats.ts), so the table adds no query of its own beyond the
// fleet count the Vehicles page already caches.

import { RangeControls } from "@/components/date/RangeControls";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { ModeIcon } from "@/components/ModeIcon";
import { SchoolAdded } from "@/components/SchoolAdded";
import { SortHeader } from "@/components/SortHeader";
import { DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import {
  getCancelledByRoute,
  getEarliestDataDay,
  getLatestEventDate,
  getOperatorDirectory,
  getRankings,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { formatCount, formatDuration, formatPct, UNKNOWN_VALUE } from "@/lib/format";
import { parseMode } from "@/lib/mode";
import { pageMetadata } from "@/lib/og";
import { operatorRows, type OperatorRow } from "@/lib/operator-stats";
import { operatorHref } from "@/lib/operators";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  rangeViewParams,
  windowPhrase,
  type RangeNav,
} from "@/lib/page/range";
import { sortRows, tableSort, type SortColumn } from "@/lib/page/table-sort";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import {
  isSchoolBus,
  parseSchoolFilter,
  rowAllowedBySchool,
  schoolFilterParam,
} from "@/lib/school-bus";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import type { DateRange } from "@/lib/time/service-day";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment reads its search
// params and its data above any Suspense boundary, so it is allowed to block.
export const instant = false;

export const metadata: Metadata = pageMetadata({
  title: "Operators",
  description:
    "The companies that run Auckland's buses, trains and ferries for AT, compared on punctuality, cancellations and fleet.",
});

/** Cache TTL for a week or month's rows (seconds), as on the Routes page. */
const PERIOD_REVALIDATE = 3600;

/** Query params for the operators page. */
interface OperatorsSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
  /** The table's sorted column; absent is best on time first. */
  sort?: string;
  /** "1" sorts the column the other way. */
  rev?: string;
}

/**
 * An operator row's name, for the Operator column's sort.
 * @param o - The row.
 * @returns The operator's name.
 */
function operatorName(o: OperatorRow): string {
  return o.operator.name;
}

/** The table's sortable columns. */
const COLUMNS: SortColumn<OperatorRow>[] = [
  { key: "name", value: operatorName, first: "asc" },
  { key: "ontime", value: "on_time_pct" },
  { key: "off", value: "avg_abs_delay_sec" },
  { key: "routes", value: "routes" },
  { key: "vehicles", value: "vehicles" },
  { key: "arrivals", value: "events" },
  { key: "cancelled", value: "cancelled" },
];

/**
 * Operators page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`), filters (`mode`, `school`) and sort (`sort`, `rev`).
 * @returns Page markup.
 */
export default async function OperatorsPage({
  searchParams,
}: {
  searchParams?: Promise<OperatorsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  if (window === "day") {
    clampDayParam("/operators", sp, today);
    dropTodayParam("/operators", sp, today);
  }
  const mode = parseMode(sp.mode);
  const schools = parseSchoolFilter(sp.school);
  const filter = { mode, schools };
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let nav: RangeNav;
  let linkDay: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    nav = dayRangeNav(day, earliest, today);
    linkDay = dayLinkParam(day.serviceDate, today);
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/operators",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
      today,
    ));
  }
  const revalidate = window === "day" ? TODAY_REVALIDATE : PERIOD_REVALIDATE;

  // With school services included, the same reads without them too, so each
  // count can show the "+N" they add.
  const withoutSchool = { mode, schools: "exclude" as const };
  const [allRows, [operators, directory], cancelled, vehicles, cancelledBase, vehiclesBase] =
    await Promise.all([
      getRankings(range, revalidate),
      getOperatorDirectory(),
      getCancelledByRoute(range, filter, revalidate),
      getVehicleWork(range, filter, TODAY_REVALIDATE),
      schools === "include" ? getCancelledByRoute(range, withoutSchool, revalidate) : null,
      schools === "include" ? getVehicleWork(range, withoutSchool, TODAY_REVALIDATE) : null,
    ]);
  const modeRows = allRows.filter((r) => mode === null || r.mode === mode);
  const rows = modeRows.filter((r) => rowAllowedBySchool(r, schools));
  const ranked = operatorRows(rows, operators, cancelled, vehicles, directory);
  const baseline =
    cancelledBase && vehiclesBase
      ? new Map(
          operatorRows(
            modeRows.filter((r) => !isSchoolBus(r.shortName, r.longName)),
            operators,
            cancelledBase,
            vehiclesBase,
            directory,
          ).map((o) => [o.operator.code, o]),
        )
      : null;
  /**
   * What school services added to one of an operator's counts: all of it for an
   * operator that only ran school services, nothing while they are left out.
   * @param o - The operator's row.
   * @param key - The count.
   * @returns The amount added.
   */
  const added = (o: OperatorRow, key: "routes" | "events" | "cancelled" | "vehicles"): number =>
    baseline ? (o[key] ?? 0) - (baseline.get(o.operator.code)?.[key] ?? 0) : 0;

  const view = rangeViewParams(window, linkDay, period);
  const filters = { mode: mode ?? undefined, school: schoolFilterParam(schools) };
  const { sort, head, keep } = tableSort(sp, COLUMNS, "ontime", (p) =>
    buildHref("/operators", { ...view, ...filters, ...p }),
  );
  // Too-thin operators stay at the bottom whatever the sort, as the note says.
  const table = sortRows(ranked, COLUMNS, sort, (o) => o.events < MIN_BOARD_EVENTS);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Operators"
        subtitle="The companies AT contracts to run its routes, best on time first."
        actions={<RangeControls basePath="/operators" nav={nav} />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/operators"
          preservedParams={stripUnset({ ...view, school: filters.school, ...keep })}
          availableModes={new Set(allRows.map((r) => r.mode))}
        />
        <SchoolBusToggle
          value={schools}
          basePath="/operators"
          preservedParams={stripUnset({ ...view, mode: filters.mode, ...keep })}
        />
      </div>

      {table.length === 0 ? (
        <EmptyState>No operators recorded {windowPhrase(nav, period)}.</EmptyState>
      ) : (
        <DataTable caption="Operators by on-time share">
          <thead>
            <tr className="at-th-row">
              <SortHeader {...head("name")} align="left">
                Operator
              </SortHeader>
              <SortHeader {...head("ontime")}>On time</SortHeader>
              <SortHeader {...head("off")}>Avg off</SortHeader>
              <SortHeader {...head("routes")} className="hidden sm:table-cell">
                Routes
              </SortHeader>
              <SortHeader {...head("vehicles")} className="hidden sm:table-cell">
                Vehicles
              </SortHeader>
              <SortHeader {...head("arrivals")} className="hidden md:table-cell">
                Arrivals
              </SortHeader>
              <SortHeader {...head("cancelled")} className="hidden md:table-cell">
                Cancelled
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {table.map((o) => {
              const thin = o.events < MIN_BOARD_EVENTS;
              return (
                <tr key={o.operator.code} className={cn(ROW_CLASS, thin && "text-at-muted")}>
                  <th scope="row" className="p-3 text-left font-semibold">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="flex items-center gap-1">
                        {o.modes.map((m) => (
                          <ModeIcon key={m} mode={m} className="h-4 w-4" />
                        ))}
                      </span>
                      <Link
                        href={buildHref(operatorHref(o.operator), {
                          ...view,
                          school: filters.school,
                        })}
                        className="at-link"
                      >
                        {o.operator.name}
                      </Link>
                    </span>
                  </th>
                  <td className="p-3 text-right tabular-nums">{formatPct(o.on_time_pct)}</td>
                  <td className="p-3 text-right whitespace-nowrap tabular-nums">
                    {o.avg_abs_delay_sec === null
                      ? UNKNOWN_VALUE
                      : formatDuration(o.avg_abs_delay_sec)}
                  </td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                    <Link
                      href={buildHref("/routes", { ...view, ...filters, op: o.operator.slug })}
                      className="at-link"
                    >
                      {o.routes}
                    </Link>
                    <SchoolAdded n={added(o, "routes")} />
                  </td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                    {o.vehicles === null ? (
                      UNKNOWN_VALUE
                    ) : (
                      <Link
                        href={buildHref("/vehicles", {
                          ...view,
                          ...filters,
                          op: o.operator.slug,
                        })}
                        className="at-link"
                      >
                        {formatCount(o.vehicles)}
                      </Link>
                    )}
                    <SchoolAdded n={added(o, "vehicles")} />
                  </td>
                  <td className="hidden p-3 text-right tabular-nums md:table-cell">
                    {formatCount(o.events)}
                    <SchoolAdded n={added(o, "events")} />
                  </td>
                  <td className="hidden p-3 text-right tabular-nums md:table-cell">
                    {formatCount(o.cancelled)}
                    <SchoolAdded n={added(o, "cancelled")} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      <p className="text-xs text-at-muted">
        Each operator&apos;s on-time share and average are weighted by how many arrivals each of its
        routes recorded. Operators with fewer than {MIN_BOARD_EVENTS} arrivals are greyed and listed
        last. Vehicles counts every vehicle that ran one of the operator&apos;s routes. Operators
        are as AT lists them in its timetable feed.
      </p>
    </main>
  );
}
