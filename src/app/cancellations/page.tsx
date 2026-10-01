// src/app/cancellations/page.tsx
// Cancellations page: every trip AT flagged as cancelled in a day, week or
// month, split by how the flag played out (never ran, cut short, reinstated),
// the routes with the most, and the trips themselves linking to their trip
// pages. The KPI strip, board and list all come from one list of flagged trips,
// so the mode and school-bus filters flow through all three alike. The day view
// opens on the same day as every other day page (see resolveShownDay).

import { CancellationSummary } from "@/components/cancellation/CancellationSummary";
import { CancelledBoard } from "@/components/cancellation/CancelledBoard";
import { CancelledTripList } from "@/components/cancellation/CancelledTripList";
import { RangeControls } from "@/components/date/RangeControls";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { ChevronRight } from "@/components/icons";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getNetworkCancelledTrips,
  type CancelledRouteRow,
  type NetworkCancelledTrip,
} from "@/lib/data";
import { parseMode } from "@/lib/mode";
import { cardMetadata, cardPath, listCardTitle, parseListCard } from "@/lib/og";
import { resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import {
  dayRangeNav,
  parseRangeWindow,
  periodRangeNav,
  rangeViewParams,
  routeLinkParams,
  type RangeNav,
} from "@/lib/page/range";
import { compareRouteNumbers, routeDisplayName } from "@/lib/route/slug";
import { parseSchoolFilter, schoolAllows, schoolFilterParam } from "@/lib/school-bus";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestNow } from "@/lib/time/request-now";
import { nzServiceDayString, type DateRange } from "@/lib/time/service-day";
import { CANCELLATION_STAGES } from "@/lib/trip/cancellation";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import type { JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

/** What a shared link to this page says under its title. */
const DESCRIPTION =
  "Every Auckland Transport trip flagged as cancelled: which never ran, which were cut short, and which ran anyway.";

/**
 * Title and shared-link card, built from the query alone so the metadata
 * never waits on the database. The tab keeps the plain title; the shared
 * link names the period and filter.
 * @param root0 - Page props.
 * @param root0.searchParams - The page's query params.
 * @returns The page metadata.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<CancellationsSearchParams>;
}): Promise<Metadata> {
  const card = parseListCard("cancellations", (await searchParams) ?? {});
  return {
    title: "Cancellations",
    description: DESCRIPTION,
    ...cardMetadata(listCardTitle(card), DESCRIPTION, cardPath(card)),
  };
}

/** Routes listed on the Most cancelled board before the link to the Routes page. */
const BOARD_ROUTES = 15;

/** Query params for the Cancellations page. */
interface CancellationsSearchParams {
  window?: string;
  day?: string;
  period?: string;
  mode?: string;
  school?: string;
  stage?: string;
}

/**
 * Cancellations page.
 * @param root0 - Page props.
 * @param root0.searchParams - Window (`window`, `day`, `period`) and filter (`mode`, `school`, `stage`) params.
 * @returns Page markup.
 */
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams?: Promise<CancellationsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const now = await requestNow();
  const today = nzServiceDayString(now);
  if (window === "day") {
    clampDayParam("/cancellations", sp, today);
    dropTodayParam("/cancellations", sp, today);
  }
  const mode = parseMode(sp.mode);
  const schools = parseSchoolFilter(sp.school);
  const stage = CANCELLATION_STAGES.find((s) => s === sp.stage) ?? null;
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);

  let range: DateRange;
  let trips: NetworkCancelledTrip[];
  let nav: RangeNav;
  let linkDay: string | undefined;
  let period: string | null = null;
  // Set only while reading the live day, whose list splits at this instant.
  let liveAt: number | null = null;
  if (window === "day") {
    const shown = await resolveShownDay(resolveRequestedDay(sp.day), today);
    range = shown.range;
    trips = await getNetworkCancelledTrips(range);
    nav = dayRangeNav(shown, earliest, today);
    linkDay = dayLinkParam(shown.serviceDate, today);
    if (nav.isToday) liveAt = now.getTime();
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

  const visible = trips.filter(
    (t) => (!mode || t.mode === mode) && schoolAllows(schools, t.school),
  );
  const byRoute = new Map<string, CancelledRouteRow>();
  for (const t of visible) {
    const row = byRoute.get(t.slug);
    if (row) row.cancelled++;
    else
      byRoute.set(t.slug, {
        slug: t.slug,
        shortName: t.shortName,
        longName: t.longName,
        mode: t.mode,
        colour: t.colour,
        cancelled: 1,
      });
  }
  const boardRows = [...byRoute.values()].sort(
    (a, b) =>
      b.cancelled - a.cancelled || compareRouteNumbers(routeDisplayName(a), routeDisplayName(b)),
  );
  const modes = new Set(trips.map((t) => t.mode));

  // The window params ride along on the filter chips; the window controls carry the filters.
  const windowParams = stripUnset(rangeViewParams(window, sp.day ? linkDay : undefined, period));
  const stageParam: Record<string, string> = stage ? { stage } : {};
  const schoolParam = stripUnset({ school: schoolFilterParam(schools) });
  const modePreserved = { ...windowParams, ...schoolParam, ...stageParam };
  const schoolPreserved = { ...windowParams, ...(mode ? { mode } : {}), ...stageParam };
  const stagePreserved = { ...windowParams, ...(mode ? { mode } : {}), ...schoolParam };

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
          value={schools}
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
            routeParams={routeLinkParams(window, linkDay, period)}
          />
          {boardRows.length > BOARD_ROUTES && (
            <Link
              href={buildHref("/routes", {
                ...windowParams,
                mode: mode ?? undefined,
                school: schoolFilterParam(schools),
                cancelled: "1",
                sort: "cancelled",
              })}
              className="at-link inline-flex items-center gap-1 text-sm font-semibold"
            >
              All {boardRows.length} routes with cancellations
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        {/* Keyed by what the list shows, so a new window or filter opens it at the first page. */}
        <CancelledTripList
          key={buildHref("", { ...stagePreserved, ...stageParam })}
          trips={visible}
          multiDay={window !== "day"}
          liveAt={liveAt}
          stage={stage}
          basePath="/cancellations"
          preservedParams={stagePreserved}
        />
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
