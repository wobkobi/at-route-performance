// src/components/StopSchedule.tsx
// Render a stop's scheduled departures for a service date, and say which of the
// five things happened when there is no table to draw. The three failures are
// worded apart on purpose: AT answers all of them with the same 404, and a
// reader told "no departures" for a day whose timetable has simply been retired
// would read it as a quiet stop.

import { ChipLink } from "@/components/Chip";
import type { StopDepartures } from "@/lib/at-stop-trips";
import { departuresFromNow } from "@/lib/departure-board";
import { departureLabel } from "@/lib/departure-label";
import { formatGtfsTime, UNKNOWN_VALUE } from "@/lib/format";
import {
  afterMidnightNote,
  gtfsServiceSeconds,
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
  /** Maps route_id to its mode, which decides how its headsign is read. */
  routeModes: Map<string, "BUS" | "TRAIN" | "FERRY">;
  /** Service date as YYYY-MM-DD. */
  serviceDate: string;
  /** Where now falls on this day's GTFS clock, or null when it is not today. */
  nowSeconds: number | null;
  /** Whether the reader asked for the whole day rather than what is still to come. */
  showAll: boolean;
  /** This page without the whole-day param. */
  nowHref: string;
  /** This page with it. */
  allHref: string;
}

/**
 * The sentence for a state with no table behind it.
 * @param result - The lookup's outcome.
 * @param serviceDate - The service date being shown.
 * @param shown - How many departures the current view draws.
 * @returns The notice, or null when there are departures to draw instead.
 */
function noticeFor(result: StopDepartures, serviceDate: string, shown: number): string | null {
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
  // The day has departures but none of them are ahead of the reader. Said as a
  // fact about the rest of today, with the whole-day chip still beside it.
  if (shown === 0) return "Nothing more is scheduled here today.";
  return null;
}

/**
 * A named day's scheduled departures at a stop, as a compact table matching the
 * other stop-page sections. The departures run 4am to 4am, so the ones after
 * midnight close the list under a line naming the day they still count toward.
 * @param props - Component props.
 * @param props.result - The departures, or the state that stopped them loading.
 * @param props.routeNames - Route ID to short name map.
 * @param props.routeModes - Route ID to mode map, for reading headsigns.
 * @param props.serviceDate - Service date string (YYYY-MM-DD).
 * @param props.nowSeconds - Now on this day's GTFS clock, or null when it is not today.
 * @param props.showAll - Whether the whole day was asked for.
 * @param props.nowHref - This page without the whole-day param.
 * @param props.allHref - This page with it.
 * @returns The schedule table, or a notice in place of it.
 */
export function StopSchedule({
  result,
  routeNames,
  routeModes,
  serviceDate,
  nowSeconds,
  showAll,
  nowHref,
  allHref,
}: StopScheduleProps): JSX.Element {
  const isToday = nowSeconds !== null;
  const heading = isToday ? "Today's schedule" : `Schedule for ${serviceDayLabel(serviceDate)}`;
  const all = result.status === "ok" ? result.departures : [];
  // A day that is over or has not started has no "now" to count from, so the
  // whole day is the only view of it and there is nothing to offer a chip for.
  const showingAll = showAll || nowSeconds === null;
  // Counted even while the whole day is shown, because the other chip names it.
  const fromNow = nowSeconds === null ? all : departuresFromNow(all, nowSeconds);
  const departures = showingAll ? all : fromNow;
  const notice = noticeFor(result, serviceDate, departures.length);
  // Past 24h on the service clock is after midnight (the list is sorted by it).
  const firstAfterMidnight = departures.findIndex(
    (d) => d.departureTime !== null && (gtfsServiceSeconds(d.departureTime) ?? 0) >= 86_400,
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-zero text-at-muted uppercase">{heading}</h2>
        {nowSeconds !== null && all.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {/* One template string per label, so each chip is a single text
                node: React separates adjacent ones with a comment marker, which
                reads as a stray space to anything parsing the page. */}
            <ChipLink href={nowHref} active={!showingAll}>
              {`From now (${fromNow.length})`}
            </ChipLink>
            <ChipLink href={allHref} active={showingAll}>
              {`Whole day (${all.length})`}
            </ChipLink>
          </div>
        )}
      </div>
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
              {departures.map((dep, i) => {
                const bound = departureLabel(
                  dep.headsign,
                  dep.stopHeadsign,
                  routeModes.get(dep.routeId) ?? "BUS",
                );
                return (
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
                      <td className="py-1.5 pr-4 text-at-ink">
                        {bound.destination ?? UNKNOWN_VALUE}
                        {bound.via !== null && (
                          <span className="block text-xs text-at-muted">via {bound.via}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-at-ink tabular-nums">
                        {formatGtfsTime(dep.departureTime) ?? UNKNOWN_VALUE}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
