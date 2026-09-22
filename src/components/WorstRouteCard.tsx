// src/components/WorstRouteCard.tsx
// Highlight card for the period's most off-schedule route, linking to its shame breakdown.

import { ModeIcon } from "@/components/ModeIcon";
import { OffScheduleLine } from "@/components/OffScheduleLine";
import { routeSlug } from "@/lib/route-slug";
import { nzHourLabel, weekdayShort } from "@/lib/time";
import type { ShameRouteRow } from "@/types/dashboard";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WorstRouteCard}. */
export interface WorstRouteCardProps {
  /** The period's most off-schedule route, or null when none qualifies. */
  route: ShameRouteRow | null;
  /** Service day (`YYYY-MM-DD`) to pin on the route link; omit for today. */
  day?: string;
  /** Override the card's link target; defaults to the route's own page. */
  href?: string;
}

/**
 * Shame dashboard card naming the most off-schedule route for the period,
 * linking to that route. Sits beside the worst-trip and worst-stop cards. When
 * no route qualifies it keeps its slot with a quiet state, so the card grid
 * never shows a hole.
 *
 * Every figure on it is **one hour's**, not the period's. The row is the max
 * over per-hour `(route, hour)` rows, so the winner is a route at its worst
 * hour; the last line names that hour, because the same route's whole-day
 * average appears on the home boards and the two would otherwise look like they
 * disagreed. The eyebrow stays "Worst route", the name its board goes by.
 * @param props - Component props.
 * @param props.route - The worst route row (or null).
 * @param props.day - Service day to pin on the link (optional).
 * @param props.href - Override link target (optional).
 * @returns The card element.
 */
export function WorstRouteCard({ route, day, href: hrefProp }: WorstRouteCardProps): JSX.Element {
  if (!route) {
    return (
      <div className="flex flex-col gap-1 border border-at-border bg-at-surface px-6 py-5">
        <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">Worst route</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">Nothing to rank yet</span>
        <p className="text-sm text-at-muted">No route has enough arrivals in this period.</p>
      </div>
    );
  }
  const name = route.short_name || route.long_name || routeSlug(route.route_id);

  // Week-view rows carry a service date and no meaningful hour; day rows are the
  // other way round.
  const bucket = route.date
    ? `on ${weekdayShort(route.date)}`
    : `in the ${nzHourLabel(route.hour)} hour`;
  const href =
    hrefProp ??
    `/route/${encodeURIComponent(routeSlug(route.route_id))}${day ? `?day=${day}` : ""}`;
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 border border-at-late/40 bg-at-surface px-6 py-5 transition-colors hover:bg-at-late/5"
    >
      <p className="text-xs font-semibold tracking-zero text-at-late uppercase">Worst route</p>
      <div className="flex flex-wrap items-center gap-2">
        <ModeIcon
          mode={route.mode}
          shortName={route.short_name}
          longName={route.long_name}
          colour={route.colour}
          className="h-6 w-6"
        />
        <span className="text-2xl font-ultra tracking-zero text-at-ink">{name}</span>
      </div>
      <OffScheduleLine
        signedSec={route.avg_delay_sec}
        absSec={route.avg_abs_delay_sec}
        mode={route.mode}
      />
      <p className="text-xs text-at-muted tabular-nums">
        {route.events} arrivals {bucket}
      </p>
    </Link>
  );
}
