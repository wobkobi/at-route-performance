import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { formatDelay, formatDuration } from "@/lib/format";
import { EARLY_TOLERANCE_SEC, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { routeSlug } from "@/lib/route-slug";
import type { TopRouteRow } from "@/types/api";
import type { JSX } from "react";
import { FaCaretDown, FaCaretUp } from "react-icons/fa";

/**
 * Position-movement badge: a caret icon + delta count, or a "new" label.
 * @param props - Badge props.
 * @param props.delta - Position change (positive = climbed), or null for new entries.
 * @param props.goodUp - True when climbing is good (reliable board), false when bad
 *   (off-schedule board). Omit for neutral/muted colour.
 * @returns The badge element, or null when there is no movement to show.
 */
function DeltaBadge({
  delta,
  goodUp,
}: {
  delta: number | null | undefined;
  goodUp?: boolean;
}): JSX.Element | null {
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
   * Semantic direction for the delta colour. True when climbing is good (reliable
   * board), false when climbing is bad (off-schedule board). Omit for neutral colour.
   */
  deltaGoodUp?: boolean;
}

/**
 * Render a ranked board of routes (earliest, latest, or most reliable).
 * @param props - Board props.
 * @param props.title - Board heading.
 * @param props.accentClass - Tailwind text-colour class for the heading.
 * @param props.rows - Ranked rows.
 * @param props.metric - Whether the right column is a delay or on-time %.
 * @param props.routeDay - Service day to pin on each route link (optional).
 * @param props.routeWindow - Window to open on each route link when no day is pinned (optional).
 * @param props.routePeriod - Calendar period to pin alongside `routeWindow` (optional).
 * @param props.deltas - Per-route position deltas from the previous period (optional).
 * @param props.deltaGoodUp - True when climbing is good (reliable board); false when bad (optional).
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
  deltaGoodUp,
}: RankBoardProps): JSX.Element {
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className={cn("mb-1 text-lg font-ultra tracking-zero", accentClass)}>{title}</h2>
      <div className="mb-3 min-h-5">
        {metric === "delay" && <p className="text-sm text-at-muted">{ON_TIME_CAPTION}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-at-muted">Not enough data yet.</p>
      ) : (
        <ol>
          {rows.map((r, i) => {
            // Ranked by abs deviation; display the same so the column numbers are
            // in descending order. When abs ≈ |signed| the route is consistently
            // late/early - show direction ("4m 8s late"). When they differ the
            // route is mixed - show magnitude only ("5m off").
            const signed = r.avg_delay_sec ?? 0;
            const abs = r.avg_abs_delay_sec ?? Math.abs(signed);
            const value =
              metric === "delay"
                ? Math.round(abs) === Math.abs(Math.round(signed))
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
                        <DeltaBadge delta={deltas.get(r.route_id)} goodUp={deltaGoodUp} />
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
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4 shrink-0 text-at-muted"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M7.5 4.5 13 10l-5.5 5.5-1.06-1.06L10.88 10 6.44 5.56 7.5 4.5Z" />
                  </svg>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
