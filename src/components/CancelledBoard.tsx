// src/components/CancelledBoard.tsx
/**
 * @description Board listing the routes that cancelled the most trips in a
 * window. Cancellations sit outside every other board on this site: a cancelled
 * trip records no arrival, so it cannot be ranked by lateness and it cannot drag
 * an on-time rate down - it silently improves one. This is where that shows.
 */
import { ModeIcon } from "@/components/ModeIcon";
import type { CancelledRouteRow } from "@/lib/data";
import { lineName } from "@/lib/line-name";
import type { JSX } from "react";

/** Props for {@link CancelledBoard}. */
export interface CancelledBoardProps {
  /** Routes with cancellations, most first. Renders an empty state when none. */
  rows: CancelledRouteRow[];
  /** Total cancellations in the window, including routes below the cut. */
  total: number;
  /** `?day=` value for past-day route links, or undefined for today. */
  routeDay?: string;
}

/**
 * Routes ranked by trips cancelled in the window.
 * @param props - Component props.
 * @param props.rows - Routes with cancellations, most first.
 * @param props.total - Total cancellations in the window.
 * @param props.routeDay - `?day=` value for past-day route links.
 * @returns The board element.
 */
export function CancelledBoard({ rows, total, routeDay }: CancelledBoardProps): JSX.Element {
  return (
    <section className="border border-at-border bg-at-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-at-border px-4 py-3">
        <h2 className="font-ultra tracking-zero text-at-ink">Most cancelled</h2>
        <p className="text-sm text-at-muted tabular-nums">
          {total.toLocaleString()} {total === 1 ? "trip" : "trips"}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-at-muted">
          No cancellations recorded. Only trips AT flagged as cancelled in the realtime feed are
          counted, and only from when capture began.
        </p>
      ) : (
        <ol className="divide-y divide-at-border">
          {rows.map((r, i) => {
            const label = r.short_name || r.long_name || r.route_id;
            const subtitle = lineName(r.mode, r.short_name);
            return (
              <li key={r.route_id}>
                <a
                  href={`/route/${encodeURIComponent(r.route_id)}${routeDay ? `?day=${routeDay}` : ""}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale"
                >
                  <span className="w-5 shrink-0 text-sm text-at-muted tabular-nums">{i + 1}</span>
                  <ModeIcon
                    mode={r.mode}
                    shortName={r.short_name}
                    longName={r.long_name}
                    colour={r.colour}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-at-ink">{label}</span>
                    {subtitle && <span className="block text-xs text-at-muted">{subtitle}</span>}
                  </span>
                  <span className="shrink-0 font-ultra tracking-zero text-at-late tabular-nums">
                    {r.cancelled}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
