"use client";
// src/components/RouteTable.tsx
/**
 * @description Render a sortable table of routes with event counts and on-time stats.
 */

import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import { routeSlug } from "@/lib/route-slug";
import type { TopRouteRow } from "@/types/api";
import { useState, type JSX } from "react";

/** Sortable columns for {@link RouteTable}. */
export type RouteSort = "route" | "events" | "avg_delay" | "on_time";

/** Sort direction. */
type SortDir = "asc" | "desc";

/** Props for {@link RouteTable}. */
export interface RouteTableProps {
  /** All rows to show. */
  rows: TopRouteRow[];
  /** Initial sort column. */
  sort: RouteSort;
  /**
   * Service day (`YYYY-MM-DD`) to pin on each route link, so the route opens on
   * the same day being viewed. Omit to link to the route's default day.
   */
  routeDay?: string;
  /**
   * Window to open on each route link (e.g. `"week"`). Applied when `routeDay`
   * is absent; omit to open the route's default day view.
   */
  routeWindow?: string;
  /**
   * Calendar period to pin on each route link (`YYYY-MM-DD` Monday for week,
   * `YYYY-MM` for month). Applied alongside `routeWindow`; omit for the rolling
   * default.
   */
  routePeriod?: string;
}

/**
 * Compare two rows by a column (ascending). Route is compared by name with
 * numeric awareness (so 9 sorts before 100); other columns are numeric.
 * @param a - First row.
 * @param b - Second row.
 * @param key - Column to compare by.
 * @returns Negative, zero, or positive per the standard sort contract.
 */
function compareRows(a: TopRouteRow, b: TopRouteRow, key: RouteSort): number {
  switch (key) {
    case "events":
      return a.events - b.events;
    case "avg_delay":
      return (a.avg_delay_sec ?? 0) - (b.avg_delay_sec ?? 0);
    case "on_time":
      return (a.on_time_pct ?? 0) - (b.on_time_pct ?? 0);
    case "route":
    default:
      return (a.short_name ?? a.route_id).localeCompare(b.short_name ?? b.route_id, undefined, {
        numeric: true,
      });
  }
}

/**
 * The full routes table with a live search (route number or name) and instant
 * client-side column sorting - click a header to sort, click again to flip the
 * direction. No page reload, so the search text and the open panel are kept.
 * @param props - Component props.
 * @param props.rows - All routes to show.
 * @param props.sort - Initial sort column.
 * @param props.routeDay - Service day to pin on each route link (optional).
 * @param props.routeWindow - Window to open on each route link when no day is pinned (optional).
 * @param props.routePeriod - Calendar period to pin alongside `routeWindow` (optional).
 * @returns The table element.
 */
export function RouteTable({
  rows,
  sort,
  routeDay,
  routeWindow,
  routePeriod,
}: RouteTableProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<RouteSort>(sort);
  // Names read best ascending (A>Z, 1>100); counts/rates read best high-first.
  const [sortDir, setSortDir] = useState<SortDir>(sort === "route" ? "asc" : "desc");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        `${r.short_name ?? ""} ${r.long_name ?? ""} ${r.route_id}`.toLowerCase().includes(q),
      )
    : rows;
  const sorted = [...filtered].sort((a, b) => {
    const c = compareRows(a, b, sortKey);
    return sortDir === "asc" ? c : -c;
  });

  const head: { key: RouteSort; label: string; align: string }[] = [
    { key: "route", label: "Route", align: "text-left" },
    { key: "events", label: "Events", align: "text-right" },
    { key: "avg_delay", label: "Avg delay", align: "text-right" },
    { key: "on_time", label: "On-time %", align: "text-right" },
  ];

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search routes by number or name"
        aria-label="Search routes"
        className="w-full border border-at-border bg-at-surface px-3 py-2 text-sm placeholder:text-at-muted focus:border-at-shore focus:outline-none"
      />
      <div className="overflow-x-auto border border-at-border bg-at-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-at-bg text-xs tracking-wide text-at-muted uppercase">
            <tr>
              {head.map((h) => {
                const active = sortKey === h.key;
                return (
                  <th
                    key={h.key}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("px-3 py-2.5 font-semibold", h.align)}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        active
                          ? setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                          : (setSortKey(h.key), setSortDir(h.key === "route" ? "asc" : "desc"))
                      }
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-at-ink",
                        active && "text-at-ink",
                      )}
                    >
                      {h.label}
                      {active && (
                        <ChevronRight
                          className={cn("h-3 w-3", sortDir === "asc" ? "-rotate-90" : "rotate-90")}
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={head.length} className="px-3 py-4 text-center text-at-muted">
                  No routes match &ldquo;{query.trim()}&rdquo;.
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                return (
                  <tr
                    key={r.route_id}
                    className="border-t border-at-border transition-colors hover:bg-at-shore-pale"
                  >
                    <td className="px-3 py-2.5 font-medium">
                      <span className="flex items-center gap-2">
                        <ModeIcon
                          mode={r.mode}
                          shortName={r.short_name}
                          longName={r.long_name}
                          colour={r.colour}
                        />
                        <a
                          href={
                            routeDay
                              ? `/route/${encodeURIComponent(routeSlug(r.route_id))}?day=${routeDay}`
                              : routeWindow
                                ? `/route/${encodeURIComponent(routeSlug(r.route_id))}?window=${routeWindow}${routePeriod ? `&period=${routePeriod}` : ""}`
                                : `/route/${encodeURIComponent(routeSlug(r.route_id))}`
                          }
                          className="font-semibold text-at-shore hover:underline"
                        >
                          {r.short_name || r.long_name || r.route_id}
                        </a>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.events}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.avg_delay_sec == null ? "—" : formatDelay(r.avg_delay_sec)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.on_time_pct?.toFixed(1) ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
