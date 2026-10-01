import { cn } from "@/lib/cn";
import { OFF_SCHEDULE_TONE_CLASS, offScheduleValue } from "@/lib/format";
import type { JSX } from "react";

/** Props for {@link OffScheduleValue}. */
export interface OffScheduleValueProps {
  /** Signed average delay in seconds (positive late), or null. */
  signedSec: number | null;
  /** Average absolute delay in seconds, or null to derive it from the signed one. */
  absSec: number | null;
  /** The mode, whose on-time window bands the colour. */
  mode: string;
  /** Extra classes: layout only, never a colour or weight. */
  className?: string;
}

/**
 * An average delay as the site prints it everywhere: "4m 8s late" in the band's
 * colour, semibold, with tabular figures so a column of them lines up. Mixed
 * early-and-late averages read "3m off" in ink.
 * @param props - Component props.
 * @param props.signedSec - Signed average delay.
 * @param props.absSec - Average absolute delay.
 * @param props.mode - The mode.
 * @param props.className - Layout classes.
 * @returns The value.
 */
export function OffScheduleValue({
  signedSec,
  absSec,
  mode,
  className,
}: OffScheduleValueProps): JSX.Element {
  const value = offScheduleValue(signedSec, absSec, mode);
  return (
    <span
      className={cn("font-semibold tabular-nums", OFF_SCHEDULE_TONE_CLASS[value.tone], className)}
    >
      {value.text}
    </span>
  );
}
