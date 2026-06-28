// src/app/shame/page.tsx
import { DayNav } from "@/components/DayNav";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WorstRouteCard } from "@/components/WorstRouteCard";
import { WorstStopCard } from "@/components/WorstStopCard";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getShameOfDay,
  getShameRouteOfDay,
  getWorstStops,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import type { JSX } from "react";

const TODAY_REVALIDATE = 300;

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
  dropTodayParam("/shame", sp);

  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
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

  if (!requestedDay && tripShame.hours.length === 0 && routeShame.hours.length === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      [tripShame, routeShame, stops] = await Promise.all([
        getShameOfDay(range, {}, TODAY_REVALIDATE),
        getShameRouteOfDay(range, {}, TODAY_REVALIDATE),
        getWorstStops(range, {}, 1, TODAY_REVALIDATE),
      ]);
    }
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString() ? "/shame" : undefined;

  const tripHref = linkDay ? `/shame/trip?day=${linkDay}` : "/shame/trip";
  const routeHref = linkDay ? `/shame/route?day=${linkDay}` : "/shame/route";
  const stopHref = linkDay ? `/shame/stop?day=${linkDay}` : "/shame/stop";

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
            Shame of the Day
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">The worst trip, route, and stop</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <a href={tripHref} className="chip chip-off">
              Trips
            </a>
            <a href={routeHref} className="chip chip-off">
              Routes
            </a>
            <a href={stopHref} className="chip chip-off">
              Stops
            </a>
          </div>
          <DayNav
            basePath="/shame"
            serviceDate={serviceDate}
            preservedParams={{}}
            hasPrev={hasPrevDay}
            hasNext={hasNextDay}
            nextHref={nextDayHref}
          />
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ShameOfDay trip={tripShame.worst} href={tripHref} hours={tripShame.hours} />
        <WorstRouteCard route={routeShame.worst} href={routeHref} />
        <WorstStopCard stop={stops[0] ?? null} href={stopHref} />
      </div>
    </main>
  );
}
