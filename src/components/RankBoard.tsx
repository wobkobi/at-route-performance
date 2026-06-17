import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import { linkColour } from "@/lib/link-colour";
import type { TopRouteRow } from "@/types/api";
import type { JSX } from "react";

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
  /** Threshold (seconds) beyond which a delay is coloured late/early. */
  thresholdSec: number;
}

/**
 * Render a ranked board of routes (earliest, latest, or most reliable).
 * @param props - Board props.
 * @param props.title - Board heading.
 * @param props.accentClass - Tailwind text-colour class for the heading.
 * @param props.rows - Ranked rows.
 * @param props.metric - Whether the right column is a delay or on-time %.
 * @param props.thresholdSec - Threshold (s) for early/late colour banding.
 * @returns The board element.
 */
export function RankBoard({
  title,
  accentClass,
  rows,
  metric,
  thresholdSec,
}: RankBoardProps): JSX.Element {
  return (
    <section className={cn("rounded-xl bg-at-surface p-4 shadow-sm")}>
      <h2 className={cn("mb-3 text-sm font-ultra tracking-zero uppercase", accentClass)}>
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className={cn("text-sm text-at-muted")}>Not enough data yet.</p>
      ) : (
        <ol className={cn("space-y-1")}>
          {rows.map((r, i) => {
            const colour = linkColour(r.short_name, r.long_name);
            // Boards rank by deviation magnitude, so always show the actual
            // value (no "on time" collapse); thresholdSec only drives colour.
            const value =
              metric === "delay"
                ? formatDelay(r.avg_delay_sec ?? 0)
                : `${r.on_time_pct?.toFixed(1) ?? "—"}%`;
            const valueClass =
              metric === "onTime"
                ? "text-at-ontime"
                : (r.avg_delay_sec ?? 0) > thresholdSec
                  ? "text-at-late"
                  : (r.avg_delay_sec ?? 0) < -thresholdSec
                    ? "text-at-early"
                    : "text-at-ink";
            return (
              <li
                key={r.route_id}
                className={cn(
                  "flex items-center gap-2 border-t border-at-border py-1.5 text-sm first:border-0",
                )}
              >
                <span className={cn("w-5 text-right text-at-muted tabular-nums")}>{i + 1}</span>
                {colour && (
                  <span
                    aria-hidden
                    className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", colour)}
                  />
                )}
                <a
                  href={`/route/${encodeURIComponent(r.route_id)}`}
                  className={cn("min-w-0 flex-1 truncate font-medium hover:underline")}
                >
                  <span className="font-semibold">{r.short_name || r.long_name || r.route_id}</span>
                </a>
                <span className={cn("shrink-0 font-semibold tabular-nums", valueClass)}>
                  {value}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
