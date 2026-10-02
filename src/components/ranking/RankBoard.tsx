// src/components/ranking/RankBoard.tsx
// Ranked list of routes with position-movement badges and a link to the full ranking.

import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DotSwatch, SwatchKey } from "@/components/ui/SwatchKey";
import { cn } from "@/lib/cn";
import {
  barPct,
  formatCount,
  formatPct,
  OFF_SCHEDULE_BAR_CLASS,
  OFF_SCHEDULE_TONE_CLASS,
  offScheduleValue,
} from "@/lib/format";
import { type LinkQuery, routeHref } from "@/lib/page/hrefs";
import { routeDisplayName, routeSlug } from "@/lib/route/slug";
import type { RouteRow } from "@/types/api";
import Link from "next/link";
import type { JSX } from "react";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";

/**
 * Position-movement badge: a caret icon + delta count, or a "new" label.
 * @param props - Badge props.
 * @param props.delta - Position change (positive = climbed), or null for new entries.
 * @returns The badge element, or null when there is no movement to show.
 */
function DeltaBadge({ delta }: { delta: number | null | undefined }): JSX.Element | null {
  if (delta === undefined) return null;
  // A literal dash rather than `UNKNOWN_VALUE`: this one means "held its place",
  // which is a known result, not an absent figure.
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

/**
 * The magnitude a row's bar is drawn from: its average distance from the
 * timetable, either way. Falls back to the signed average's magnitude for a row
 * carrying only that, the way {@link offScheduleValue} does, so the bar and the
 * value beside it are never built from different figures.
 * @param row - The ranked row.
 * @returns Seconds, or 0 when the row has no figure at all.
 */
function rowMagnitude(row: RouteRow): number {
  return Math.abs(row.avg_abs_delay_sec ?? row.avg_delay_sec ?? 0);
}

/**
 * Key for the off-schedule board's value and bar colours. Each value already
 * carries its own word ("4m 8s late"), so colour is never the only signal, but
 * on a week view ten green rows under a heading reading "Most off-schedule" look
 * like good news until something says what the green means.
 * @returns The key row.
 */
function DelayColourKey(): JSX.Element {
  const keys = [
    { swatch: "bg-at-ontime", label: "On time" },
    { swatch: "bg-at-late", label: "Late" },
    { swatch: "bg-at-early", label: "Early" },
    { swatch: "bg-at-ink", label: "Mixed" },
  ];
  return (
    <SwatchKey
      className="mt-1"
      items={keys.map((k) => ({ swatch: <DotSwatch className={k.swatch} />, label: k.label }))}
    />
  );
}

/** A single leaderboard of routes with a metric value per row. */
export interface RankBoardProps {
  /** Board heading. */
  title: string;
  /** Tailwind text-colour class for the heading accent. */
  accentClass: string;
  /** Ranked rows to show. */
  rows: RouteRow[];
  /** Which metric to render on the right. */
  metric: "delay" | "onTime";
  /**
   * One line under the heading saying what the value column is. Both boards
   * carry one, so their row lists start at the same height when the two sit
   * side by side.
   */
  caption?: string;
  /**
   * Params each route link carries so the route opens on the window being
   * viewed, built by `routeLinkParams`. Omit for the route's default view.
   */
  routeParams?: LinkQuery;
  /** Per-route position delta from the previous period (positive = climbed, null = new entry). */
  deltas?: Map<string, number | null>;
  /** Cancelled trips per route slug in the same window; a route with any gets an "N cancelled" note. */
  cancelled?: Map<string, number>;
  /**
   * Link to the full ranking (the Routes page on the matching preset). When set,
   * the heading carries "See all N" beside it.
   */
  seeAllHref?: string;
  /** How many routes the full ranking holds, for the "See all" link. */
  total?: number;
  /**
   * The arrivals bar a route had to clear to be ranked here, named in the empty
   * state. Omit for a board with no bar (a stop's routes), which then says the
   * window recorded nothing rather than that something was not enough.
   */
  minEvents?: number;
  /** The heading level: `h3` under a band heading (the default), `h2` where the board is a page section itself. */
  headingLevel?: "h2" | "h3";
}

/**
 * Render a ranked board of routes (most off-schedule or most reliable) from the
 * rows given; the home page passes the top ten and link the heading
 * to the full ranking on the Routes page. Every row carries a bar under it, so
 * the gap between first and tenth is visible without reading ten figures - the
 * board's whole point, and the one thing a column of numbers cannot show.
 * @param props - Board props.
 * @param props.title - Board heading.
 * @param props.accentClass - Tailwind text-colour class for the heading.
 * @param props.rows - Ranked rows.
 * @param props.metric - Whether the right column is a delay or on-time %.
 * @param props.caption - One line under the heading saying what the column is (optional).
 * @param props.routeParams - Params each route link carries, from `routeLinkParams` (optional).
 * @param props.deltas - Per-route position deltas from the previous period (optional).
 * @param props.cancelled - Cancelled trips per route slug, shown beside each route's name (optional).
 * @param props.seeAllHref - Link to the full ranking (optional).
 * @param props.total - How many routes the full ranking holds (optional).
 * @param props.minEvents - The arrivals bar a route had to clear to be ranked (optional).
 * @param props.headingLevel - The heading level.
 * @returns The board element.
 */
export function RankBoard({
  title,
  accentClass,
  rows,
  metric,
  caption,
  routeParams,
  deltas,
  cancelled,
  seeAllHref,
  total,
  minEvents,
  headingLevel = "h3",
}: RankBoardProps): JSX.Element {
  // Off-schedule bars are scaled to the worst row on this board, so the top row
  // always fills its track and the ten rows read as a shape rather than as ten
  // numbers. The on-time board needs no scale: its bar is the share itself.
  const worst = Math.max(0, ...rows.map(rowMagnitude));
  return (
    <section className="bg-at-surface">
      <SectionHeading as={headingLevel} className={cn("mb-1", accentClass)}>
        {seeAllHref ? (
          <Link
            href={seeAllHref}
            className="flex w-full items-center gap-1.5 transition-opacity hover:opacity-80"
          >
            <span>{title}</span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
            <span className="ml-auto text-sm font-normal text-at-muted">
              See all{total !== undefined ? ` ${formatCount(total)}` : ""}
            </span>
          </Link>
        ) : (
          title
        )}
      </SectionHeading>
      {/* Both boards reserve the same block, caption plus key, so the two row
          lists start level. The key only has something to say on the signed
          board, where the colour varies. */}
      <div className="mb-3 min-h-14">
        {caption && <p className="text-sm text-at-muted">{caption}</p>}
        {metric === "delay" && <DelayColourKey />}
      </div>
      {rows.length === 0 ? (
        <EmptyState inset>
          {minEvents === undefined
            ? "No arrivals were recorded in this window, so there is nothing to rank."
            : `No route reached ${minEvents} arrivals in this window, so there is nothing to rank.`}
        </EmptyState>
      ) : (
        <ol className="striped border-t border-at-border">
          {rows.map((r, i) => {
            // Ranked by abs deviation, so the value always names a distance and
            // the column reads in descending order.
            const off = offScheduleValue(r.avg_delay_sec, r.avg_abs_delay_sec, r.mode);
            // An unknown share is the placeholder alone: a percent sign welded to
            // it read "—%", which looks like a measured figure that failed to print.
            const value = metric === "delay" ? off.text : formatPct(r.on_time_pct);
            const cancelledCount = cancelled?.get(routeSlug(r.routeId)) ?? 0;
            const valueClass =
              metric === "onTime" ? "text-at-ontime" : OFF_SCHEDULE_TONE_CLASS[off.tone];
            const barClass =
              metric === "onTime" ? "bg-at-ontime" : OFF_SCHEDULE_BAR_CLASS[off.tone];
            const share =
              metric === "onTime"
                ? (r.on_time_pct ?? 0)
                : worst > 0
                  ? (rowMagnitude(r) / worst) * 100
                  : 0;
            return (
              <li key={r.routeId}>
                {/* The whole row is the link, so the value/over area is clickable too. */}
                <Link
                  href={routeHref(r.routeId, routeParams)}
                  className={cn(
                    "-mx-2 block px-2 py-3 text-base transition-colors hover:bg-at-shore-pale",
                    i > 0 && "border-t border-at-border",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {deltas ? (
                      <span className="flex w-14 shrink-0 items-center">
                        <span className="w-5 shrink-0 text-right text-at-muted tabular-nums">
                          {i + 1}
                        </span>
                        <span className="flex w-9 shrink-0 items-center pl-0.5">
                          <DeltaBadge delta={deltas.get(r.routeId)} />
                        </span>
                      </span>
                    ) : (
                      <span className="w-5 text-right text-at-muted tabular-nums">{i + 1}</span>
                    )}
                    <ModeIcon mode={r.mode} shortName={r.shortName} longName={r.longName} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-at-shore">
                      {routeDisplayName(r)}
                      {cancelledCount > 0 && (
                        <span className="ml-2 text-xs font-semibold text-at-late">
                          {cancelledCount} cancelled
                        </span>
                      )}
                    </span>
                    <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                      {value}
                    </span>
                    <ChevronRight className="shrink-0 text-at-muted" />
                  </span>
                  {/* Decorative: the figure the bar is drawn from is printed on the
                      row beside it, in the colour the board's key names. */}
                  <span aria-hidden className="mt-2 flex h-1.5 overflow-hidden bg-at-bg">
                    <span className={barClass} style={{ width: `${barPct(share)}%` }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
