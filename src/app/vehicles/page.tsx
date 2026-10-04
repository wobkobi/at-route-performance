// src/app/vehicles/page.tsx
// Hardest-worked vehicles: every bus, train and ferry ranked by how much it ran
// over a day, week or month - time in service, runs and arrivals.

import { ChipGroup, ChipLink } from "@/components/Chip";
import { RangeControls } from "@/components/date/RangeControls";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { OperatorSelect } from "@/components/filter/OperatorSelect";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { ModeIcon } from "@/components/ModeIcon";
import { SortHeader } from "@/components/SortHeader";
import { DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ShowMore } from "@/components/ui/ShowMore";
import { VehicleLiveBadge } from "@/components/VehicleLiveBadge";
import { TRAIN_COUNT_NOTE } from "@/components/VehiclesSection";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getOperatorDirectory,
  getRankings,
  getRouteNames,
  getVehicleWork,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { readFallback } from "@/lib/db";
import { getLiveVehicleMap } from "@/lib/feed/vehicles";
import { formatCount, formatDuration, formatHours } from "@/lib/format";
import { parseMode } from "@/lib/mode";
import { pageMetadata } from "@/lib/og";
import { vehicleOperatorCodes } from "@/lib/operator-stats";
import { operatorBySlug, operatorHref, operatorOf } from "@/lib/operators";
import {
  LIST_PAGE_SIZE,
  parseShown,
  pickParams,
  SHOWN_PARAM,
  VEHICLE_LIST_PARAMS,
} from "@/lib/page/filter-params";
import { routeHref, vehicleHref, type LinkQuery } from "@/lib/page/hrefs";
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
import { sortRows, tableSort, type SortColumn } from "@/lib/page/table-sort";
import { routeSlug } from "@/lib/route/slug";
import { parseSchoolFilter, schoolFilterParam } from "@/lib/school-bus";
import { getFleet, type FleetVehicle } from "@/lib/store/fleet";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import type { DateRange } from "@/lib/time/service-day";
import { buildHref, stripUnset } from "@/lib/utils";
import { sortVehicles, type VehicleSort, type VehicleTotal } from "@/lib/vehicle/rank";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

export const metadata: Metadata = pageMetadata({
  title: "Hardest-worked vehicles",
  description:
    "Auckland's buses, trains and ferries ranked by how hard they were worked: hours in service, trips and stops.",
});

/** The table's sortable columns; the chips above offer the four figures too. */
const COLUMNS: SortColumn<VehicleTotal>[] = [
  { key: "vehicle", value: "vehicleId", first: "asc" },
  { key: "hours", value: "serviceSec" },
  { key: "runs", value: "runs" },
  { key: "arrivals", value: "arrivals" },
  { key: "days", value: "days" },
  { key: "off", value: "avgOffSec" },
];

const SORT_LABEL: Record<VehicleSort, string> = {
  hours: "Time in service",
  runs: "Trips",
  arrivals: "Arrivals",
  off: "Most off-schedule",
};

/** Query params for the vehicles page. */
interface VehiclesSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
  /** The sorted column; absent is time in service. */
  sort?: string;
  /** "1" sorts the column the other way. */
  rev?: string;
  show?: string;
  /** Operator slug, to list only the vehicles that ran its routes. */
  op?: string;
  /** "1" lists only the vehicles on a trip now. */
  live?: string;
}

/**
 * Hardest-worked vehicles page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`), filters (`mode`, `school`, `op`, `live`), sort (`sort`, `rev`) and `show`.
 * @returns Page markup.
 */
