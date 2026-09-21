// src/app/shame/(overview)/page.tsx
// Shame dashboard summarising the worst trip, route, and stop of the day.

import { CancelledBoard } from "@/components/CancelledBoard";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WorstRouteCard } from "@/components/WorstRouteCard";
import { WorstStopCard } from "@/components/WorstStopCard";
import {
  getCancelledCount,
  getCancelledRoutes,
  getEarliestDataDay,
  getShameOfDay,
  getShameRouteOfDay,
  getWorstStops,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { DATA_START_DAY } from "@/lib/data-start";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import { hasEarlierDay } from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { buildShameHref, parseShameParams, type ShameSearchParams } from "@/lib/shame-page";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import type { JSX } from "react";

/**
 * Shame dashboard: single-screen summary of the worst trip, route, and stop
 * for the day, linking to the full per-hour breakdown pages.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `mode`, `school`).
 * @returns Page markup.
 */
export default async function ShameDashboard({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  clampDayParam("/shame", sp);
  dropTodayParam("/shame", sp);
  const { filter, mode, includeSchool, preserved, subtitle } = parseShameParams(sp);

  const requestedDay = resolveRequestedDay(sp.day);
  let range = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);

  const [initialTrip, initialRoute, initialStops, earliestDay] = await Promise.all([
    getShameOfDay(range, filter, TODAY_REVALIDATE),
    getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    getWorstStops(range, filter, 1, TODAY_REVALIDATE),
    getEarliestDataDay(1),
  ]);

  let tripShame = initialTrip;
  let routeShame = initialRoute;
  let stops = initialStops;

  const fallbackDay = await maybeFallbackDay(
    requestedDay,
    tripShame.hours.length === 0 && routeShame.hours.length === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallbackDay) {
    range = nzServiceDayRange(fallbackDay);
    serviceDate = nzServiceDayString(range.start);
    [tripShame, routeShame, stops] = await Promise.all([
      getShameOfDay(range, filter, TODAY_REVALIDATE),
      getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
      getWorstStops(range, filter, 1, TODAY_REVALIDATE),
    ]);
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = hasEarlierDay(serviceDate, earliestDay);
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  // Stepping onto today drops `?day` so the URL stays canonical, but only when
  // the shown day was the one asked for. After a fallback a bare link re-enters
  // the same empty today and falls back again, leaving an arrow that does
  // nothing; an explicit `?day` is never fallen back from.
  const nextDayHref =
    hasNextDay && !fallbackDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? buildShameHref("/shame", {}, filter)
      : undefined;

  // Cancellations are resolved after any day fallback, so the board matches the
  // day the rest of the dashboard settled on.
  const [cancelledTotal, cancelledRoutes] = await Promise.all([
    getCancelledCount(range, filter, TODAY_REVALIDATE),
    getCancelledRoutes(range, filter, 10, TODAY_REVALIDATE),
  ]);

  // The boards behind the tabs read the same filter this page now does, so a
  // reader who narrows to trains here stays on trains when they open one.
  const tripHref = buildShameHref("/shame/trip", { day: linkDay }, filter);
  const routeHref = buildShameHref("/shame/route", { day: linkDay }, filter);
  const stopHref = buildShameHref("/shame/stop", { day: linkDay }, filter);

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Shame of the Day"
        subtitle={`The worst trip, route, and stop · ${subtitle}`}
        activeTab="none"
        tabHrefs={{ trip: tripHref, route: routeHref, stop: stopHref }}
        filter={{ basePath: "/shame", mode, includeSchool, nav: { day: linkDay } }}
        nav={{
          kind: "day",
          basePath: "/shame",
          serviceDate,
          preserved,
          hasPrev: hasPrevDay,
          atFloor: serviceDate === DATA_START_DAY,
          hasNext: hasNextDay,
          nextHref: nextDayHref,
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Each card names one run, route or stop and opens it. The boards those
            three come from are the header's tabs, right above. */}
        <ShameOfDay trip={tripShame.worst} hours={tripShame.hours} />
        <WorstRouteCard route={routeShame.worst} day={linkDay} />
        <WorstStopCard stop={stops[0] ?? null} day={linkDay} />
      </div>

      <CancelledBoard rows={cancelledRoutes} total={cancelledTotal} routeDay={linkDay} />
    </main>
  );
}
