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
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import { dayRangeNav, routeLinkQuery, windowPhrase } from "@/lib/range-page";
import { buildShameHref, parseShameParams, type ShameSearchParams } from "@/lib/shame-page";
import type { Metadata } from "next";
import type { JSX } from "react";

/**
 * Title and shared-link card, built from the query alone so the metadata
 * never waits on the database.
 * @param root0 - Page props.
 * @param root0.searchParams - The page's query params.
 * @returns The page metadata.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<Metadata> {
  const card = parseShameCard("overview", (await searchParams) ?? {});
  const title = listCardTitle(card);
  const description =
    "The worst run, route and stop of the day on Auckland's buses, trains and ferries.";
  return { title, description, ...cardMetadata(title, description, cardPath(card)) };
}

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

  const shown = await resolveShownDay(resolveRequestedDay(sp.day));
  const { range, serviceDate } = shown;
  const [tripShame, routeShame, stops, earliestDay, cancelledTotal, cancelledRoutes] =
    await Promise.all([
      getShameOfDay(range, filter, TODAY_REVALIDATE),
      getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
      getWorstStops(range, filter, 1, TODAY_REVALIDATE),
      getEarliestDataDay(1),
      getCancelledCount(range, filter, TODAY_REVALIDATE),
      getCancelledRoutes(range, filter, 10, TODAY_REVALIDATE),
    ]);

  const dayNav = dayRangeNav(shown, earliestDay);
  const linkDay = dayNav.isToday ? undefined : serviceDate;
  // Stepping onto today drops `?day` so the URL stays canonical.
  const nextDayHref = dayNav.nextIsToday ? buildShameHref("/shame", {}, filter) : undefined;

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
          hasPrev: dayNav.hasPrev,
          atFloor: dayNav.atFloor,
          hasNext: dayNav.hasNext,
          nextHref: nextDayHref,
          nextPending: dayNav.nextPending,
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Each card names one run, route or stop and opens it. The boards those
            three come from are the header's tabs, right above. */}
        <ShameOfDay
          trip={tripShame.worst}
          hours={tripShame.hours}
          when={windowPhrase(dayNav, null)}
        />
        <WorstRouteCard route={routeShame.worst} day={linkDay} />
        <WorstStopCard stop={stops[0] ?? null} day={linkDay} />
      </div>

      <CancelledBoard
        rows={cancelledRoutes}
        total={cancelledTotal}
        routeQuery={routeLinkQuery("day", linkDay, null)}
      />
    </main>
  );
}