export default async function VehiclesPage({
  searchParams,
}: {
  searchParams?: Promise<VehiclesSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  if (window === "day") {
    clampDayParam("/vehicles", sp, today);
    dropTodayParam("/vehicles", sp, today);
  }
  const mode = parseMode(sp.mode);
  const schools = parseSchoolFilter(sp.school);
  const shown = parseShown(sp.show);
  const liveOnly = sp.live === "1";
  const filter = { mode, schools };
  const [latest, earliest, [operators, directory]] = await Promise.all([
    getLatestEventDate(),
    getEarliestDataDay(1),
    getOperatorDirectory(),
  ]);
  const operator = sp.op ? operatorBySlug(sp.op, directory, Object.values(operators)) : null;

  let range: DateRange;
  let nav: RangeNav;
  let vehicles: VehicleTotal[];
  let linkDay: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const day = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = day.range;
    vehicles = await getVehicleWork(range, filter, TODAY_REVALIDATE);
    nav = dayRangeNav(day, earliest, today);
    linkDay = dayLinkParam(day.serviceDate, today);
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/vehicles",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
      today,
    ));
    vehicles = await getVehicleWork(range, filter, TODAY_REVALIDATE);
  }

  // Which modes ran, so the Mode box only offers a mode that changes the list.
  // The window's route rankings answer it from their cache; the vehicle rows
  // are already filtered.
  const rankRows = await getRankings(range, TODAY_REVALIDATE);

  // The operators that ran anything in the window, for the drop-down, counted
  // before the operator filter narrows the list.
  const vehicleOps = new Map(
    vehicles.map((v) => [v.vehicleId, vehicleOperatorCodes(v, operators)]),
  );
  const opOptions = [...new Set([...vehicleOps.values()].flat())]
    .map((code) => operatorOf(code, directory)!)
    .sort((a, b) => a.name.localeCompare(b.name, "en-NZ"));
  const view = rangeViewParams(window, linkDay, period);
  const filters = {
    mode: mode ?? undefined,
    school: schoolFilterParam(schools),
    op: operator?.slug,
    live: liveOnly ? "1" : undefined,
  };
  const { sort, head, keep } = tableSort(sp, COLUMNS, "hours", (p) =>
    buildHref("/vehicles", { ...view, ...filters, ...p }),
  );
  // Started now and awaited per row, so AT's feed never holds up the board,
  // unless the list is cut to the live vehicles and has to wait for it anyway.
  const live = getLiveVehicleMap();
  const liveNow = liveOnly ? await live : null;
  // Sorted in full before the page is cut, so Show more continues the same order.
  const ranked = sortRows(
    sortVehicles(
      vehicles.filter(
        (v) =>
          (!operator || vehicleOps.get(v.vehicleId)?.includes(operator.code)) &&
          (!liveNow || liveNow.has(v.vehicleId)),
      ),
      "hours",
    ),
    COLUMNS,
    sort,
  );
  const rows = ranked.slice(0, shown);
  const [names, fleet] = await Promise.all([
    getRouteNames([...new Set(rows.flatMap((v) => v.routes))]),
    getFleet(rows.map((v) => v.vehicleId)).catch(
      readFallback("fleet", new Map<string, FleetVehicle>()),
    ),
  ]);
  const multiDay = window !== "day";
  const routeParams = routeLinkParams(window, linkDay, period);

  // How the list is being read, for a vehicle's link to hand back on its way out.
  const listState = pickParams(
    { ...filters, ...keep, [SHOWN_PARAM]: shown > LIST_PAGE_SIZE ? String(shown) : undefined },
    VEHICLE_LIST_PARAMS,
  );
  const modePreserved = stripUnset({ ...view, ...filters, mode: undefined, ...keep });
  const schoolPreserved = stripUnset({ ...view, ...filters, school: undefined, ...keep });
  const showsTrains = mode === null || mode === "TRAIN";

  return (
    <main className="space-y-4">
      <PageHeader
        title="Hardest-worked vehicles"
        subtitle={
          operator ? (
            <>
              Every vehicle that ran {/^[AEIOU]/.test(operator.name) ? "an" : "a"}{" "}
              <Link
                href={buildHref(operatorHref(operator), { ...view, school: filters.school })}
                className="at-link"
              >
                {operator.name}
              </Link>{" "}
              route, ranked by how much it ran.
            </>
          ) : (
            "Every vehicle that ran, ranked by how much it ran."
          )
        }
        actions={<RangeControls basePath="/vehicles" nav={nav} />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/vehicles"
          preservedParams={modePreserved}
          availableModes={new Set(rankRows.map((r) => r.mode))}
        />
        <SchoolBusToggle value={schools} basePath="/vehicles" preservedParams={schoolPreserved} />
        <OperatorSelect
          options={opOptions}
          active={operator?.slug ?? null}
          basePath="/vehicles"
          preservedParams={stripUnset({ ...view, ...filters, ...keep })}
        />
        <ChipLink
          href={buildHref("/vehicles", {
            ...view,
            ...filters,
            ...keep,
            live: liveOnly ? undefined : "1",
          })}
          active={liveOnly}
        >
          Live now
        </ChipLink>
      </div>

      <ChipGroup label="Rank by" showLabel>
        {(Object.keys(SORT_LABEL) as VehicleSort[]).map((s) => (
          <ChipLink
            key={s}
            href={buildHref("/vehicles", {
              ...view,
              ...filters,
              sort: s === "hours" ? undefined : s,
            })}
            active={s === sort?.key}
          >
            {SORT_LABEL[s]}
          </ChipLink>
        ))}
      </ChipGroup>

      {rows.length === 0 ? (
        <EmptyState>
          {liveOnly
            ? `No vehicle on a trip now ran ${windowPhrase(nav, period)}.`
            : `No vehicles recorded ${windowPhrase(nav, period)}.`}
        </EmptyState>
      ) : (
        <DataTable caption="Vehicles by time in service">
          <thead>
            <tr className="at-th-row">
              <th scope="col" className="w-10 p-3 text-right font-semibold">
                #
              </th>
              <SortHeader {...head("vehicle")} align="left">
                Vehicle
              </SortHeader>
              <SortHeader {...head("hours")}>In service</SortHeader>
              <SortHeader {...head("runs")}>Trips</SortHeader>
              <SortHeader {...head("arrivals")} className="hidden sm:table-cell">
                Arrivals
              </SortHeader>
              {multiDay && (
                <SortHeader {...head("days")} className="hidden sm:table-cell">
                  Days
                </SortHeader>
              )}
              <SortHeader {...head("off")} className="hidden sm:table-cell">
                Avg off by
              </SortHeader>
              <th scope="col" className="hidden p-3 font-semibold md:table-cell">
                Routes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => (
              <tr key={v.vehicleId} className={ROW_CLASS}>
                <td className="p-3 text-right text-at-muted tabular-nums">{i + 1}</td>
                <th scope="row" className="p-3 text-left font-semibold whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <ModeIcon mode={v.mode} className="h-4 w-4" />
                    <Link
                      href={vehicleHref(v.vehicleId, { ...view, ...listState })}
                      className="at-link"
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
                <td className="hidden p-3 text-right tabular-nums sm:table-cell">
                  {formatCount(v.arrivals)}
                </td>
                {multiDay && (
                  <td className="hidden p-3 text-right tabular-nums sm:table-cell">{v.days}</td>
                )}
                <td className="hidden p-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                  {formatDuration(v.avgOffSec)}
                </td>
                <td className="hidden p-3 md:table-cell">
                  <RouteLinks ids={v.routes} names={names} params={routeParams} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-at-muted tabular-nums">
          {ranked.length === 0
            ? null
            : `Showing ${formatCount(rows.length)} of ${formatCount(ranked.length)} vehicles`}
        </p>
        {rows.length < ranked.length && (
          <ShowMore
            remaining={ranked.length - rows.length}
            href={buildHref("/vehicles", {
              ...view,
              ...filters,
              ...keep,
              show: String(shown + LIST_PAGE_SIZE),
            })}
          />
        )}
      </div>

      <p className="text-xs text-at-muted">
        Time in service adds up each trip from its first recorded stop to its last, so a layover
        between trips does not count. Vehicles are named by their fleet label, or AT&apos;s feed id
        until the feed has named them. LIVE marks a vehicle on a trip now.
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
 * @param root0.params - The route-page params for the window shown.
 * @returns The links.
 */
function RouteLinks({
  ids,
  names,
  params,
}: {
  ids: string[];
  names: Record<string, string>;
  params: LinkQuery;
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
        <Link key={name} href={routeHref(slug, params)} className="at-link font-semibold">
          {name}
        </Link>
      ))}
    </span>
  );
}
