// src/components/StopSchedule.tsx
/**
 * @description Render a stop's scheduled departures for a service date.
 */
import type { ScheduledDeparture } from "@/lib/at-stop-trips";
import { formatGtfsTime } from "@/lib/format";
import { nzServiceDayString } from "@/lib/time";
import type { JSX } from "react";

/** Props for {@link StopSchedule}. */
export interface StopScheduleProps {
  /** Sorted scheduled departures for the service date. */
  departures: ScheduledDeparture[];
  /** Maps route_id to short_name for display. */
  routeNames: Map<string, string | null>;
  /** Service date as YYYY-MM-DD. */
  serviceDate: string;
}

/**
 * Today's (or a named day's) scheduled departures at a stop, presented as a
 * compact table. Matches the table style used across other stop-page sections.
 * @param props - Component props.
 * @param props.departures - Sorted departures.
 * @param props.routeNames - Route ID to short name map.
 * @param props.serviceDate - Service date string (YYYY-MM-DD).
 * @returns Schedule table, or empty-state paragraph when no departures exist.
 */
export function StopSchedule({
  departures,
  routeNames,
  serviceDate,
}: StopScheduleProps): JSX.Element {
  const isToday = serviceDate === nzServiceDayString();
  const heading = isToday ? "Today's schedule" : `Schedule for ${serviceDate}`;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-zero text-at-muted uppercase">{heading}</h2>
      {departures.length === 0 ? (
        <p className="text-sm text-at-muted">No scheduled trips found for this day.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-at-border text-left text-xs tracking-zero text-at-muted uppercase">
                <th className="pr-4 pb-1 font-semibold">Route</th>
                <th className="pr-4 pb-1 font-semibold">Destination</th>
                <th className="pb-1 font-semibold tabular-nums">Departs</th>
              </tr>
            </thead>
            <tbody>
              {departures.map((dep, i) => (
                <tr key={dep.tripId || i} className="border-b border-at-border/40 last:border-0">
                  <td className="py-1.5 pr-4 font-semibold text-at-ink">
                    {routeNames.get(dep.routeId) ?? dep.routeId}
                  </td>
                  <td className="py-1.5 pr-4 text-at-muted">{dep.headsign ?? "—"}</td>
                  <td className="py-1.5 text-at-ink tabular-nums">
                    {formatGtfsTime(dep.departureTime) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
