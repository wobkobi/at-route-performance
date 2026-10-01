// src/components/cancellation/CancelledBoard.tsx
// Board listing the routes that cancelled the most trips in a
// window. A cancelled trip records no arrival, so the other boards only see it
// as the wait for the next trip (lib/rider-wait.ts); this one counts the trips
// themselves.

import { ModeIcon } from "@/components/ModeIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { CancelledRouteRow } from "@/lib/data";
import { plural } from "@/lib/format";
import { type LinkQuery, routeHref } from "@/lib/page/hrefs";
import { routeDisplayName, routeSubtitle } from "@/lib/route/slug";
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
    <Panel>
      <header className="flex items-baseline justify-between gap-3 border-b border-at-border px-4 py-3">
        <SectionHeading>Most cancelled</SectionHeading>
        <p className="text-sm text-at-muted tabular-nums">{plural(total, "trip")}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState inset className="px-4 py-6">
          No cancellations recorded. Only trips AT flagged as cancelled in the realtime feed are
          counted, and only from when capture began.
        </EmptyState>
      ) : (
        <ol className="striped divide-y divide-at-border">
          {rows.map((r, i) => {
            const label = routeDisplayName(r);
            const subtitle = routeSubtitle(r);
            return (
              <li key={r.slug}>
                <Link
                  href={routeHref(r.slug, routeParams)}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale"
                >
                  <span className="w-5 shrink-0 text-sm text-at-muted tabular-nums">{i + 1}</span>
                  <ModeIcon mode={r.mode} shortName={r.shortName} longName={r.longName} />
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
    </Panel>
  );
}
