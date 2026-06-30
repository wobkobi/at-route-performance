// src/components/shame/ShameRowDelay.tsx
/**
 * @description Delay summary line for a shame board row, wording the average deviation by mode.
 */
import { formatDelay, formatDuration } from "@/lib/format";
import { isConsistentlyLateOrEarly, isOnTime } from "@/lib/on-time";
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
 * The right-aligned delay value for a trip/route shame board row. A
 * consistently late/early entry shows the signed delay in its band colour; a
 * mixed entry (early and late cancelling out) shows the absolute magnitude in
 * neutral ink, flagged with a help cursor and tooltip.
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
  const signed = avgDelaySec ?? 0;
  const oneDirectional = isConsistentlyLateOrEarly(signed, avgAbsDelaySec);
  return (
    <span className="shrink-0 pt-px text-right">
      <span
        className={`block font-semibold tabular-nums ${
          !oneDirectional
            ? "cursor-help text-at-ink"
            : isOnTime(signed, mode)
              ? "text-at-ontime"
              : signed < 0
                ? "text-at-early"
                : "text-at-late"
        }`}
        title={
          !oneDirectional
            ? "Some services ran early, some ran late — shows absolute average deviation from schedule"
            : undefined
        }
      >
        {oneDirectional ? formatDelay(signed, { mode }) : `${formatDuration(avgAbsDelaySec)} off`}
      </span>
    </span>
  );
}
