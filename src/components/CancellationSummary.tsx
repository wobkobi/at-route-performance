// src/components/CancellationSummary.tsx
// KPI strip for the Cancellations page: every trip AT flagged, split by how the
// flag played out (see lib/cancellation.ts), and how many routes had one.

import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** Props for {@link CancellationSummary}. */
export interface CancellationSummaryProps {
  /** Every flagged trip in the window. */
  flagged: number;
  /** Flagged trips that recorded no arrival before the flag. */
  neverRan: number;
  /** Flagged trips cut short after setting off. */
  cutShort: number;
  /** Flagged trips that ran anyway. */
  reinstated: number;
  /** Routes with at least one flagged trip. */
  routes: number;
}

/**
 * Render the cancellation KPI strip, laid out like the fleet KPI strip.
 * @param props - Component props.
 * @param props.flagged - Every flagged trip.
 * @param props.neverRan - Trips that never ran.
 * @param props.cutShort - Trips cut short mid-trip.
 * @param props.reinstated - Trips that ran after the flag.
 * @param props.routes - Routes with a flagged trip.
 * @returns The strip.
 */
export function CancellationSummary({
  flagged,
  neverRan,
  cutShort,
  reinstated,
  routes,
}: CancellationSummaryProps): JSX.Element {
  const cells: { label: string; value: number; className?: string; note?: string }[] = [
    // The three stage cells below partition this one, reinstated included. The
    // home strip carries the same figure under the same name and note.
    { label: "Flagged cancelled", value: flagged, note: "Reinstated trips included" },
    { label: "Never ran", value: neverRan, className: neverRan > 0 ? "text-at-late" : undefined },
    { label: "Cut short", value: cutShort, className: cutShort > 0 ? "text-at-late" : undefined },
    { label: "Reinstated", value: reinstated },
    { label: "Routes", value: routes },
  ];
  return (
    <div className="border border-at-border bg-at-surface">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="p-3">
            <div className="text-xs tracking-zero text-at-muted uppercase">{c.label}</div>
            <div className={cn("text-xl font-ultra tracking-zero tabular-nums", c.className)}>
              {c.value.toLocaleString()}
            </div>
            {c.note && <div className="text-xs text-at-muted">{c.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
