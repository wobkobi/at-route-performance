// src/components/TripDetourNote.tsx
// Note on the trip page when the vehicle's GPS left the trip's road path mid-run
// (see lib/off-route.ts), with AT's own alert when one was active.

import type { Sighting } from "@/lib/off-route";
import { nzClockTime } from "@/lib/time";
import type { JSX } from "react";

/** Props for {@link TripDetourNote}. */
export interface TripDetourNoteProps {
  /** The confirming off-route readings, in time order (at least two). */
  sightings: Sighting[];
  /** An active reroute alert on the route at the time, or null. */
  alert: string | null;
  /** The stop nearest the furthest reading, when the trip's stops are known. */
  nearestStop: string | null;
  /** What to call the vehicle ("bus", "train"). */
  noun: string;
}

/**
 * Explain that a run left its route: how far, when, near which stop, and
 * whether AT had announced a detour.
 * @param props - Component props.
 * @param props.sightings - The confirming readings, in time order.
 * @param props.alert - The active reroute alert, or null.
 * @param props.nearestStop - The stop nearest the furthest reading, or null.
 * @param props.noun - What to call the vehicle.
 * @returns The note.
 */
export function TripDetourNote({
  sightings,
  alert,
  nearestStop,
  noun,
}: TripDetourNoteProps): JSX.Element {
  const furthest = Math.max(...sightings.map((s) => s.distanceM));
  const first = sightings[0];
  const last = sightings.at(-1);
  const window =
    first && last && first.at !== last.at
      ? `between ${nzClockTime(first.at)} and ${nzClockTime(last.at)}`
      : first
        ? `at ${nzClockTime(first.at)}`
        : "";
  return (
    <section className="border border-l-4 border-at-border border-l-at-commercial bg-at-surface p-4">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Went off its route</h2>
      <p className="mt-1 text-sm text-at-muted">
        GPS put this {noun} up to {furthest.toLocaleString()} m from its planned road path in{" "}
        {sightings.length} readings {window}
        {nearestStop ? `, nearest ${nearestStop}` : ""}, with stops served before and after.
        {alert ? "" : " AT had no detour alert out for the route at the time."}
      </p>
      {alert && (
        <p className="mt-2 text-sm text-at-ink">
          <span className="font-semibold">AT alert:</span> {alert}
        </p>
      )}
    </section>
  );
}
