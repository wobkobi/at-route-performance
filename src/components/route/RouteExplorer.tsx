"use client";
// src/components/route/RouteExplorer.tsx
// The Routes page body: the KPI strip for exactly the routes that pass the
// filters, the search and filter menus (behind a Filters button on a phone),
// and a table of routes sorted by its column headings, with the routes too thin
// to rank on a measure listed last. Filtering runs on the client (a few hundred rows), so a change is
// instant; the state is written back to the query string with useUrlParams, so
// the view survives a reload and can be shared without a navigation.

import { DELAY_OPTIONS } from "@/components/filter/DelayFilter";
import { choiceSummary, FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import { MODE_OPTIONS } from "@/components/filter/ModeFilter";
import { RadioFilter } from "@/components/filter/RadioFilter";
import { ChevronDown, ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { FleetSummary } from "@/components/ranking/FleetSummary";
import { SortHeader } from "@/components/SortHeader";
import { Badge } from "@/components/ui/Badge";
import { DataTable, ROW_CLASS } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { MiniSplit } from "@/components/ui/MiniSplit";
import { OffScheduleValue } from "@/components/ui/OffScheduleValue";
import { Panel } from "@/components/ui/Panel";
import { ShowMore } from "@/components/ui/ShowMore";
import { cn } from "@/lib/cn";
import { labelsOf } from "@/lib/collections";
import { formatCount, formatDuration, formatPct, UNKNOWN_VALUE } from "@/lib/format";
import { AREA_LABEL, AREAS, type AreaKey } from "@/lib/geo/areas";
import { FARE_ZONES, type FareZoneKey } from "@/lib/geo/fare-zones";
import { LIST_PAGE_SIZE, SHOWN_PARAM } from "@/lib/page/filter-params";
import { routeHref, type LinkQuery } from "@/lib/page/hrefs";
import { ROUTE_NAME_CLASS } from "@/lib/page/row";
import { flipDir, type SortDir } from "@/lib/page/table-sort";
import { useUrlParams } from "@/lib/page/use-url-param";
import { summariseRows } from "@/lib/rankings";
import {
  DEFAULT_FILTERS,
  defaultDir,
  EXPLORER_PARAMS,
  explorerQuery,
  filterRoutes,
  minEventsFor,
  sortRoutes,
  unranked,
  type ExplorerFilters,
  type ExplorerRoute,
  type ExplorerSort,
} from "@/lib/route/explorer";
import { routeDisplayName, routeSubtitle } from "@/lib/route/slug";
import { SCHOOL_FILTERS, schoolFilterSummary } from "@/lib/school-bus";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, type JSX } from "react";

/** The params the explorer's client state writes: its filters and the row count. */
const OWNED_PARAMS = [...EXPLORER_PARAMS, SHOWN_PARAM];

/** Props for {@link RouteExplorer}. */
export interface RouteExplorerProps {
  /** Every route with arrivals in the window. */
  rows: ExplorerRoute[];
  /** The stored operators' slugs and names, which label the operator filter. */
  operators: { slug: string; name: string }[];
  /** The filters parsed from the page's query string. */
  initialFilters: ExplorerFilters;
  /** How many rows to show, parsed from the page's query string. */
  initialShown: number;
  /** Params each route link carries, so the route opens on the same window. */
  routeParams: LinkQuery;
  /**
   * Slugs of the routes with a vehicle on a run now, or null when AT's feed
   * could not be read. Unresolved, so the list never waits on the feed.
   */
  running: Promise<string[] | null>;
}

/** The on/off filters gathered under More. */
const TOGGLES = [
  ["enoughData", "Enough data to rank"],
  ["cancelledOnly", "Had cancellations"],
  ["runningNow", "Running now"],
] as const;

/** Padding for the figure columns a phone shows: narrower sides there, so Route keeps its room. */
const PHONE_FIGURE = "px-2 py-2 sm:px-3";

/** Padding for the figure columns only a wider screen shows. */
const WIDE_FIGURE = "px-3 py-2";

/** Columns in the table, the chevron's included, for the not-ranked divider's span. */
const COLUMNS = 9;

/**
 * How many filters are set, for the phone's Filters button. Each menu counts
 * once however many of its boxes are ticked; search and sort are not filters.
 * @param f - The filters.
 * @returns The count.
 */
function activeFilterCount(f: ExplorerFilters): number {
  return [
    f.mode,
    f.areas.length > 0,
    f.zones.length > 0,
    f.op,
    f.school !== DEFAULT_FILTERS.school,
    f.direction,
    f.enoughData,
    f.cancelledOnly,
    f.runningNow,
  ].filter(Boolean).length;
}

/**
 * Filterable, sortable table of routes with a KPI strip over the matching ones.
 * @param props - Component props.
 * @param props.rows - Every route with arrivals in the window.
 * @param props.operators - The stored operators' slugs and names.
 * @param props.initialFilters - The filters parsed from the query string.
 * @param props.initialShown - How many rows to show, parsed from the query string.
 * @param props.routeParams - Params each route link carries.
 * @param props.running - Slugs of the routes running now, unresolved.
 * @returns The explorer.
 */
export function RouteExplorer({
  rows,
  operators,
  initialFilters,
  initialShown,
  routeParams,
  running,
}: RouteExplorerProps): JSX.Element {
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [shown, setShown] = useState(initialShown);
  // The filter menus on a phone, folded behind one button; always shown from sm.
  const [menusOpen, setMenusOpen] = useState(false);
  const menusId = useId();
  // undefined while the feed is answering, null when it could not be read.
  const [runningSet, setRunningSet] = useState<ReadonlySet<string> | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    running.then(
      (slugs) => {
        if (!dead) setRunningSet(slugs ? new Set(slugs) : null);
      },
      () => {
        if (!dead) setRunningSet(null);
      },
    );
    return () => {
      dead = true;
    };
  }, [running]);

  const minEvents = minEventsFor(filters.mode);
  const matching = useMemo(
    () => filterRoutes(rows, filters, runningSet ?? null),
    [rows, filters, runningSet],
  );
  const sorted = useMemo(
    () => sortRoutes(matching, filters.sort, filters.dir, minEvents),
    [matching, filters.sort, filters.dir, minEvents],
  );
  const hero = useMemo(
    () => ({
      ...summariseRows(matching),
      cancelled: matching.reduce((n, r) => n + r.cancelled, 0),
    }),
    [matching],
  );

  // Mirror the filters and the row count into the query string, keeping the
  // window params the server owns. The count belongs here because the history
  // entry the write overwrites is the one Back returns to, so a count held only
  // in state comes back as the first page after opening a route and stepping back.
  useUrlParams(OWNED_PARAMS, {
    ...explorerQuery(filters),
    ...(shown > LIST_PAGE_SIZE ? { [SHOWN_PARAM]: String(shown) } : {}),
  });

  /**
   * Apply a filter change and return to the top of the list.
   * @param patch - The fields to change.
   */
  const update = (patch: Partial<ExplorerFilters>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(LIST_PAGE_SIZE);
  };

  /**
   * Sort by a column: the sorted column flips, any other opens on its telling end.
   * @param sort - The column's sort.
   */
  const sortBy = (sort: ExplorerSort): void => {
    update(filters.sort === sort ? { dir: flipDir(filters.dir) } : { sort, dir: defaultDir(sort) });
  };

  /**
   * A column heading's direction arrow.
   * @param sort - The column's sort.
   * @returns The direction when the table is sorted by it, else null.
   */
  const dirOf = (sort: ExplorerSort): SortDir | null =>
    filters.sort === sort ? filters.dir : null;

  /**
   * Add or remove an area from the area filter.
   * @param key - The area.
   */
  const toggleArea = (key: AreaKey): void => {
    update({
      areas: filters.areas.includes(key)
        ? filters.areas.filter((a) => a !== key)
        : AREAS.map((a) => a.key).filter((a) => a === key || filters.areas.includes(a)),
    });
  };

  /**
   * Add or remove a zone from the fare zone filter.
   * @param key - The zone.
   */
  const toggleZone = (key: FareZoneKey): void => {
    update({
      zones: filters.zones.includes(key)
        ? filters.zones.filter((z) => z !== key)
        : FARE_ZONES.map((z) => z.key).filter((z) => z === key || filters.zones.includes(z)),
    });
  };

  // Only the zones some route in the window serves: a chip for a zone none of
  // them reaches could only ever empty the list.
  const servedZones = useMemo(() => new Set(rows.flatMap((r) => r.zones)), [rows]);

  // The operators behind the window's routes, by name. Seventeen make too long a
  // chip row, so this one filter is a select.
  const operatorOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.operator).filter((s): s is string => s !== null))]
        .map((slug) => ({ slug, name: operators.find((o) => o.slug === slug)?.name ?? slug }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-NZ")),
    [rows, operators],
  );

  const operatorName = useMemo(() => new Map(operators.map((o) => [o.slug, o.name])), [operators]);

  const isDefault = Object.keys(explorerQuery(filters)).length === 0;
  const setCount = activeFilterCount(filters);
  // The count is out of the routes the school-bus choice leaves, so the default
  // view (school services hidden) reads as every route rather than a filtered few.
  const baseCount = useMemo(
    () => filterRoutes(rows, { ...DEFAULT_FILTERS, school: filters.school }).length,
    [rows, filters.school],
  );
  const page = sorted.slice(0, shown);
  // Where the routes too thin to rank begin, so a divider can say why they sit last.
  const firstUnranked = page.findIndex((r) => unranked(r, filters.sort, minEvents));

  return (
    <div className="space-y-4">
      <FleetSummary data={hero} />

      <Panel aria-label="Search and filter routes" pad="sm" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search routes"
            aria-label="Search routes"
            className="at-field min-w-0 flex-1 sm:w-72 sm:flex-none"
          />
          {/* Wrapped, since .chip's display sits outside Tailwind's layers and beats sm:hidden. */}
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => setMenusOpen((o) => !o)}
              aria-expanded={menusOpen}
              aria-controls={menusId}
              className={cn("chip gap-1.5", setCount > 0 ? "chip-on" : "chip-off")}
            >
              Filters{setCount > 0 && ` (${setCount})`}
              <ChevronDown className={cn("h-4 w-4", menusOpen && "rotate-180")} />
            </button>
          </div>
          <div
            id={menusId}
            role="group"
            aria-label="Filters"
            className={cn(
              "w-full flex-wrap gap-2 sm:flex sm:w-auto",
              menusOpen ? "flex" : "hidden",
            )}
          >
            <RadioFilter
              label="Mode"
              options={MODE_OPTIONS}
              value={filters.mode}
              defaultKey={null}
              onChange={(mode) => update({ mode })}
            />
            <FilterMenu
              label="Area"
              summary={choiceSummary(labelsOf(AREAS, filters.areas))}
              onReset={() => update({ areas: [] })}
            >
              {AREAS.map((a) => (
                <FilterOption
                  key={a.key}
                  type="checkbox"
                  checked={filters.areas.includes(a.key)}
                  onChange={() => toggleArea(a.key)}
                >
                  {a.label}
                </FilterOption>
              ))}
            </FilterMenu>
            <FilterMenu
              label="Fare zone"
              summary={choiceSummary(labelsOf(FARE_ZONES, filters.zones))}
              onReset={() => update({ zones: [] })}
            >
              {FARE_ZONES.filter((z) => servedZones.has(z.key)).map((z) => (
                <FilterOption
                  key={z.key}
                  type="checkbox"
                  checked={filters.zones.includes(z.key)}
                  onChange={() => toggleZone(z.key)}
                >
                  {z.label}
                </FilterOption>
              ))}
            </FilterMenu>
            {operatorOptions.length > 1 && (
              <RadioFilter
                label="Operator"
                options={[
                  { key: null, label: "Any operator" },
                  ...operatorOptions.map((o) => ({ key: o.slug, label: o.name })),
                ]}
                value={filters.op}
                defaultKey={null}
                onChange={(op) => update({ op })}
                summary={(op) => operatorOptions.find((o) => o.slug === op)?.name ?? op}
              />
            )}
            <RadioFilter
              label="School buses"
              options={SCHOOL_FILTERS}
              value={filters.school}
              defaultKey="exclude"
              onChange={(school) => update({ school })}
              summary={schoolFilterSummary}
            />
            <RadioFilter
              label="Running"
              options={DELAY_OPTIONS}
              value={filters.direction}
              defaultKey={null}
              onChange={(direction) => update({ direction })}
            />
            <FilterMenu
              label="More"
              summary={choiceSummary(
                TOGGLES.filter(([key]) => filters[key]).map(([, label]) => label),
              )}
              onReset={() => update({ enoughData: false, cancelledOnly: false, runningNow: false })}
            >
              {TOGGLES.map(([key, label]) => (
                <FilterOption
                  key={key}
                  type="checkbox"
                  checked={filters[key]}
                  onChange={() => update({ [key]: !filters[key] })}
                >
                  {label}
                </FilterOption>
              ))}
            </FilterMenu>
          </div>
          {/* Last in the row, pushed right; on a phone it wraps under the box. */}
          <div className="flex w-full items-center justify-between gap-2 lg:ml-auto lg:w-auto">
            <span role="status" className="text-sm text-at-muted tabular-nums">
              {sorted.length === baseCount
                ? `${formatCount(baseCount)} routes`
                : `${formatCount(sorted.length)} of ${formatCount(baseCount)} routes`}
            </span>
            {!isDefault && (
              <button
                type="button"
                onClick={() => update(DEFAULT_FILTERS)}
                className="chip chip-off gap-1"
              >
                <span aria-hidden>×</span> Reset all
              </button>
            )}
          </div>
        </div>
        {filters.runningNow && !runningSet && (
          <p role="status" className="text-xs text-at-muted">
            {runningSet === undefined
              ? "Checking AT's live feed for what is running now."
              : "AT's live feed could not be read just now, so every route is listed."}
          </p>
        )}
      </Panel>

      {sorted.length === 0 ? (
        <EmptyState>
          {rows.length === 0
            ? "No routes have recorded arrivals in this window yet."
            : "No routes match these filters."}
        </EmptyState>
      ) : (
        // A fixed layout with set figure widths, so the columns hold still as the
        // sort or the page of rows changes; Route takes what is left. Each width
        // fits its heading with the sort arrow, the widest part of the column; a
        // phone gets tighter padding so the route names keep their room.
        <DataTable
          caption="Routes, with their punctuality and cancellations in this window"
          tableClassName="w-full table-fixed"
        >
          <thead>
            <tr className="at-th-row">
              <SortHeader onClick={() => sortBy("route")} dir={dirOf("route")} align="left">
                Route
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("ontime")}
                dir={dirOf("ontime")}
                className={PHONE_FIGURE + " w-20 sm:w-28"}
              >
                On time
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("late")}
                dir={dirOf("late")}
                className={WIDE_FIGURE + " hidden w-22 lg:table-cell"}
              >
                Late
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("early")}
                dir={dirOf("early")}
                className={WIDE_FIGURE + " hidden w-22 lg:table-cell"}
              >
                Early
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("off")}
                dir={dirOf("off")}
                className={PHONE_FIGURE + " w-26 sm:w-28"}
              >
                Avg off by
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("delay")}
                dir={dirOf("delay")}
                className={WIDE_FIGURE + " hidden w-32 sm:table-cell"}
              >
                Early or late
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("arrivals")}
                dir={dirOf("arrivals")}
                className={WIDE_FIGURE + " hidden w-26 md:table-cell"}
              >
                Arrivals
              </SortHeader>
              <SortHeader
                onClick={() => sortBy("cancelled")}
                dir={dirOf("cancelled")}
                className={WIDE_FIGURE + " hidden w-26 md:table-cell"}
              >
                Cancelled
              </SortHeader>
              <th scope="col" className="w-7 p-0">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((r, i) => {
              const thin = firstUnranked !== -1 && i >= firstUnranked;
              const name = routeSubtitle(r);
              const live = runningSet?.has(r.slug) ?? false;
              const op = r.operator ? (operatorName.get(r.operator) ?? null) : null;
              const where = r.areas.map((a) => AREA_LABEL[a]).join(", ");
              const meta = [op, where].filter(Boolean).join(" · ");
              return [
                i === firstUnranked && (
                  <tr key="unranked" className={cn(ROW_CLASS, "no-stripe")}>
                    <td colSpan={COLUMNS} className="bg-at-bg px-3 py-2 text-xs text-at-muted">
                      Not ranked: fewer than {formatCount(minEvents)} arrivals in this window
                    </td>
                  </tr>
                ),
                <tr
                  key={r.slug}
                  className={cn(
                    ROW_CLASS,
                    "group relative hover:bg-at-bg",
                    thin && "text-at-muted",
                  )}
                >
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <div className="flex items-start gap-2">
                      <ModeIcon
                        mode={r.mode}
                        shortName={r.shortName}
                        longName={r.longName}
                        colour={r.colour}
                        className="mt-px h-5 w-5 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {/* The link covers the row, so the whole row opens the route. */}
                          <Link
                            href={routeHref(r.slug, routeParams)}
                            prefetch={false}
                            className={cn(
                              ROUTE_NAME_CLASS,
                              "shrink-0 after:absolute after:inset-0",
                            )}
                          >
                            {routeDisplayName(r)}
                          </Link>
                          {name && <span className="min-w-0 truncate text-at-muted">{name}</span>}
                          {live && (
                            <span className="shrink-0">
                              <Badge tone="live" label="LIVE" />
                              <span className="sr-only"> running now</span>
                            </span>
                          )}
                        </div>
                        {meta && <p className="truncate text-xs text-at-muted">{meta}</p>}
                      </div>
                    </div>
                  </th>
                  <td
                    className={cn(
                      PHONE_FIGURE,
                      "text-right font-semibold whitespace-nowrap tabular-nums",
                      r.on_time_pct !== null && !thin && "text-at-ontime",
                    )}
                  >
                    {formatPct(r.on_time_pct)}
                    <MiniSplit shares={r} className="mt-1" />
                  </td>
                  <td className={cn(WIDE_FIGURE, "hidden text-right tabular-nums lg:table-cell")}>
                    {formatPct(r.late_pct)}
                  </td>
                  <td className={cn(WIDE_FIGURE, "hidden text-right tabular-nums lg:table-cell")}>
                    {formatPct(r.early_pct)}
                  </td>
                  <td className={cn(PHONE_FIGURE, "text-right whitespace-nowrap tabular-nums")}>
                    {r.avg_abs_delay_sec === null
                      ? UNKNOWN_VALUE
                      : formatDuration(r.avg_abs_delay_sec)}
                  </td>
                  <td
                    className={cn(WIDE_FIGURE, "hidden text-right whitespace-nowrap sm:table-cell")}
                  >
                    {/* A distance, never "on time": it sits beside an on-time %, and
                        the two read as disagreeing when this one says "on time". */}
                    <OffScheduleValue signedSec={r.avg_delay_sec} absSec={null} mode={r.mode} />
                  </td>
                  <td className={cn(WIDE_FIGURE, "hidden text-right tabular-nums md:table-cell")}>
                    {formatCount(r.events)}
                  </td>
                  <td
                    className={cn(
                      WIDE_FIGURE,
                      "hidden text-right tabular-nums md:table-cell",
                      r.cancelled > 0 && "text-at-late",
                    )}
                  >
                    {formatCount(r.cancelled)}
                  </td>
                  <td className="py-2 pr-3 text-at-muted group-hover:text-at-shore">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </DataTable>
      )}

      {sorted.length > shown && (
        <ShowMore
          remaining={sorted.length - shown}
          onClick={() => setShown((n) => n + LIST_PAGE_SIZE)}
        />
      )}
    </div>
  );
}
