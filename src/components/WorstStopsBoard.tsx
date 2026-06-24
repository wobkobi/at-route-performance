import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { WorstStop } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link WorstStopsBoard}. */
export interface WorstStopsBoardProps {
  /** Stops ranked by off-schedule magnitude, worst first. */
  rows: WorstStop[];
}

/**
 * Leaderboard of the window's worst-performing stops - those whose buses ran
 * furthest off schedule on average, across every route. Mirrors the route rank
 * board layout; each row links to the stop's detail page (which shows where it
 * is on the map). The board spans a window, so links open the stop's own
 * day-focused page rather than pinning a day.
 * @param props - Board props.
 * @param props.rows - Ranked stop rows.
 * @returns The board element.
 */
export function WorstStopsBoard({ rows }: WorstStopsBoardProps): JSX.Element {
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className="mb-3 text-base font-ultra tracking-zero text-at-ink">Worst stops</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-at-muted">Not enough data yet.</p>
      ) : (
        <ol>
          {rows.map((s, i) => (
            <li key={s.stop_id}>
              <a
                href={`/stop/${encodeURIComponent(s.stop_id)}`}
                className={cn(
                  "-mx-4 flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-at-shore-pale",
                  i > 0 && "border-t border-at-border",
                )}
              >
                <span className="w-5 text-right text-at-muted tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-at-shore">
                  {s.name}
                </span>
                <span className="shrink-0 font-semibold text-at-late tabular-nums">
                  {formatDuration(s.avg_abs_delay_sec)} off
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
          ))}
        </ol>
      )}
    </section>
  );
}
