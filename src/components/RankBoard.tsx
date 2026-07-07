"use client";
// src/components/RankBoard.tsx
/**
 * @description Ranked table of routes with position-movement badges and expandable delay detail.
 */

import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { formatDelay, formatDuration } from "@/lib/format";
import { EARLY_TOLERANCE_SEC, isConsistentlyLateOrEarly, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import type { TopRouteRow } from "@/types/api";
import type { JSX } from "react";
import { useState } from "react";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";

/**
 * Position-movement badge: a caret icon + delta count, or a "new" label.
 * @param props - Badge props.
 * @param props.delta - Position change (positive = climbed), or null for new entries.
 * @returns The badge element, or null when there is no movement to show.
 */
function DeltaBadge({ delta }: { delta: number | null | undefined }): JSX.Element | null {
  if (delta === undefined) return null;
  if (delta === 0)
    return <span className="text-xs leading-none font-semibold text-at-muted">—</span>;
  if (delta === null)
    return <span className="text-xs leading-none font-semibold text-at-muted">new</span>;
  const up = delta > 0;
  return (
    <span className="flex items-center text-xs leading-none font-semibold text-at-muted tabular-nums">
      {up ? (
        <FaCaretUp aria-hidden className="h-3 w-3 shrink-0" />
      ) : (
        <FaCaretDown aria-hidden className="h-3 w-3 shrink-0" />
      )}
      {Math.abs(delta)}
    </span>
  );
}

/** Plain-English on-time window for the off-schedule board caption. */
const ON_TIME_CAPTION = `On time = ${EARLY_TOLERANCE_SEC.BUS / 60} min early to ${ON_TIME_LATE_SEC / 60} min late (ferries: ${ON_TIME_LATE_SEC / 60} min either way)`;

/** A single leaderboard of routes with a metric value per row. */
export interface RankBoardProps {
  /** Board heading. */
  title: string;
  /** Tailwind text-colour class for the heading accent. */
  accentClass: string;
  /** Ranked rows to show. */
  rows: TopRouteRow[];
  /** Which metric to render on the right. */
  metric: "delay" | "onTime";
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
   * Calendar period to pin on each route link (Monday `YYYY-MM-DD` for week,
   * `YYYY-MM` for month). Applied alongside `routeWindow`; omit for the rolling
   * default.
   */
  routePeriod?: string;
  /** Per-route position delta from the previous period (positive = climbed, null = new entry). */
  deltas?: Map<string, number | null>;
  /**
   * When set and there are more rows than this, collapse to this many and turn
   * the heading into a toggle that reveals the full list. Omit to always show
   * every row.
   */
  collapseAt?: number;
}

/**
 * Render a ranked board of routes (earliest, latest, or most reliable). When
 * `collapseAt` is set and exceeded, the heading toggles between the top
 * `collapseAt` rows and the full list.
 * @param props - Board props.
 * @param props.title - Board heading.
 * @param props.accentClass - Tailwind text-colour class for the heading.
 * @param props.rows - Ranked rows.
 * @param props.metric - Whether the right column is a delay or on-time %.
 * @param props.routeDay - Service day to pin on each route link (optional).
 * @param props.routeWindow - Window to open on each route link when no day is pinned (optional).
 * @param props.routePeriod - Calendar period to pin alongside `routeWindow` (optional).
 * @param props.deltas - Per-route position deltas from the previous period (optional).
 * @param props.collapseAt - Collapse to this many rows behind a heading toggle (optional).
 * @returns The board element.
 */
export function RankBoard({
  title,
  accentClass,
  rows,
  metric,
  routeDay,
  routeWindow,
  routePeriod,
  deltas,
  collapseAt,
}: RankBoardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const collapsible = collapseAt != null && rows.length > collapseAt;
  const visibleRows = collapsible && !expanded ? rows.slice(0, collapseAt) : rows;
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className={cn("mb-1 text-lg font-ultra tracking-zero", accentClass)}>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-1.5 text-left transition-opacity hover:opacity-80"
          >
            <span>{title}</span>
            <ChevronRight
              aria-hidden
              className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-90")}
            />
            <span className="ml-auto text-sm font-normal text-at-muted">
              {expanded ? "Show less" : `Show all ${rows.length}`}
            </span>
          </button>
        ) : (
          title
        )}
      </h2>
      <div className="mb-3 min-h-5">
        {metric === "delay" && <p className="text-sm text-at-muted">{ON_TIME_CAPTION}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-at-muted">Not enough data yet.</p>
      ) : (
        <ol>
          {visibleRows.map((r, i) => {
            // Ranked by abs deviation; display the same so the column numbers are
            // in descending order. When abs ≈ |signed| the route is consistently
            // late/early - show direction ("4m 8s late"). When they differ the
            // route is mixed - show magnitude only ("5m off").
            const signed = r.avg_delay_sec ?? 0;
            const abs = r.avg_abs_delay_sec ?? Math.abs(signed);
            // A row with no plausible deviations has null delays - show a dash
            // rather than coercing to 0 and rendering a spurious "on time".
            const noDelayData = r.avg_delay_sec == null && r.avg_abs_delay_sec == null;
            const value =
              metric === "delay"
                ? noDelayData
                  ? "—"
                  : isConsistentlyLateOrEarly(signed, abs)
                    ? formatDelay(signed)
                    : `${formatDuration(abs)} off`
                : `${r.on_time_pct?.toFixed(1) ?? "—"}%`;
            const valueClass =
              metric === "onTime"
                ? "text-at-ontime"
                : signed > 0
                  ? "text-at-late"
                  : signed < 0
                    ? "text-at-early"
                    : "text-at-ink";
            return (
              <li key={r.route_id}>
                {/* The whole row is the link, so the value/over area is clickable too. */}
                <a
                  href={
                    routeDay
                      ? `/route/${encodeURIComponent(routeSlug(r.route_id))}?day=${routeDay}`
                      : routeWindow
                        ? `/route/${encodeURIComponent(routeSlug(r.route_id))}?window=${routeWindow}${routePeriod ? `&period=${routePeriod}` : ""}`
                        : `/route/${encodeURIComponent(routeSlug(r.route_id))}`
                  }
                  className={cn(
                    "-mx-4 flex items-center gap-2 px-4 py-3 text-base transition-colors hover:bg-at-shore-pale",
                    i > 0 && "border-t border-at-border",
                  )}
                >
                  {deltas ? (
                    <span className="flex w-14 shrink-0 items-center">
                      <span className="w-5 shrink-0 text-right text-at-muted tabular-nums">
                        {i + 1}
                      </span>
                      <span className="flex w-9 shrink-0 items-center pl-0.5">
                        <DeltaBadge delta={deltas.get(r.route_id)} />
                      </span>
                    </span>
                  ) : (
                    <span className="w-5 text-right text-at-muted tabular-nums">{i + 1}</span>
                  )}
                  <ModeIcon
                    mode={r.mode}
                    shortName={r.short_name}
                    longName={r.long_name}
                    colour={r.colour}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold text-at-shore">
                    {r.short_name || r.long_name || r.route_id}
                  </span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                    {value}
                  </span>
                  <ChevronRight className="shrink-0 text-at-muted" />
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
