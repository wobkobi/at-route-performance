import { formatDuration } from "@/lib/format";
import { MODE_NOUN } from "@/lib/mode";
import type { WorstStop } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link WorstStopCard}. */
export interface WorstStopCardProps {
  /** The window's worst-performing stop, or null when none qualifies. */
  stop: WorstStop | null;
  /** Service day (`YYYY-MM-DD`) to pin on the stop link; omit for today. */
  day?: string;
  /** Override the card's link target; defaults to the stop's own page. */
  href?: string;
}

/**
 * Home card naming the stop whose buses ran furthest off schedule on average,
 * across every route, linking to its detail page. Sits beside the Shame of the
 * Day run card. Renders nothing when no stop has enough events to rank.
 * @param props - Component props.
 * @param props.stop - The worst stop (or null).
 * @param props.day - Service day to pin on the link (optional).
 * @param props.href - Override link target (optional).
 * @returns The card, or null when there is no stop to show.
 */
export function WorstStopCard({
  stop,
  day,
  href: hrefProp,
}: WorstStopCardProps): JSX.Element | null {
  if (!stop) return null;
  const href = hrefProp ?? `/stop/${encodeURIComponent(stop.stop_id)}${day ? `?day=${day}` : ""}`;
  const noun = MODE_NOUN[stop.mode] ?? "Services";
  return (
    <a
      href={href}
      className="flex flex-col gap-1 border border-at-late/40 bg-at-surface px-6 py-5 transition-colors hover:bg-at-late/5"
    >
      <p className="text-xs font-semibold tracking-zero text-at-late uppercase">Worst stop</p>
      <span className="text-2xl font-ultra tracking-zero text-at-ink">{stop.name}</span>
      <p className="text-sm text-at-muted">
        {noun} ran{" "}
        <span className="font-semibold text-at-late">{formatDuration(stop.avg_abs_delay_sec)}</span>{" "}
        off schedule on average
      </p>
      <p className="text-xs text-at-muted tabular-nums">
        {stop.events} {noun.toLowerCase()}
      </p>
    </a>
  );
}
