import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import { linkColour } from "@/lib/link-colour";
import type { TopRouteRow } from "@/types/api";
import type { JSX } from "react";

/** Sortable columns for {@link RouteTable}. */
export type RouteSort = "route" | "events" | "avg_delay" | "on_time";

/** Props for {@link RouteTable}. */
export interface RouteTableProps {
  /** All rows to show (already sorted by the caller). */
  rows: TopRouteRow[];
  /** Base path for sort links (e.g. "/" or "/rankings"). */
  basePath: string;
  /** Current query string params to preserve in sort links. */
  preservedParams: Record<string, string>;
  /** Active sort. */
  sort: RouteSort;
}

/**
 * Build an href that preserves params and sets a new sort column.
 * @param basePath - Page path.
 * @param preserved - Params to keep.
 * @param sort - Sort column to set.
 * @returns A relative URL string.
 */
function sortHref(basePath: string, preserved: Record<string, string>, sort: RouteSort): string {
  const sp = new URLSearchParams({ ...preserved, sort });
  return `${basePath}?${sp.toString()}`;
}

/**
 * Render the full, server-sorted routes table.
 * @param props - Component props.
 * @param props.rows - Rows in display order.
 * @param props.basePath - Page path for sort links.
 * @param props.preservedParams - Params to preserve in sort links.
 * @param props.sort - Active sort column.
 * @returns The table element.
 */
export function RouteTable({
  rows,
  basePath,
  preservedParams,
  sort,
}: RouteTableProps): JSX.Element {
  const head: { key: RouteSort; label: string; align: string }[] = [
    { key: "route", label: "Route", align: "text-left" },
    { key: "events", label: "Events", align: "text-right" },
    { key: "avg_delay", label: "Avg delay", align: "text-right" },
    { key: "on_time", label: "On-time %", align: "text-right" },
  ];
  return (
    <div className={cn("overflow-x-auto rounded-xl bg-at-surface shadow-sm")}>
      <table className={cn("min-w-full text-sm")}>
        <thead className={cn("bg-at-bg text-at-muted")}>
          <tr>
            {head.map((h) => (
              <th key={h.key} className={cn("px-3 py-2", h.align)}>
                <a
                  href={sortHref(basePath, preservedParams, h.key)}
                  className={cn("hover:underline", sort === h.key && "font-semibold text-at-ink")}
                >
                  {h.label}
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const colour = linkColour(r.short_name, r.long_name);
            return (
              <tr key={r.route_id} className={cn("border-t border-at-border")}>
                <td className={cn("px-3 py-2 font-medium")}>
                  <span className={cn("flex items-center gap-2")}>
                    {colour && (
                      <span
                        aria-hidden
                        className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", colour)}
                      />
                    )}
                    <a
                      href={`/route/${encodeURIComponent(r.route_id)}`}
                      className={cn("hover:underline")}
                    >
                      {r.short_name || r.long_name || r.route_id}
                    </a>
                  </span>
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums")}>{r.events}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums")}>
                  {formatDelay(r.avg_delay_sec ?? 0)}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums")}>
                  {r.on_time_pct?.toFixed(1) ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
