// src/app/vehicles/page.tsx
// Hardest-worked vehicles: every bus, train and ferry ranked by how much it ran
// over a day, week or month - time in service, runs and arrivals.

import { ChipLink } from "@/components/Chip";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { ModeIcon } from "@/components/ModeIcon";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { SortHeader } from "@/components/SortHeader";
import { VehicleLiveBadge } from "@/components/VehicleLiveBadge";
import { TRAIN_COUNT_NOTE } from "@/components/VehiclesSection";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getRouteNames,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { readFallback } from "@/lib/db";
import { getFleet, type FleetVehicle } from "@/lib/fleet-store";
import { formatDuration, formatHours } from "@/lib/format";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/range-page";
import { routeSlug } from "@/lib/route-slug";
import type { DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import {
  parseVehicleSort,
  sortVehicles,
  type VehicleSort,
  type VehicleTotal,
} from "@/lib/vehicle-rank";
import { getLiveVehicleMap } from "@/lib/vehicles";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

export const metadata: Metadata = {
  title: "Hardest-worked vehicles",
  description:
    "Auckland's buses, trains and ferries ranked by how hard they were worked: hours in service, runs and stops.",
};

/** Rows per page; "Show more" adds another page. */
const PAGE_SIZE = 50;

const SORT_LABEL: Record<VehicleSort, string> = {
  hours: "Time in service",
  runs: "Runs",
  arrivals: "Arrivals",
  off: "Most off schedule",
};

/** Query params for the vehicles page. */
interface VehiclesSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
  sort?: string;
  show?: string;
}

/**
 * Drop the unset entries from a param set, for a control's preserved params.
 * @param params - The params, some unset.
 * @returns The set ones.
 */
