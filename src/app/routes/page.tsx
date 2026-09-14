// src/app/routes/page.tsx
// Routes page: every route with arrivals in a day, week or month, with filters
// (mode, area, late or early, enough data, cancellations, school services),
// sorts, a KPI strip over the routes that pass, and a link to each route's page.
// The window is resolved here on the server; the filters run on the client in
// RouteExplorer. The day view falls back to the most recent day with data when
// the current one is too sparse, as the home page does.

import { RangeControls } from "@/components/RangeControls";
import { RouteExplorer } from "@/components/RouteExplorer";
import {
  getCancelledRoutes,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getRouteAreas,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  type RangeNav,
} from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { parseExplorerFilters, type ExplorerRoute } from "@/lib/route-explorer";
import { successorSlug } from "@/lib/route-lineage";
import { routeSlug } from "@/lib/route-slug";
import { isSchoolBus } from "@/lib/school-bus";
import { nzServiceDayRange, nzServiceDayString, type DateRange } from "@/lib/time";
import type { TopRouteRow } from "@/types/api";
import type { Metadata } from "next";
import type { JSX } from "react";

export const metadata: Metadata = {
  title: "Routes",
  description:
    "Every Auckland Transport route's punctuality and cancellations, filtered by mode and area.",
};

/** Cache TTL for the live day's rows (seconds). */
const DAY_REVALIDATE = 300;
/** Cache TTL for a week or month's rows (seconds), as on the home page's week and month. */
const PERIOD_REVALIDATE = 3600;
/** Row cap that returns every route with a cancellation. */
const ALL_ROUTES = 10_000;

/**
 * Routes page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window params (`window`, `day`, `period`) plus the explorer's filters.
 * @returns Page markup.
 */
export default async function RoutesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window === "day") dropTodayParam("/routes", sp);
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let rows: TopRouteRow[];
  let nav: RangeNav;
  let serviceDate: string | null = null;
  let period: string | null = null;
  const revalidate = window === "day" ? DAY_REVALIDATE : PERIOD_REVALIDATE;
  if (window === "day") {
    const requestedDay = resolveRequestedDay(sp.day);
    range = nzServiceDayRange(requestedDay ?? new Date());
    rows = await getRankings(range, ON_TIME_LATE_SEC, revalidate);
    const fallbackDay = await maybeFallbackDay(
      requestedDay,
      !rows.some((r) => r.events >= MIN_BOARD_EVENTS),
      MIN_BOARD_EVENTS,
    );
    if (fallbackDay) {
      range = nzServiceDayRange(fallbackDay);
      rows = await getRankings(range, ON_TIME_LATE_SEC, revalidate);
    }
    serviceDate = nzServiceDayString(range.start);
    nav = dayRangeNav(serviceDate, earliest);
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/routes",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
    ));
    rows = await getRankings(range, ON_TIME_LATE_SEC, revalidate);
  }

  // Every mode and school services too: the explorer filters those itself.
  const [cancelledRoutes, areas] = await Promise.all([
    getCancelledRoutes(range, { mode: null, includeSchool: true }, ALL_ROUTES, revalidate),
    getRouteAreas(),
  ]);
  const rowSlugs = new Set(rows.map((r) => routeSlug(r.route_id)));
  // The rows fold a retired train line into its successor (see foldLineageRows),
  // so its cancellations follow it there.
  const cancelledBySlug = new Map<string, number>();
  for (const c of cancelledRoutes) {
    const successor = successorSlug(c.route_id);
    const slug =
      !rowSlugs.has(c.route_id) && successor && rowSlugs.has(successor) ? successor : c.route_id;
    cancelledBySlug.set(slug, (cancelledBySlug.get(slug) ?? 0) + c.cancelled);
  }
  /**
   * An explorer row from a route row plus what the filters need.
   * @param r - The route row.
   * @returns The explorer row.
   */
  const toExplorer = (r: TopRouteRow): ExplorerRoute => {
    const slug = routeSlug(r.route_id);
    return {
      ...r,
      slug,
      areas: areas[slug] ?? [],
      cancelled: cancelledBySlug.get(slug) ?? 0,
      school: isSchoolBus(r.short_name, r.long_name),
    };
  };
  // A route that cancelled trips but recorded no arrival (a service with no
  // realtime feed, or one cancelled all day) still belongs on the list, with no
  // punctuality figures, so the cancellation totals add up.
  const cancelOnly: TopRouteRow[] = cancelledRoutes
    .filter((c) => !rowSlugs.has(c.route_id) && !rowSlugs.has(successorSlug(c.route_id) ?? ""))
    .map((c) => ({
      route_id: c.route_id,
      short_name: c.short_name,
      long_name: c.long_name ?? c.route_id,
      mode: c.mode,
      colour: c.colour,
      events: 0,
      avg_delay_sec: null,
      avg_abs_delay_sec: null,
      on_time_pct: null,
      early_pct: null,
      late_pct: null,
    }));
  const explorerRows = [...rows, ...cancelOnly].map(toExplorer);

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Routes</h1>
        <RangeControls basePath="/routes" nav={nav} />
      </header>

      <RouteExplorer
        rows={explorerRows}
        initialFilters={parseExplorerFilters(sp)}
        routeQuery={routeLinkQuery(window, serviceDate, period)}
      />

      <p className="text-xs text-at-muted">
        Areas come from the stops each route served over the last seven days, placed against
        approximate boundaries; a route is listed under every area it serves. Routes with
        cancellations but no recorded arrivals are listed without punctuality figures. A cancelled
        trip counts as late at every stop it missed, by the wait for the next trip.
      </p>
    </main>
  );
}
