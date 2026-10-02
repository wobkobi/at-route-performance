// src/components/shame/ShameRowDelay.tsx
// Delay summary line for a shame board row, wording the average deviation by mode.

import { Hint } from "@/components/ui/Hint";
import { OffScheduleValue } from "@/components/ui/OffScheduleValue";
import { offScheduleValue } from "@/lib/format";
import type { JSX } from "react";

/** Props for {@link ShameRowDelay}. */
export interface ShameRowDelayProps {
  /** Signed average deviation in seconds (negative early, positive late). */
  avgDelaySec: number | null;
  /** Average absolute deviation in seconds. */
  avgAbsDelaySec: number;
  /** Route mode, for the on-time window and the delay wording. */
  mode: string;
}

/**
 * The right-aligned delay value for a trip/route shame board row, worded by
 * {@link offScheduleValue} so it always names a distance. A mixed entry (early
 * and late cancelling out) is flagged with a help cursor and tooltip.
 * @param props - Component props.
 * @param props.avgDelaySec - Signed average deviation in seconds.
 * @param props.avgAbsDelaySec - Average absolute deviation in seconds.
 * @param props.mode - Route mode, for the on-time window and wording.
 * @returns The delay cell element.
 */
export function ShameRowDelay({
  avgDelaySec,
  avgAbsDelaySec,
  mode,
}: ShameRowDelayProps): JSX.Element {
  const mixed = offScheduleValue(avgDelaySec, avgAbsDelaySec, mode).tone === "mixed";
  return (
    <span className="shrink-0 pt-px text-right">
      {mixed ? (
        <Hint
          align="end"
          hint={
            "Some trips ran early, some ran late - this is the average distance from schedule, ignoring direction"
          }
          className="relative z-10 block"
        >
          <OffScheduleValue signedSec={avgDelaySec} absSec={avgAbsDelaySec} mode={mode} />
        </Hint>
      ) : (
        <span className="block">
          <OffScheduleValue signedSec={avgDelaySec} absSec={avgAbsDelaySec} mode={mode} />
        </span>
      )}
    </span>
  );
}
