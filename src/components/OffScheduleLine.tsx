// src/components/OffScheduleLine.tsx
// The "Ran ... on average" sentence under the worst-trip and worst-route cards.

import { cn } from "@/lib/cn";
import { OFF_SCHEDULE_TONE_CLASS, formatDelay, offScheduleValue } from "@/lib/format";
import type { JSX } from "react";

/** Props for {@link OffScheduleLine}. */
export interface OffScheduleLineProps {
  /** Signed average deviation in seconds (negative early, positive late). */
  signedSec: number | null;
  /** Average absolute deviation in seconds. */
  absSec: number | null;
  /** Route mode, for the on-time window behind the colour. */
  mode: string;
}

/**
 * One card's average, worded by {@link offScheduleValue} so it matches the
 * boards the cards sit above. A one-way run folds its direction into the figure
 * ("Ran 6m late on average"); a mixed one gives the magnitude and then the net,
 * since its signed average alone would understate how far off it ran.
 * @param props - Component props.
 * @param props.signedSec - Signed average deviation in seconds.
 * @param props.absSec - Average absolute deviation in seconds.
 * @param props.mode - Route mode.
 * @returns The sentence.
 */
export function OffScheduleLine({ signedSec, absSec, mode }: OffScheduleLineProps): JSX.Element {
  const value = offScheduleValue(signedSec, absSec, mode);
  const figure = (
    <span className={cn("font-semibold", OFF_SCHEDULE_TONE_CLASS[value.tone])}>{value.text}</span>
  );
  return (
    <p className="text-sm text-at-muted">
      Ran {figure}
      {value.tone === "mixed" && signedSec != null
        ? ` schedule on average (net ${formatDelay(signedSec, { thresholdSec: 0 })})`
        : " on average"}
    </p>
  );
}
