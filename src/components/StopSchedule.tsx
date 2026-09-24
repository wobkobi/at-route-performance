// src/components/StopSchedule.tsx
// Render a stop's scheduled departures for a service date, and say which of the
// four things happened when there is no table to draw. The three failures are
// worded apart on purpose: AT answers all of them with the same 404, and a
// reader told "no departures" for a day whose timetable has simply been retired
// would read it as a quiet stop.

import type { StopDepartures } from "@/lib/at-stop-trips";
import { formatGtfsTime, UNKNOWN_VALUE } from "@/lib/format";
import {
  afterMidnightNote,
  gtfsServiceSeconds,
  nzServiceDayString,
  serviceDateLabel,
  serviceDayLabel,
} from "@/lib/time";
import { Fragment, type JSX } from "react";

/** Props for {@link StopSchedule}. */
export interface StopScheduleProps {
  /** The lookup's outcome: the departures, or why there are none to show. */
  result: StopDepartures;
  /** Maps route_id to short_name for display. */
  routeNames: Map<string, string | null>;
  /** Service date as YYYY-MM-DD. */
  serviceDate: string;
}

/**
 * The sentence for a state with no table behind it.
 * @param result - The lookup's outcome.
 * @param serviceDate - The service date being shown.
 * @returns The notice, or null when there are departures to draw instead.
 */
function noticeFor(result: StopDepartures, serviceDate: string): string | null {
  if (result.status === "unavailable") {
    return "Could not reach Auckland Transport's timetable just now.";
  }
  if (result.status === "outside-feed") {
    // Generated from the live window rather than written down: AT publishes
    // about four months at a time and the start rolls forward with each
    // republish, so this sentence names different dates over time.
    return `Auckland Transport publishes timetables from ${serviceDateLabel(result.window.start)} to ${serviceDateLabel(result.window.end)} only, so this day's timetable is gone. The figures above still cover it.`;
  }
  // "No service" and "nothing a rider can board" are the same fact to a reader.
  if (result.status === "no-service" || result.departures.length === 0) {
    return `No departures scheduled here on ${serviceDayLabel(serviceDate)}.`;
  }
  return null;
}

/**
 * A named day's scheduled departures at a stop, as a compact table matching the
 * other stop-page sections. The departures run 4am to 4am, so the ones after
 * midnight close the list under a line naming the day they still count toward.
 * @param props - Component props.
 * @param props.result - The departures, or the state that stopped them loading.
 * @param props.routeNames - Route ID to short name map.
 * @param props.serviceDate - Service date string (YYYY-MM-DD).
 * @returns The schedule table, or a notice in place of it.
 */
export function StopSchedule({ result, routeNames, serviceDate }: StopScheduleProps): JSX.Element {
  const isToday = serviceDate === nzServiceDayString();
  const heading = isToday ? "Today's schedule" : `Schedule for ${serviceDayLabel(serviceDate)}`;
  const notice = noticeFor(result, serviceDate);
  const departures = result.status === "ok" ? result.departures : [];
  // Past 24h on the service clock is after midnight (the list is sorted by it).
  const firstAfterMidnight = departures.findIndex(
    (d) => d.departureTime !== null && (gtfsServiceSeconds(d.departureTime) ?? 0) >= 86_400,
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-zero text-at-muted uppercase">{heading}</h2>
      {notice !== null ? (
        <p className="text-sm text-at-muted">{notice}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-at-border text-left text-xs tracking-zero text-at-muted uppercase">
                <th scope="col" className="pr-4 pb-1 font-semibold">
                  Route
                </th>
                <th scope="col" className="pr-4 pb-1 font-semibold">
                  Destination
                </th>
                <th scope="col" className="pb-1 font-semibold tabular-nums">
                  Departs
                </th>
              </tr>
            </thead>
            <tbody>
              {departures.map((dep, i) => (
                <Fragment key={dep.tripId || i}>
                  {i === firstAfterMidnight && (
                    <tr className="border-b border-at-border/40">
                      <td colSpan={3} className="pt-3 pb-1 text-xs text-at-muted">
                        {afterMidnightNote(serviceDate)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-at-border/40 last:border-0">
                    <td className="py-1.5 pr-4 font-semibold text-at-ink">
                      {routeNames.get(dep.routeId) ?? dep.routeId}
                    </td>
                    <td className="py-1.5 pr-4 text-at-muted">{dep.headsign ?? UNKNOWN_VALUE}</td>
                    <td className="py-1.5 text-at-ink tabular-nums">
                      {formatGtfsTime(dep.departureTime) ?? UNKNOWN_VALUE}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
