// src/components/TripCancellationNote.tsx
// Note on the trip page explaining a cancellation flag: whether the trip never
// ran, was cut short, or ran anyway after AT reversed the flag.

import type { CancellationStage } from "@/lib/cancellation";
import { cn } from "@/lib/cn";
import { nzClockTime } from "@/lib/time";
import type { JSX } from "react";

/** Props for {@link TripCancellationNote}. */
export interface TripCancellationNoteProps {
  /** How the cancellation played out. */
  stage: CancellationStage;
  /** ISO instant ingest first saw the flag. */
  detectedAt: string;
  /** The last stop with a recorded arrival and when the vehicle reached it, or null when none. */
  lastStop: { name: string; at: string } | null;
  /** Scheduled stops after the last recorded one, or null when the schedule is unavailable. */
  notServed: number | null;
}

/**
 * Explain a trip's cancellation flag. A mid-trip flag with every scheduled stop
 * already served reads as raised after the trip finished rather than cutting it
 * short, since nothing was left to cancel.
 * @param props - Component props.
 * @param props.stage - How the cancellation played out.
 * @param props.detectedAt - When ingest first saw the flag.
 * @param props.lastStop - The last stop with a recorded arrival, or null.
 * @param props.notServed - Scheduled stops after the last recorded one, or null when unknown.
 * @returns The note element.
 */
export function TripCancellationNote({
  stage,
  detectedAt,
  lastStop,
  notServed,
}: TripCancellationNoteProps): JSX.Element {
  const flagged = nzClockTime(detectedAt);
  let title: string;
  let body: string;
  if (stage === "before" || lastStop === null) {
    title = "Cancelled";
    body = `AT cancelled this trip (first flagged at ${flagged}) and it recorded no arrivals.`;
  } else if (stage === "ran") {
    title = "Cancelled, then reinstated";
    body = `AT flagged this trip cancelled at ${flagged}, but it kept recording arrivals until ${nzClockTime(lastStop.at)} at ${lastStop.name}, so the cancellation looks to have been reversed.`;
  } else if (notServed === 0) {
    title = "Flagged cancelled after finishing";
    body = `AT flagged this trip cancelled at ${flagged}, after it had already reached its last stop, ${lastStop.name}, at ${nzClockTime(lastStop.at)}.`;
  } else {
    title = "Cancelled mid-trip";
    const rest =
      notServed === null
        ? "nothing was recorded after that"
        : `the ${notServed} ${notServed === 1 ? "stop" : "stops"} after that ${notServed === 1 ? "was" : "were"} not served`;
    body = `Its last recorded stop was ${lastStop.name} at ${nzClockTime(lastStop.at)}. AT flagged it cancelled at ${flagged}, and ${rest}.`;
  }

  return (
    <section
      className={cn(
        "border border-l-4 border-at-border bg-at-surface p-4",
        stage === "ran" ? "border-l-at-muted" : "border-l-at-late",
      )}
    >
      <h2
        className={cn(
          "text-lg font-ultra tracking-zero",
          stage === "ran" ? "text-at-ink" : "text-at-late",
        )}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-at-muted">{body}</p>
    </section>
  );
}
