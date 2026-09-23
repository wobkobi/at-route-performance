// src/components/RankBoard.tsx
// Ranked list of routes with position-movement badges and a link to the full ranking.

import { ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { ON_TIME_WINDOW_NOTE } from "@/lib/copy";
import { OFF_SCHEDULE_TONE_CLASS, offScheduleValue } from "@/lib/format";
import { earlyToleranceFor, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import type { TopRouteRow } from "@/types/api";
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

/** Plain-English on-time window, for the board captions, and whose window it is. */
export const ON_TIME_CAPTION = `On time = ${earlyToleranceFor("BUS") / 60} min early to ${ON_TIME_LATE_SEC / 60} min late (ferries: ${ON_TIME_LATE_SEC / 60} min either way). ${ON_TIME_WINDOW_NOTE}`;

/**
 * Caption for the reliable board, whose column is the on-time share itself.
 * Names the window rather than pointing at the other board's caption, so it
 * still reads on a phone, where the two boards are stacked rather than paired.
 */
export const ON_TIME_SHARE_CAPTION = "Share of arrivals inside the on-time window";

/**
 * Key for the off-schedule board's value colours. Each value already carries
 * its own word ("4m 8s late"), so colour is never the only signal, but on a
 * week view ten green rows under a heading reading "Most off-schedule" look
 * like good news until something says what the green means.
 * @returns The key row.
 */
function DelayColourKey(): JSX.Element {
  const keys = [
    { swatch: "bg-at-late", label: "Late" },
    { swatch: "bg-at-early", label: "Early" },
    { swatch: "bg-at-ontime", label: "Inside the window" },
    { swatch: "bg-at-ink", label: "Mixed" },
  ];
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-at-muted">
      {keys.map((k) => (
        <span key={k.label} className="flex items-center gap-1">
          <span aria-hidden className={cn("size-2 rounded-full", k.swatch)} />
          {k.label}
        </span>
      ))}
    </p>
  );
}

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
   * One line under the heading saying what the value column is. Both boards
   * carry one, so their row lists start at the same height when the two sit
   * side by side.
   */
  caption?: string;
  /**
   * Query each route link carries so the route opens on the window being
   * viewed, built by `routeLinkQuery`. Omit for the route's default view.
   */
  routeQuery?: string;
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
}

/**
 * Render a ranked board of routes (most off-schedule or most reliable) from the
 * rows given; the home page passes the top ten and link the heading
 * to the full ranking on the Routes page.
 * @param props - Board props.
 * @param props.title - Board heading.
 * @param props.accentClass - Tailwind text-colour class for the heading.
 * @param props.rows - Ranked rows.
 * @param props.metric - Whether the right column is a delay or on-time %.
 * @param props.caption - One line under the heading saying what the column is (optional).
 * @param props.routeQuery - Query each route link carries, from `routeLinkQuery` (optional).
 * @param props.deltas - Per-route position deltas from the previous period (optional).
 * @param props.cancelled - Cancelled trips per route slug, shown beside each route's name (optional).
 * @param props.seeAllHref - Link to the full ranking (optional).
 * @param props.total - How many routes the full ranking holds (optional).
 * @returns The board element.
 */
export function RankBoard({
  title,
  accentClass,
  rows,
  metric,
  caption,
  routeQuery,
  deltas,
  cancelled,
  seeAllHref,
  total,
}: RankBoardProps): JSX.Element {
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className={cn("mb-1 text-lg font-ultra tracking-zero", accentClass)}>
        {seeAllHref ? (
          <Link
            href={seeAllHref}
            className="flex w-full items-center gap-1.5 transition-opacity hover:opacity-80"
          >
            <span>{title}</span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
            <span className="ml-auto text-sm font-normal text-at-muted">
              See all{total !== undefined ? ` ${total}` : ""}
            </span>
          </Link>
        ) : (
          title
        )}
      </h2>
      {/* Both boards reserve the same block, caption plus key, so the two row
          lists start level. The key only has something to say on the signed
          board, where the colour varies. */}
      <div className="mb-3 min-h-14">
        {caption && <p className="text-sm text-at-muted">{caption}</p>}
        {metric === "delay" && <DelayColourKey />}
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-at-muted">Not enough data yet.</p>
      ) : (
        <ol>
          {rows.map((r, i) => {
            // Ranked by abs deviation, so the value always names a distance and
            // the column reads in descending order.
            const off = offScheduleValue(r.avg_delay_sec, r.avg_abs_delay_sec, r.mode);
            const value = metric === "delay" ? off.text : `${r.on_time_pct?.toFixed(1) ?? "—"}%`;
            const cancelledCount = cancelled?.get(routeSlug(r.route_id)) ?? 0;
            const valueClass =
              metric === "onTime" ? "text-at-ontime" : OFF_SCHEDULE_TONE_CLASS[off.tone];
            return (
              <li key={r.route_id}>
                {/* The whole row is the link, so the value/over area is clickable too. */}
                <Link
                  href={`/route/${encodeURIComponent(routeSlug(r.route_id))}${routeQuery ?? ""}`}
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
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
