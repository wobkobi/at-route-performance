// src/components/TripGhostRunNote.tsx
// Note on the trip page for a run the nightly pass hid: either this run's
// readings belong to another run, or another run's readings were filed under
// this one's number. Written for a rider, who knows a run by when it departs and
// has never heard of a trip id.

import { buildHref } from "@/lib/utils";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link TripGhostRunNote}. */
export interface TripGhostRunNoteProps {
  /**
   * "hidden" on the page of the run whose readings were not its own; "mirror" on
   * the page of the run those readings actually describe.
   */
  kind: "hidden" | "mirror";
  /** The other run in the pair, with its departure label, or null when none was named. */
  other: { trip_id: string; label: string | null } | null;
  /** Route slug, for the link to the other run. */
  routeSlug: string;
  /** An instant on the run's service day, for the link's `?d=`, or null. */
  day: string | null;
  /** What to call the vehicle: "bus", "train" or "ferry". */
  noun: string;
}

/**
 * Explain a run the nightly pass hid. On the hidden run's own page the readings
 * are disowned; on the page of the run they describe, the missing readings are
 * accounted for. Where no other run was named - every instance in the data so
 * far - it says only that the readings do not belong to this run rather than
 * inventing one.
 * @param props - Component props.
 * @param props.kind - Which side of the pair this page is.
 * @param props.other - The other run and its departure label, or null.
 * @param props.routeSlug - Route slug for the link to the other run.
 * @param props.day - An instant on the run's service day, for the link.
 * @param props.noun - What to call the vehicle.
 * @returns The note element.
 */
export function TripGhostRunNote({
  kind,
  other,
  routeSlug,
  day,
  noun,
}: TripGhostRunNoteProps): JSX.Element {
  const named = other?.label ?? null;
  const title =
    kind === "hidden" ? "Reported under another run's number" : "No readings for this run";
  const body =
    kind === "hidden"
      ? named === null
        ? `Auckland Transport reported this ${noun} under another run's number, so these readings do not belong to this trip.`
        : `Auckland Transport reported this ${noun} under another run's number. These readings belong to the ${named} run.`
      : named === null
        ? `Auckland Transport reported this ${noun} under another run's number, so nothing was recorded against this trip.`
        : `Auckland Transport reported it under the ${named} run's number, so nothing was recorded against this trip.`;

  return (
    <section className="border border-l-4 border-at-border border-l-at-muted bg-at-surface p-4">
      <h2 className="text-lg font-ultra tracking-zero">{title}</h2>
      <p className="mt-1 text-sm text-at-muted">
        {body}
        {other && (
          <>
            {" "}
            <Link
              href={buildHref(
                `/route/${encodeURIComponent(routeSlug)}/trip/${encodeURIComponent(other.trip_id)}`,
                { d: day ?? undefined },
              )}
              className="text-at-shore hover:underline"
            >
              See that run
            </Link>
            .
          </>
        )}
      </p>
    </section>
  );
}
