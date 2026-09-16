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
} from "@/lib/data";
import { DATA_START_DAY } from "@/lib/data-start";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import { hasEarlierDay } from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { buildShameHref, TODAY_REVALIDATE } from "@/lib/shame-page";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import type { JSX } from "react";

/** Query params for the Shame dashboard. */
interface ShameSearchParams {
  day?: string;
}

/**
 * Shame dashboard: single-screen summary of the worst trip, route, and stop
 * for the day, linking to the full per-hour breakdown pages.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`).
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

  const requestedDay = resolveRequestedDay(sp.day);
  let range = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);

  const [initialTrip, initialRoute, initialStops, earliestDay] = await Promise.all([
    getShameOfDay(range, {}, TODAY_REVALIDATE),
    getShameRouteOfDay(range, {}, TODAY_REVALIDATE),
    getWorstStops(range, {}, 1, TODAY_REVALIDATE),
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
      getShameOfDay(range, {}, TODAY_REVALIDATE),
      getShameRouteOfDay(range, {}, TODAY_REVALIDATE),
      getWorstStops(range, {}, 1, TODAY_REVALIDATE),
    ]);
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = hasEarlierDay(serviceDate, earliestDay);
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString() ? "/shame" : undefined;

  // Cancellations are resolved after any day fallback, so the board matches the
  // day the rest of the dashboard settled on.
  const [cancelledTotal, cancelledRoutes] = await Promise.all([
    getCancelledCount(range, {}, TODAY_REVALIDATE),
    getCancelledRoutes(range, {}, 10, TODAY_REVALIDATE),
  ]);

  // Dashboard tabs carry no mode/school filter, only the active day.
  const noFilter = { mode: null, includeSchool: false };
  const tripHref = buildShameHref("/shame/trip", { day: linkDay }, noFilter);
  const routeHref = buildShameHref("/shame/route", { day: linkDay }, noFilter);
  const stopHref = buildShameHref("/shame/stop", { day: linkDay }, noFilter);

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Shame of the Day"
        subtitle="The worst trip, route, and stop"
        activeTab="none"
        tabHrefs={{ trip: tripHref, route: routeHref, stop: stopHref }}
        nav={{
          kind: "day",
          basePath: "/shame",
          serviceDate,
          preserved: {},
          hasPrev: hasPrevDay,
          atFloor: serviceDate === DATA_START_DAY,
          hasNext: hasNextDay,
          nextHref: nextDayHref,
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ShameOfDay trip={tripShame.worst} href={tripHref} hours={tripShame.hours} />
        <WorstRouteCard route={routeShame.worst} href={routeHref} />
        <WorstStopCard stop={stops[0] ?? null} href={stopHref} />
      </div>

      <CancelledBoard rows={cancelledRoutes} total={cancelledTotal} routeDay={linkDay} />
    </main>
  );
}
