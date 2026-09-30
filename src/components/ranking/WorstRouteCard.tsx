// src/components/ranking/WorstRouteCard.tsx
// Highlight card for the period's most off-schedule route, linking to its shame breakdown.

import { ModeIcon } from "@/components/ModeIcon";
import { OffScheduleLine } from "@/components/OffScheduleLine";
import { routeSlug } from "@/lib/route/slug";
import { dayLinkParam } from "@/lib/time/day-url";
import { nzHourLabel, weekdayShort } from "@/lib/time/service-day";
import {
  HOURS_PARAM,
  hourRangeClock,
  hourRangeParam,
  singleHourRange,
  type HourRange,
} from "@/lib/time/time-of-day";
import { buildHref } from "@/lib/utils";
import type { ShameRouteRow } from "@/types/dashboard";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WorstRouteCard}. */
export interface WorstRouteCardProps {
  /** The route the board crowns, or null when no route was bad enough to crown. */
  route: ShameRouteRow | null;
  /** Whether the board ranked any route, which tells a clean window from an empty one. */
  ranked?: boolean;
  /**
   * The shown window as words for the clean-window copy ("today", "on Sat 19 Sep",
   * "over the last 7 days"; see `windowPhrase`). Defaults to "today".
   */
  when?: string;
  /** Service day (`YYYY-MM-DD`) to pin on the route link; omit for today. */
  day?: string;
  /** Override the card's link target; defaults to the route's own page. */
  href?: string;
  /**
   * The part of the day the card's board ranked, when the page is narrowed to
   * one: the row's figures then pool those hours rather than one hour's.
   */
  hours?: HourRange | null;
  /** Whether the day is still under way, so a range running to its end reads "to now". */
  live?: boolean;
}

/**
 * Home card naming the route the worst-routes board crowns, linking to that
 * route. Sits beside the worst-trip and worst-stop cards, and reads through the
 * same three states they do, so the card grid never shows a hole.
 *
 * Every figure on it is **one hour's**, not the period's. The row is the max
 * over per-hour `(route, hour)` rows, so the winner is a route at its worst
 * hour; the last line names that hour, because the same route's whole-day
 * average appears on the home boards and the two would otherwise look like they
 * disagreed. The link carries that hour too, so the route page opens narrowed to
 * it rather than on a whole-day figure that would answer the card's own sentence
 * with a different number. On a page narrowed to part of the day the row pools
 * those hours instead, and the line and the link name the range. The eyebrow
 * stays "Worst route", the name its board goes by.
 * @param props - Component props.
 * @param props.route - The crowned route row (or null).
 * @param props.ranked - Whether the board ranked any route.
 * @param props.when - The shown window as words for the clean-window copy ("today" by default).
 * @param props.day - Service day to pin on the link (optional).
 * @param props.href - Override link target (optional).
 * @param props.hours - The part of the day the board ranked, or null/undefined for hour by hour.
 * @param props.live - Whether the day is still under way.
 * @returns The card element.
 */
export function WorstRouteCard({
  route,
  ranked = false,
  when = "today",
  day,
  href: hrefProp,
  hours = null,
  live = false,
}: WorstRouteCardProps): JSX.Element {
  // Nothing ranked at all, which is not the green all-clear below.
  if (!ranked) {
    return (
      <div className="flex flex-col gap-1 border-l-2 border-at-border bg-at-surface py-3 pl-5">
        <p className="at-eyebrow text-at-muted">Worst route</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">Nothing to rank yet</span>
        <p className="text-sm text-at-muted">No route has enough arrivals in this period.</p>
      </div>
    );
  }
  // Routes ranked and none was past the late bound, so the board crowns nothing.
  if (!route) {
    return (
      <div className="flex flex-col gap-1 border-l-2 border-at-ontime bg-at-surface py-3 pl-5">
        <p className="at-eyebrow text-at-ontime">Worst route</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">No shame {when}</span>
        <p className="text-sm text-at-muted">
          No route stood out {when}, so there is nothing to call out.
        </p>
      </div>
    );
  }
  const name = route.short_name || route.long_name || routeSlug(route.route_id);

  // Week-view rows carry a service date and no meaningful hour; day rows are the
  // other way round.
  const bucket = route.date
    ? `on ${weekdayShort(route.date)}`
    : hours
      ? `from ${hourRangeClock(hours, live)}`
      : `in the ${nzHourLabel(route.hour)} hour`;
  // The day is dropped when it is today's, whose `?day` the route page
  // redirects away: a card naming today would have cost its reader a 307. A day
  // row's hour goes with it, since every figure above is that hour's and opening
  // the whole day would answer the card's own sentence with a different number.
  // A week row names a day instead, and its `hour` is a placeholder 0.
  const href =
    hrefProp ??
    buildHref(`/route/${encodeURIComponent(routeSlug(route.route_id))}`, {
      day: dayLinkParam(day),
      [HOURS_PARAM]: route.date ? undefined : hourRangeParam(hours ?? singleHourRange(route.hour)),
    });
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 border-l-2 border-at-late bg-at-surface py-3 pl-5 transition-colors hover:bg-at-late/5"
    >
      <p className="at-eyebrow text-at-late">Worst route</p>
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
