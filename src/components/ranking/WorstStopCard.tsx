// src/components/ranking/WorstStopCard.tsx
// Render a card for the window's worst-performing stop.

import { OffScheduleLine } from "@/components/OffScheduleLine";
import { NoWorst, WorstCard, WorstCardBucket, WorstCardTitle } from "@/components/ui/WorstCard";
import { stopHref } from "@/lib/page/hrefs";
import { dayLinkParam } from "@/lib/time/day-url";
import type { HourRange } from "@/lib/time/time-of-day";
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
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
   * The shown window as words for the clean-window copy ("today", "on Sat 19 Sep",
   * "over the last 7 days"; see `windowPhrase`). Defaults to "today".
   */
  when?: string;
  /** Service day (`YYYY-MM-DD`) to pin on the stop link; omit for today. */
  day?: string;
  /** Override the card's link target; defaults to the stop's own page. */
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
 * Home card naming the stop the worst-stops board crowns, linking to its
 * detail page. Sits beside the worst-trip and worst-route cards, and reads
 * through the same three states they do, so the card grid never shows a hole.
 *
 * Every figure on it is **one hour's** (or one day's on the range views), not
 * the period's, for the reason WorstRouteCard names its hour: the same
 * stop's whole-period average is a click away and the two would otherwise look
 * like they disagreed. The average is worded by {@link OffScheduleLine} rather
 * than drawn red, because the sort key is a magnitude with no direction - a
 * board of stops whose services all ran *early* was being painted as late. On a
 * page narrowed to part of the day the row pools those hours, and the line
 * names the range.
 * @param props - Component props.
 * @param props.stop - The crowned stop row (or null).
 * @param props.ranked - Whether the board ranked any stop.
 * @param props.when - The shown window as words for the clean-window copy ("today" by default).
 * @param props.day - Service day to pin on the link (optional).
 * @param props.href - Override link target (optional).
 * @param props.hours - The part of the day the board ranked, or null/undefined for hour by hour.
 * @param props.live - Whether the day is still under way.
 * @returns The card.
 */
export function WorstStopCard({
  stop,
  ranked = false,
  when = "today",
  day,
  href: hrefProp,
  hours = null,
  live = false,
}: WorstStopCardProps): JSX.Element {
  // Nothing ranked is not the green all-clear: see NoWorst.
  if (!ranked || !stop) {
    return <NoWorst eyebrow="Worst stop" noun="stop" ranked={ranked} when={when} />;
  }
  // Today's `?day` is dropped, as on the route card: the stop page redirects it.
  const href = hrefProp ?? stopHref(stop.stop_id, { day: dayLinkParam(day) });
  return (
    <WorstCard tone="worst" eyebrow="Worst stop" href={href}>
      <WorstCardTitle>{stop.name}</WorstCardTitle>
      <OffScheduleLine
        signedSec={stop.avg_delay_sec}
        absSec={stop.avg_abs_delay_sec}
        mode={stop.mode}
      />
      <WorstCardBucket
        events={stop.events}
        {...("date" in stop ? { date: stop.date } : { hour: stop.hour })}
        hours={hours}
        live={live}
      />
    </WorstCard>
  );
}
