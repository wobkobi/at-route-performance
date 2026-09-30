"use client";
// src/components/route/RouteExplorer.tsx
// The Routes page body: filter and sort controls (with presets for the home
// page's Most off-schedule and Most reliable boards in full), the KPI strip for
// exactly the routes that pass the filters, and the route list with a "More
// details" link per route, ranked when sorted by a measure. Filtering runs on the client (a few hundred rows), so a change is
// instant; the state is written back to the query string with replaceState, so
// the view survives a reload and can be shared without a navigation.

import { choiceSummary, FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { FleetSummary } from "@/components/ranking/FleetSummary";
import { cn } from "@/lib/cn";
import {
  formatDuration,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
  UNKNOWN_VALUE,
} from "@/lib/format";
import { AREA_LABEL, AREAS, type AreaKey } from "@/lib/geo/areas";
import { FARE_ZONES, type FareZoneKey } from "@/lib/geo/fare-zones";
import { summariseRows } from "@/lib/rankings";
import {
  activeView,
  DEFAULT_FILTERS,
  defaultDir,
  EXPLORER_PARAMS,
  EXPLORER_SORTS,
  EXPLORER_VIEWS,
  explorerQuery,
  filterRoutes,
  PAGE_SIZE,
  SHOWN_PARAM,
  sortRoutes,
  type ExplorerFilters,
  type ExplorerRoute,
  type ExplorerSort,
} from "@/lib/route/explorer";
import { lineName } from "@/lib/route/line-name";
import { SCHOOL_FILTERS, schoolFilterSummary } from "@/lib/school-bus";
import Link from "next/link";
import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";

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
  /** Query (with its `?`) each route link carries, so the route opens on the same window. */
  routeQuery: string;
  /**
   * Slugs of the routes with a vehicle on a run now, or null when AT's feed
   * could not be read. Unresolved, so the list never waits on the feed.
   */
  running: Promise<string[] | null>;
}

/** A square button in the filter panel, matching the search field and selects. */
const BOX =
  "inline-flex items-center gap-1 border px-3 py-1.5 text-sm font-semibold transition-colors";

/** {@link BOX} when not chosen. */
const BOX_OFF =
  "border-at-border bg-at-surface text-at-ink hover:border-at-shore hover:text-at-shore";

/** The Mode filter's choices, null for every mode. */
const MODES = [
  [null, "All"],
  ["BUS", "Bus"],
  ["TRAIN", "Train"],
  ["FERRY", "Ferry"],
] as const;

/** The Running filter's choices, null for either way. */
const LEANS = [
  [null, "Either way"],
  ["late", "Late"],
  ["early", "Early"],
] as const;

/** The on/off filters gathered under More. */
const TOGGLES = [
  ["enoughData", "Enough data to rank"],
  ["cancelledOnly", "Had cancellations"],
  ["runningNow", "Running now"],
] as const;

/**
 * A labelled row of filter chips.
 * @param props - Component props.
 * @param props.label - The row label.
 * @param props.children - The chips.
 * @returns The row.
 */
function FilterRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-20 shrink-0 text-xs font-semibold tracking-zero text-at-muted uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * One figure in a route card.
 * @param props - Component props.
 * @param props.label - The figure's label.
 * @param props.children - The value.
 * @param props.className - Classes for the value (colour).
 * @returns The figure.
 */
function Figure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-zero text-at-muted uppercase">{label}</dt>
      <dd className={cn("truncate font-semibold tabular-nums", className)}>{children}</dd>
    </div>
  );
}

/**
 * Filterable, sortable list of routes with a KPI strip over the matching ones.
 * @param props - Component props.
 * @param props.rows - Every route with arrivals in the window.
 * @param props.operators - The stored operators' slugs and names.
 * @param props.initialFilters - The filters parsed from the query string.
 * @param props.initialShown - How many rows to show, parsed from the query string.
 * @param props.routeQuery - Query each route link carries.
 * @param props.running - Slugs of the routes running now, unresolved.
 * @returns The explorer.
 */
