// src/components/cancellation/CancellationSummary.tsx
// KPI strip for the Cancellations page: every trip AT flagged, split by how the
// flag played out (see lib/trip/cancellation.ts), and how many routes had one.

import { Figure, FigureStrip } from "@/components/ui/FigureStrip";
import { formatCount } from "@/lib/format";
import { CANCELLATION_LABEL } from "@/lib/trip/cancellation";
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
    {
      label: CANCELLATION_LABEL.before,
      value: neverRan,
      className: neverRan > 0 ? "text-at-late" : undefined,
    },
    {
      label: CANCELLATION_LABEL["mid-trip"],
      value: cutShort,
      className: cutShort > 0 ? "text-at-late" : undefined,
    },
    { label: CANCELLATION_LABEL.ran, value: reinstated },
    { label: "Routes", value: routes },
  ];
  return (
    <FigureStrip>
      {cells.map((c) => (
        <Figure key={c.label} label={c.label} note={c.note} className={c.className}>
          {formatCount(c.value)}
        </Figure>
      ))}
    </FigureStrip>
  );
}
