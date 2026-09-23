// src/components/WorstStopCard.tsx
// Render a card for the window's worst-performing stop.

import { dayLinkParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import type { WorstStop } from "@/types/dashboard";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link WorstStopCard}. */
export interface WorstStopCardProps {
  /** The stop the board crowns, or null when no stop was bad enough to crown. */
  stop: WorstStop | null;
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
 * @param props - Component props.
 * @param props.stop - The crowned stop (or null).
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
      <p className="text-sm text-at-muted">
        Arrivals ran{" "}
        <span className="font-semibold text-at-late">{formatDuration(stop.avg_abs_delay_sec)}</span>{" "}
        off schedule on average
      </p>
      <p className="text-xs text-at-muted tabular-nums">{stop.events} arrivals</p>
    </Link>
  );
}
