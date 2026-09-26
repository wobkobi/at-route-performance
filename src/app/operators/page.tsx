// src/app/operators/page.tsx
// Operators: the companies AT contracts to run its routes, compared over a day,
// week or month. Folded from the Routes page's per-route rows (see
// lib/operator-stats.ts), so the table adds no query of its own beyond the
// fleet count the Vehicles page already caches.

import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { ModeIcon } from "@/components/ModeIcon";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { cn } from "@/lib/cn";
import {
  getCancelledByRoute,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getRouteOperators,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { operatorRows } from "@/lib/operator-stats";
import { operatorHref } from "@/lib/operators";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import { dayRangeNav, parseRangeWindow, periodRangeNav, type RangeNav } from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { requestServiceDay } from "@/lib/request-now";
import { isSchoolBus } from "@/lib/school-bus";
import type { DateRange } from "@/lib/time";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment reads its search
// params and its data above any Suspense boundary, so it is allowed to block.
export const instant = false;

export const metadata: Metadata = {
  title: "Operators",
  description:
    "The companies that run Auckland's buses, trains and ferries for AT, compared on punctuality, cancellations and fleet.",
};

/** Cache TTL for a week or month's rows (seconds), as on the Routes page. */
const PERIOD_REVALIDATE = 3600;

/** Query params for the operators page. */
interface OperatorsSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
}

/**
 * Operators page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`) and filters (`mode`, `school`).
 * @returns Page markup.
 */
export default async function OperatorsPage({
  searchParams,
}: {
  searchParams?: Promise<OperatorsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window === "day") {
    clampDayParam("/operators", sp);
    dropTodayParam("/operators", sp);
  }
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const includeSchool = sp.school === "1";
  const filter = { mode, includeSchool };
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
      "/operators",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
      today,
    ));
  }
  const revalidate = window === "day" ? TODAY_REVALIDATE : PERIOD_REVALIDATE;

  const [allRows, operators, cancelled, vehicles] = await Promise.all([
    getRankings(range, ON_TIME_LATE_SEC, revalidate),
    getRouteOperators(),
    getCancelledByRoute(range, filter, revalidate),
    getVehicleWork(range, filter, TODAY_REVALIDATE),
  ]);
  const rows = allRows.filter(
    (r) =>
      (mode === null || r.mode === mode) &&
      (includeSchool || !isSchoolBus(r.short_name, r.long_name)),
  );
  const table = operatorRows(rows, operators, cancelled, vehicles);

  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  const filters = { mode: mode ?? undefined, school: includeSchool ? "1" : undefined };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Operators</h1>
          <p className="mt-0.5 text-sm text-at-muted">
            The companies AT contracts to run its routes, best on time first.
          </p>
        </div>
        <RangeControls basePath="/operators" nav={nav} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/operators"
          preservedParams={stripUnset({ ...view, school: filters.school })}
        />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/operators"
          preservedParams={stripUnset({ ...view, mode: filters.mode })}
        />
      </div>

      {table.length === 0 ? (
        <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
          No operator recorded for this period yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-at-border bg-at-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                <th scope="col" className="p-3 font-semibold">
                  Operator
                </th>
                <th scope="col" className="p-3 text-right font-semibold">
                  On time
                </th>
                <th scope="col" className="p-3 text-right font-semibold">
                  Avg off
                </th>
                <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                  Routes
                </th>
                <th scope="col" className="hidden p-3 text-right font-semibold sm:table-cell">
                  Vehicles
                </th>
                <th scope="col" className="hidden p-3 text-right font-semibold md:table-cell">
                  Arrivals
                </th>
                <th scope="col" className="hidden p-3 text-right font-semibold md:table-cell">
                  Cancelled
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((o) => {
                const thin = o.events < MIN_BOARD_EVENTS;
                return (
                  <tr
                    key={o.operator.code}
                    className={cn(
                      "border-b border-at-border last:border-b-0",
                      thin && "text-at-muted",
                    )}
                  >
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
                          className="text-at-shore hover:underline"
                        >
                          {o.operator.name}
                        </Link>
                      </span>
                    </th>
                    <td className="p-3 text-right tabular-nums">
                      {o.on_time_pct === null ? "-" : `${o.on_time_pct.toFixed(1)}%`}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">
                      {o.avg_abs_delay_sec === null ? "-" : formatDuration(o.avg_abs_delay_sec)}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">{o.routes}</td>
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                      {o.vehicles?.toLocaleString("en-NZ") ?? "-"}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums md:table-cell">
                      {o.events.toLocaleString("en-NZ")}
                    </td>
                    <td className="hidden p-3 text-right tabular-nums md:table-cell">
                      {o.cancelled.toLocaleString("en-NZ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
