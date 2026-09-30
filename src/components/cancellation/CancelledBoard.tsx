// src/components/cancellation/CancelledBoard.tsx
// Board listing the routes that cancelled the most trips in a
// window. A cancelled trip records no arrival, so the other boards only see it
// as the wait for the next trip (lib/rider-wait.ts); this one counts the trips
// themselves.

import { ModeIcon } from "@/components/ModeIcon";
import type { CancelledRouteRow } from "@/lib/data";
import { plural } from "@/lib/format";
import { type LinkQuery, routeHref } from "@/lib/page/hrefs";
import { lineName } from "@/lib/route/line-name";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link CancelledBoard}. */
export interface CancelledBoardProps {
  /** Routes with cancellations, most first. Renders an empty state when none. */
  rows: CancelledRouteRow[];
  /** Total cancellations in the window, including routes below the cut. */
  total: number;
  /**
   * Params each route link carries so the route opens on the window being
   * viewed, built by `routeLinkParams`. Omit for the route's default view.
   */
  routeParams?: LinkQuery;
}

/**
 * Routes ranked by trips cancelled in the window.
 * @param props - Component props.
 * @param props.rows - Routes with cancellations, most first.
 * @param props.total - Total cancellations in the window.
 * @param props.routeParams - Params each route link carries (optional).
 * @returns The board element.
 */
export function CancelledBoard({ rows, total, routeParams }: CancelledBoardProps): JSX.Element {
  return (
    <section className="border border-at-border bg-at-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-at-border px-4 py-3">
        <h2 className="font-ultra tracking-zero text-at-ink">Most cancelled</h2>
        <p className="text-sm text-at-muted tabular-nums">{plural(total, "trip")}</p>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-at-muted">
          No cancellations recorded. Only trips AT flagged as cancelled in the realtime feed are
          counted, and only from when capture began.
        </p>
      ) : (
        <ol className="striped divide-y divide-at-border">
          {rows.map((r, i) => {
            const label = r.shortName || r.longName || r.slug;
            const subtitle = lineName(r.mode, r.shortName);
            return (
              <li key={r.slug}>
                <Link
                  href={routeHref(r.slug, routeParams)}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale"
                >
                  <span className="w-5 shrink-0 text-sm text-at-muted tabular-nums">{i + 1}</span>
                  <ModeIcon
                    mode={r.mode}
                    shortName={r.shortName}
                    longName={r.longName}
                    colour={r.colour}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-at-ink">{label}</span>
                    {subtitle && <span className="block text-xs text-at-muted">{subtitle}</span>}
                  </span>
                  <span className="shrink-0 font-ultra tracking-zero text-at-late tabular-nums">
                    {r.cancelled}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