export function RouteExplorer({
  rows,
  operators,
  initialFilters,
  initialShown,
  routeQuery,
  running,
}: RouteExplorerProps): JSX.Element {
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [shown, setShown] = useState(initialShown);
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

  const matching = useMemo(
    () => filterRoutes(rows, filters, runningSet ?? null),
    [rows, filters, runningSet],
  );
  const sorted = useMemo(
    () => sortRoutes(matching, filters.sort, filters.dir),
    [matching, filters.sort, filters.dir],
  );
  const hero = useMemo(
    () => ({
      ...summariseRows(matching),
      cancelled: matching.reduce((n, r) => n + r.cancelled, 0),
    }),
    [matching],
  );

  // Mirror the filters and the row count into the query string, keeping the
  // window params the server owns. replaceState updates the URL without a
  // navigation or refetch - which is also why the count belongs here: the entry
  // it overwrites is the one Back returns to, so a count held only in state
  // comes back as the first page after opening a route and stepping back.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of EXPLORER_PARAMS) params.delete(key);
    params.delete(SHOWN_PARAM);
    for (const [k, v] of Object.entries(explorerQuery(filters))) params.set(k, v);
    if (shown > PAGE_SIZE) params.set(SHOWN_PARAM, String(shown));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [filters, shown]);

  /**
   * Apply a filter change and return to the top of the list.
   * @param patch - The fields to change.
   */
  const update = (patch: Partial<ExplorerFilters>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE_SIZE);
  };

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

  const isDefault = Object.keys(explorerQuery(filters)).length === 0;
  const view = activeView(filters);
  // Sorted by a measure, the list is a ranking, so each route shows its place.
  const ranked = filters.sort !== "route";
  // The count is out of the routes the school-bus choice leaves, so the default
  // view (school services hidden) reads as every route rather than a filtered few.
  const baseCount = useMemo(
    () => filterRoutes(rows, { ...DEFAULT_FILTERS, school: filters.school }).length,
    [rows, filters.school],
  );

  return (
    <div className="space-y-6">
      <FleetSummary data={hero} />

      <section
        aria-label="Filter and sort routes"
        className="space-y-3 border border-at-border bg-at-surface p-4"
      >
        <input
          type="search"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search by route number or name"
          aria-label="Search routes"
          className="w-full border border-at-border bg-at-surface px-3 py-2 text-sm placeholder:text-at-muted focus:border-at-shore"
        />
        <FilterRow label="Show">
          {EXPLORER_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => update(v.filters)}
              className={cn(
                BOX,
                view === v.key ? "border-at-shore bg-at-shore text-white" : BOX_OFF,
              )}
            >
              {v.label}
            </button>
          ))}
        </FilterRow>
        <FilterRow label="Filter">
          <FilterMenu
            label="Mode"
            summary={MODES.find(([key]) => key !== null && key === filters.mode)?.[1] ?? null}
            onReset={() => update({ mode: null })}
          >
            {MODES.map(([key, label]) => (
              <FilterOption
                key={label}
                type="radio"
                name="explorer-mode"
                checked={filters.mode === key}
                onChange={() => update({ mode: key })}
              >
                {label}
              </FilterOption>
            ))}
          </FilterMenu>
          <FilterMenu
            label="Area"
            summary={choiceSummary(
              AREAS.filter((a) => filters.areas.includes(a.key)).map((a) => a.label),
            )}
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
            summary={choiceSummary(
              FARE_ZONES.filter((z) => filters.zones.includes(z.key)).map((z) => z.label),
            )}
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
            <FilterMenu
              label="Operator"
              summary={
                filters.op === null
                  ? null
                  : (operatorOptions.find((o) => o.slug === filters.op)?.name ?? filters.op)
              }
              onReset={() => update({ op: null })}
            >
              <FilterOption
                type="radio"
                name="explorer-op"
                checked={filters.op === null}
                onChange={() => update({ op: null })}
              >
                Any operator
              </FilterOption>
              {operatorOptions.map((o) => (
                <FilterOption
                  key={o.slug}
                  type="radio"
                  name="explorer-op"
                  checked={filters.op === o.slug}
                  onChange={() => update({ op: o.slug })}
                >
                  {o.name}
                </FilterOption>
              ))}
            </FilterMenu>
          )}
          <FilterMenu
            label="School buses"
            summary={schoolFilterSummary(filters.school)}
            onReset={() => update({ school: "exclude" })}
          >
            {SCHOOL_FILTERS.map((f) => (
              <FilterOption
                key={f.key}
                type="radio"
                name="explorer-school"
                checked={filters.school === f.key}
                onChange={() => update({ school: f.key })}
              >
                {f.label}
              </FilterOption>
            ))}
          </FilterMenu>
          <FilterMenu
            label="Running"
            summary={LEANS.find(([key]) => key !== null && key === filters.lean)?.[1] ?? null}
            onReset={() => update({ lean: null })}
            activeClass={
              filters.lean === "late"
                ? "border-at-late bg-at-surface text-at-late"
                : "border-at-early-strong bg-at-surface text-at-early-strong"
            }
          >
            {LEANS.map(([key, label]) => (
              <FilterOption
                key={label}
                type="radio"
                name="explorer-lean"
                checked={filters.lean === key}
                onChange={() => update({ lean: key })}
              >
                {label}
              </FilterOption>
            ))}
          </FilterMenu>
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
        </FilterRow>
        {filters.runningNow && !runningSet && (
          <p role="status" className="text-xs text-at-muted">
            {runningSet === undefined
              ? "Checking AT's live feed for what is running now."
              : "AT's live feed could not be read just now, so every route is listed."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-at-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold tracking-zero text-at-muted uppercase">
              Sort by
            </span>
            <select
              value={filters.sort}
              onChange={(e) => {
                const sort = e.target.value as ExplorerSort;
                update({ sort, dir: defaultDir(sort) });
              }}
              className="border border-at-border bg-at-surface px-2 py-1.5 text-sm focus:border-at-shore"
            >
              {EXPLORER_SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => update({ dir: filters.dir === "asc" ? "desc" : "asc" })}
            aria-label={filters.dir === "asc" ? "Sorted low to high" : "Sorted high to low"}
            className={cn(BOX, BOX_OFF)}
          >
            {filters.dir === "asc" ? "Low to high ↑" : "High to low ↓"}
          </button>
          <span className="ml-auto text-sm text-at-muted tabular-nums">
            {sorted.length === baseCount
              ? `${baseCount} routes`
              : `${sorted.length} of ${baseCount} routes`}
          </span>
          {!isDefault && (
            <button
              type="button"
              onClick={() => update(DEFAULT_FILTERS)}
              className={cn(BOX, BOX_OFF)}
            >
              <span aria-hidden>×</span> Reset all
            </button>
          )}
        </div>
      </section>

      {sorted.length === 0 ? (
        <p className="border border-at-border bg-at-surface p-4 text-sm text-at-muted">
          {rows.length === 0
            ? "No routes have recorded arrivals in this window yet."
            : "No routes match these filters."}
        </p>
      ) : (
        <ol className="space-y-2">
          {sorted.slice(0, shown).map((r, i) => {
            const label = r.short_name || r.long_name || r.slug;
            const subtitle =
              lineName(r.mode, r.short_name) ?? (r.long_name !== label ? r.long_name : null);
            // Always a distance, never the words "on time": this sits beside an
            // on-time percentage, and a delay figure reading "on time" under an
            // "Early or late" label read as the two figures disagreeing.
            const offSchedule = offScheduleValue(r.avg_delay_sec, null, r.mode);
            return (
              <li
                key={r.slug}
                className="flex flex-col gap-3 border border-at-border bg-at-surface p-4 md:flex-row md:items-center md:gap-6"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {ranked && (
                    <span className="mt-0.5 w-8 shrink-0 text-right text-lg leading-tight font-ultra tracking-zero text-at-muted tabular-nums">
                      {i + 1}
                    </span>
                  )}
                  <ModeIcon
                    mode={r.mode}
                    shortName={r.short_name}
                    longName={r.long_name}
                    colour={r.colour}
                    className="mt-0.5 h-6 w-6"
                  />
                  <div className="min-w-0">
                    <p className="text-lg leading-tight font-ultra tracking-zero">
                      <Link
                        href={`/route/${encodeURIComponent(r.slug)}${routeQuery}`}
                        prefetch={false}
                        className="text-at-ink hover:text-at-shore hover:underline"
                      >
                        {label}
                      </Link>
                    </p>
                    {subtitle && <p className="truncate text-sm text-at-muted">{subtitle}</p>}
                    {r.areas.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {/* Each area narrows the list to it, as its chip in the Area filter does. */}
                        {r.areas.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => {
                              if (!filters.areas.includes(a)) toggleArea(a);
                            }}
                            aria-pressed={filters.areas.includes(a)}
                            className="bg-at-bg px-2 py-0.5 text-xs text-at-muted hover:text-at-shore hover:underline"
                          >
                            {AREA_LABEL[a]}
                          </button>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 md:w-md md:shrink-0">
                  <Figure label="On time">
                    {r.on_time_pct === null ? UNKNOWN_VALUE : `${r.on_time_pct.toFixed(1)}%`}
                  </Figure>
                  <Figure
                    label="Early or late"
                    className={OFF_SCHEDULE_TONE_CLASS[offSchedule.tone]}
                  >
                    {offSchedule.text}
                  </Figure>
                  <Figure label="Off by">
                    {r.avg_abs_delay_sec === null
                      ? UNKNOWN_VALUE
                      : formatDuration(r.avg_abs_delay_sec)}
                  </Figure>
                  <Figure
                    label="Cancelled"
                    className={r.cancelled > 0 ? "text-at-late" : undefined}
                  >
                    {r.cancelled.toLocaleString()}
                  </Figure>
                </dl>
                <Link
                  href={`/route/${encodeURIComponent(r.slug)}${routeQuery}`}
                  prefetch={false}
                  className="at-btn shrink-0 border border-at-shore text-at-shore hover:bg-at-shore-pale"
                >
                  More details
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {sorted.length > shown && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
            className="chip chip-off"
          >
            Show {Math.min(PAGE_SIZE, sorted.length - shown)} more of {sorted.length - shown}
          </button>
        </div>
      )}
    </div>
  );
}
