// src/app/cancellations/page.tsx
// Cancellations page: every trip AT flagged as cancelled in a day, week or
// month, split by how the flag played out (never ran, cut short, reinstated),
// the routes with the most, and the trips themselves linking to their trip
// pages. The KPI strip, board and list all come from one list of flagged trips,
// so the mode and school-bus filters flow through all three alike. The day view
// falls back to the most recent day with data when the current one has no
// cancellations yet, as the home page does for arrivals.

import { CancellationSummary } from "@/components/CancellationSummary";
import { CancelledBoard } from "@/components/CancelledBoard";
import { CancelledTripList } from "@/components/CancelledTripList";
import { ChevronRight } from "@/components/icons";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RangeControls } from "@/components/RangeControls";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getNetworkCancelledTrips,
  type CancelledRouteRow,
  type NetworkCancelledTrip,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import { dayRangeNav, parseRangeWindow, periodRangeNav, type RangeNav } from "@/lib/range-page";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { nzServiceDayRange, nzServiceDayString, type DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

export const metadata: Metadata = {
  title: "Cancellations",
  description:
    "Every Auckland Transport trip flagged as cancelled: which never ran, which were cut short, and which ran anyway.",
};

/** Routes listed on the Most cancelled board before the link to the Routes page. */
const BOARD_ROUTES = 15;

/** Query params for the Cancellations page. */
interface CancellationsSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
}

/**
 * Cancellations page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`) and filter (`mode`, `school`) params.
 * @returns Page markup.
 */
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams?: Promise<CancellationsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window === "day") dropTodayParam("/cancellations", sp);
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const includeSchool = sp.school === "1";
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let trips: NetworkCancelledTrip[];
  let nav: RangeNav;
  let linkDay: string | undefined;
  let period: string | null = null;
  if (window === "day") {
    const requestedDay = resolveRequestedDay(sp.day);
    range = nzServiceDayRange(requestedDay ?? new Date());
    trips = await getNetworkCancelledTrips(range);
    const fallbackDay = await maybeFallbackDay(requestedDay, trips.length === 0, MIN_BOARD_EVENTS);
    if (fallbackDay) {
      range = nzServiceDayRange(fallbackDay);
      trips = await getNetworkCancelledTrips(range);
    }
    const serviceDate = nzServiceDayString(range.start);
    nav = dayRangeNav(serviceDate, earliest);
    linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;
  } else {
    ({ range, period, nav } = periodRangeNav(
      "/cancellations",
      window,
      sp.period,
      latest ?? new Date(),
      earliest,
    ));
    trips = await getNetworkCancelledTrips(range);
  }

  const visible = trips.filter((t) => (!mode || t.mode === mode) && (includeSchool || !t.school));
  const byRoute = new Map<string, CancelledRouteRow>();
  for (const t of visible) {
    const row = byRoute.get(t.route_id);
    if (row) row.cancelled++;
    else
      byRoute.set(t.route_id, {
        route_id: t.route_id,
        short_name: t.short_name,
        long_name: t.long_name,
        mode: t.mode,
        colour: t.colour,
        cancelled: 1,
      });
  }
  const boardRows = [...byRoute.values()].sort(
    (a, b) =>
      b.cancelled - a.cancelled ||
      (a.short_name ?? a.route_id).localeCompare(b.short_name ?? b.route_id, undefined, {
        numeric: true,
      }),
  );
  const modes = new Set(trips.map((t) => t.mode));

  // The window params ride along on the filter chips; the window controls carry the filters.
  const windowParams: Record<string, string> = {};
  if (window !== "day") windowParams.window = window;
  if (window === "day" && linkDay && sp.day) windowParams.day = linkDay;
  if (period) windowParams.period = period;
  const modePreserved = { ...windowParams, ...(includeSchool ? { school: "1" } : {}) };
  const schoolPreserved = { ...windowParams, ...(mode ? { mode } : {}) };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Cancellations</h1>
        <RangeControls basePath="/cancellations" nav={nav} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/cancellations"
          preservedParams={modePreserved}
          availableModes={modes}
        />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/cancellations"
          preservedParams={schoolPreserved}
        />
      </div>

      <CancellationSummary
        flagged={visible.length}
        neverRan={visible.filter((t) => t.stage === "before").length}
        cutShort={visible.filter((t) => t.stage === "mid-trip").length}
        reinstated={visible.filter((t) => t.stage === "ran").length}
        routes={byRoute.size}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <CancelledBoard
            rows={boardRows.slice(0, BOARD_ROUTES)}
            total={visible.length}
            routeDay={linkDay}
          />
          {boardRows.length > BOARD_ROUTES && (
            <Link
              href={buildHref("/routes", {
                ...windowParams,
                mode: mode ?? undefined,
                school: includeSchool ? "1" : undefined,
                cancelled: "1",
                sort: "cancelled",
              })}
              className="inline-flex items-center gap-1 text-sm font-semibold text-at-shore hover:underline"
            >
              All {boardRows.length} routes with cancellations
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        <CancelledTripList trips={visible} multiDay={window !== "day"} />
      </div>

      <p className="text-xs text-at-muted">
        A trip counts once AT&apos;s realtime feed flags it cancelled. &quot;Never ran&quot;
        recorded no arrival before the flag; &quot;cut short&quot; recorded arrivals up to it and
        none after; &quot;reinstated&quot; kept recording arrivals after it, so the cancellation was
        reversed. Cancellations are only known from when capture began.
      </p>
    </main>
  );
}