function stripUnset(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

/**
 * Hardest-worked vehicles page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`), filters (`mode`, `school`), `sort` and `show`.
 * @returns Page markup.
 */
export default async function VehiclesPage({
  searchParams,
}: {
  searchParams?: Promise<VehiclesSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window === "day") {
    clampDayParam("/vehicles", sp);
    dropTodayParam("/vehicles", sp);
  }
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const includeSchool = sp.school === "1";
  const sort = parseVehicleSort(sp.sort);
  const shown = Math.max(PAGE_SIZE, Math.ceil(Number(sp.show) / PAGE_SIZE) * PAGE_SIZE || 0);
  const filter = { mode, includeSchool };
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let nav: RangeNav;
  let vehicles: VehicleTotal[];
  let dayParam: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day));
    range = day.range;
    vehicles = await getVehicleWork(range, filter, TODAY_REVALIDATE);
    nav = dayRangeNav(day, earliest);
    dayParam = nav.isToday ? undefined : day.serviceDate;
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/vehicles",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
    ));
    vehicles = await getVehicleWork(range, filter, TODAY_REVALIDATE);
  }

  const ranked = sortVehicles(vehicles, sort);
  const rows = ranked.slice(0, shown);
  // Started now and awaited per row, so AT's feed never holds up the board.
  const live = getLiveVehicleMap();
  const [names, fleet] = await Promise.all([
    getRouteNames([...new Set(rows.flatMap((v) => v.routes))]),
    getFleet(rows.map((v) => v.vehicleId)).catch(
      readFallback("fleet", new Map<string, FleetVehicle>()),
    ),
  ]);
  const multiDay = window !== "day";
  const routeQuery = routeLinkQuery(window, dayParam, period);

  const view = {
    window: window === "day" ? undefined : window,
    day: dayParam,
    period: period ?? undefined,
  };
  const filters = { mode: mode ?? undefined, school: includeSchool ? "1" : undefined };
  const sortParam = sort === "hours" ? undefined : sort;
  // How the list is being read, for a vehicle's link to hand back on its way out.
  const listState = stripUnset({
    ...filters,
    sort: sortParam,
    show: shown > PAGE_SIZE ? String(shown) : undefined,
  });
  const modePreserved = stripUnset({ ...view, school: filters.school, sort: sortParam });
  const schoolPreserved = stripUnset({ ...view, mode: filters.mode, sort: sortParam });
  const showsTrains = mode === null || mode === "TRAIN";

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
            Hardest-worked vehicles
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">
            Every vehicle that ran, ranked by how much it ran.
          </p>
        </div>
        <RangeControls basePath="/vehicles" nav={nav} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter active={mode} basePath="/vehicles" preservedParams={modePreserved} />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/vehicles"
          preservedParams={schoolPreserved}
        />
      </div>

      {/* Named from the visible label rather than by an aria-label repeating it,
          which had a screen reader announce "Rank by" twice over. */}
      <nav aria-labelledby="rank-by" className="flex flex-wrap items-center gap-2">
        <span id="rank-by" className="text-xs tracking-zero text-at-muted uppercase">
          Rank by
        </span>
        {(Object.keys(SORT_LABEL) as VehicleSort[]).map((s) => (
          <ChipLink
            key={s}
            href={buildHref("/vehicles", {
              ...view,
              ...filters,
              sort: s === "hours" ? undefined : s,
            })}
            active={s === sort}
          >
            {SORT_LABEL[s]}
          </ChipLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="border border-at-border bg-at-surface px-6 py-5 text-sm text-at-muted">
          No vehicles recorded for this period yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-at-border bg-at-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-at-border text-left text-xs tracking-wide text-at-muted uppercase">
                <th scope="col" className="w-10 p-3 text-right font-semibold">
                  #
                </th>
                <th scope="col" className="p-3 font-semibold">
                  Vehicle
                </th>
                <SortHeader active={sort === "hours"}>In service</SortHeader>
                <SortHeader active={sort === "runs"}>Runs</SortHeader>
                <SortHeader active={sort === "arrivals"} className="hidden sm:table-cell">
                  Arrivals
                </SortHeader>
                {multiDay && <SortHeader className="hidden sm:table-cell">Days</SortHeader>}
                <SortHeader active={sort === "off"} className="hidden sm:table-cell">
                  Avg off
                </SortHeader>
                <th scope="col" className="hidden p-3 font-semibold md:table-cell">
                  Routes
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.vehicleId} className="border-b border-at-border last:border-b-0">
                  <td className="p-3 text-right text-at-muted tabular-nums">{i + 1}</td>
                  <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                    <span className="flex items-center gap-2">
                      <ModeIcon mode={v.mode} className="h-4 w-4" />
                      <Link
                        href={buildHref(`/vehicle/${v.vehicleId}`, { ...view, ...listState })}
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
                  <td className="p-3 text-right tabular-nums">{v.runs.toLocaleString("en-NZ")}</td>
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                    {v.arrivals.toLocaleString("en-NZ")}
                  </td>
                  {multiDay && (
                    <td className="hidden p-3 text-right tabular-nums sm:table-cell">{v.days}</td>
                  )}
                  <td className="hidden p-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatDuration(v.avgOffSec)}
                  </td>
                  <td className="hidden p-3 md:table-cell">
                    <RouteLinks ids={v.routes} names={names} query={routeQuery} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-at-muted tabular-nums">
          {ranked.length === 0
            ? null
            : `Showing ${rows.length.toLocaleString("en-NZ")} of ${ranked.length.toLocaleString("en-NZ")} vehicles`}
        </p>
        {rows.length < ranked.length && (
          <Link
            href={buildHref("/vehicles", {
              ...view,
              ...filters,
              sort: sortParam,
              show: String(shown + PAGE_SIZE),
            })}
            scroll={false}
            className="chip chip-off"
          >
            Show more
          </Link>
        )}
      </div>

      <p className="text-xs text-at-muted">
        Time in service adds up each run from its first recorded stop to its last, so a layover
        between runs does not count. Vehicles are named by their fleet label, or AT&apos;s feed id
        until the feed has named them. LIVE marks a vehicle on a run now.
        {showsTrains && ` ${TRAIN_COUNT_NOTE}`}
      </p>
    </main>
  );
}

/**
 * A vehicle's routes as links, one per line name: AT versions a route id
 * ("S-C-201", "S-C-202"), so two ids can carry one name.
 * @param root0 - Props.
 * @param root0.ids - Route ids it ran.
 * @param root0.names - Route id > short name.
 * @param root0.query - The route-page query for the window shown, with its `?`.
 * @returns The links.
 */
function RouteLinks({
  ids,
  names,
  query,
}: {
  ids: string[];
  names: Record<string, string>;
  query: string;
}): JSX.Element {
  // One link per name, pointed at the route's slug: a short name is not a
  // route id, so linking by it costs every click the canonical redirect.
  const slugByName = new Map<string, string>();
  for (const id of ids) {
    const name = names[id] ?? id;
    if (!slugByName.has(name)) slugByName.set(name, routeSlug(id));
  }
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {[...slugByName].map(([name, slug]) => (
        <Link
          key={name}
          href={`/route/${encodeURIComponent(slug)}${query}`}
          className="font-semibold text-at-shore hover:underline"
        >
          {name}
        </Link>
      ))}
    </span>
  );
}
