// src/components/WorstStopCard.tsx
// Render a card for the window's worst-performing stop.

import { OffScheduleLine } from "@/components/OffScheduleLine";
import { dayLinkParam } from "@/lib/day-url";
import { nzHourLabel, weekdayShort } from "@/lib/time";
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WorstStopCard}. */
export interface WorstStopCardProps {
  /**
   * The stop the board crowns - an hour's worst on the day view, a day's worst
   * on the week and month views - or null when no stop was bad enough to crown.
   */
  stop: ShameStop | ShameDayStop | null;
  /** Whether the board ranked any stop, which tells a clean window from an empty one. */
  ranked?: boolean;
  /**
   * The shown window as words for the clean-window copy ("today", "that day",
   * "over the last 7 days"; see `windowPhrase`). Defaults to "today".
   */
  when?: string;
  /** Service day (`YYYY-MM-DD`) to pin on the stop link; omit for today. */
  day?: string;
  /** Override the card's link target; defaults to the stop's own page. */
  href?: string;
}

/**
 * Home card naming the stop the worst-stops board crowns, linking to its
 * detail page. Sits beside the worst-trip and worst-route cards, and reads
 * through the same three states they do, so the card grid never shows a hole.
 *
 * Every figure on it is **one hour's** (or one day's on the range views), not
 * the period's, for the reason WorstRouteCard names its hour: the same
 * stop's whole-period average is a click away and the two would otherwise look
 * like they disagreed. The average is worded by {@link OffScheduleLine} rather
 * than drawn red, because the sort key is a magnitude with no direction - a
 * board of stops whose services all ran *early* was being painted as late.
 * @param props - Component props.
 * @param props.stop - The crowned stop row (or null).
 * @param props.ranked - Whether the board ranked any stop.
 * @param props.when - The shown window as words for the clean-window copy ("today" by default).
 * @param props.day - Service day to pin on the link (optional).
 * @param props.href - Override link target (optional).
 * @returns The card.
 */
export function WorstStopCard({
  stop,
  ranked = false,
  when = "today",
  day,
  href: hrefProp,
}: WorstStopCardProps): JSX.Element {
  // Nothing ranked at all, which is not the green all-clear below.
  if (!ranked) {
    return (
      <div className="flex flex-col gap-1 border border-at-border bg-at-surface px-6 py-5">
        <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">Worst stop</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">Nothing to rank yet</span>
        <p className="text-sm text-at-muted">No stop has enough arrivals in this period.</p>
      </div>
    );
  }
  // Stops ranked and none was past the late bound, so the board crowns nothing.
  if (!stop) {
    return (
      <div className="flex flex-col gap-1 border border-at-ontime/40 bg-at-surface px-6 py-5">
        <p className="text-xs font-semibold tracking-zero text-at-ontime uppercase">Worst stop</p>
        <span className="text-2xl font-ultra tracking-zero text-at-ink">No shame {when}</span>
        <p className="text-sm text-at-muted">
          No stop stood out {when}, so there is nothing to call out.
        </p>
      </div>
    );
  }
  // Week and month rows carry a service date and no hour; day rows are the
  // other way round.
  const bucket =
    "date" in stop ? `on ${weekdayShort(stop.date)}` : `in the ${nzHourLabel(stop.hour)} hour`;
  // Today's `?day` is dropped, as on the route card: the stop page redirects it.
  const dayParam = dayLinkParam(day);
  const href =
    hrefProp ?? `/stop/${encodeURIComponent(stop.stop_id)}${dayParam ? `?day=${dayParam}` : ""}`;
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 border border-at-late/40 bg-at-surface px-6 py-5 transition-colors hover:bg-at-late/5"
    >
      <p className="text-xs font-semibold tracking-zero text-at-late uppercase">Worst stop</p>
      <span className="text-2xl font-ultra tracking-zero text-at-ink">{stop.name}</span>
      <OffScheduleLine
        signedSec={stop.avg_delay_sec}
        absSec={stop.avg_abs_delay_sec}
        mode={stop.mode}
      />
      <p className="text-xs text-at-muted tabular-nums">
        {stop.events} arrivals {bucket}
      </p>
    </Link>
  );
}
