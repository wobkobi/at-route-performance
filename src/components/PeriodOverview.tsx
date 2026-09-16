// src/components/PeriodOverview.tsx
// The home page body for a week or month: KPI strip, shame cards, filters and the
// two top-ten boards with rank movement against the previous period. Streams in
// behind the page header, since a cold month fans out to ~30 per-day aggregations.

import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { SectionLink } from "@/components/SectionLink";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WorstStopCard } from "@/components/WorstStopCard";
import {
  getCancelledByRoute,
  getCancelledCount,
  getRankings,
  getShameOfWeek,
  getWorstStops,
} from "@/lib/data";
import { rangeIsEmpty } from "@/lib/data-start";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import {
  computeRankDelta,
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { resolvePrevRange, type RankMode, type RankWindow } from "@/lib/rankings-page";
import { viewQuery } from "@/lib/route-explorer";
import { isSchoolBus } from "@/lib/school-bus";
import { buildShameHref } from "@/lib/shame-page";
import type { DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { TopRouteRow } from "@/types/api";
import type { JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 3600; // 1 hour
/** Routes each board shows; the full ranking is on the Routes page. */
const BOARD_SIZE = 10;

/**
 * Week or month overview: runs the four-query ranking batch and derives the KPI
 * strip, shame cards and rank boards.
 * @param root0 - Props.
 * @param root0.window - The active window.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.dir - Delay-direction filter for the off-schedule board.
 * @param root0.includeSchool - Whether school services are included.
 * @param root0.period - Raw `?period=` value, used for prev-range and row links.
 * @param root0.range - The active window's date range.
 * @param root0.anchor - The latest day with data (or now).
 * @returns The overview body markup.
 */
export async function PeriodOverview({
  window,
  mode,
  dir,
  includeSchool,
  period,
  range,
  anchor,
}: {
  window: RankWindow;
  mode: RankMode;
  dir: DelayDirection;
  includeSchool: boolean;
  period: string | undefined;
  range: DateRange;
  anchor: Date;
}): Promise<JSX.Element> {
  // The first week and the first month have no real previous window: resolvePrevRange
  // clamps it away to nothing, and querying that would rank every route as a new entry.
  const prevRange = resolvePrevRange(window, period, anchor);
  const [rows, worstStops, prevRows, shame, cancelled, cancelledByRoute] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, REVALIDATE),
    rangeIsEmpty(prevRange)
      ? Promise.resolve<TopRouteRow[]>([])
      : getRankings(prevRange, THRESHOLD_SEC, REVALIDATE),
    getShameOfWeek(range, { mode, includeSchool }, REVALIDATE),
    getCancelledCount(range, { mode, includeSchool }, REVALIDATE),
    getCancelledByRoute(range, { mode, includeSchool }, REVALIDATE),
  ]);
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  // The KPI strip reflects exactly the visible rows, so the mode filter and the
  // school-bus toggle both flow through to the totals (no separate fleet query).
  // Cancellations are the exception: they produce no arrival row, so they come
  // from their own count under the same filters.
  const heroData = { ...summariseRows(visible), cancelled };
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  // Mode chips are hidden when that mode has no qualifying rows for the period.
  const availableModes = new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode));
  // Full ranked lists: the boards show the top 10 and link to the rest on the
  // Routes page, and deltas are computed across the whole list (current and previous).
  const boards = deriveBoards(visible, { minEvents: boardMin, size: Infinity });
  const offSchedule = deriveOffSchedule(visible, {
    minEvents: boardMin,
    direction: dir,
    size: Infinity,
  });
  const prevFiltered = (mode ? prevRows.filter((r) => r.mode === mode) : prevRows).filter(
    (r) => includeSchool || !isSchoolBus(r.short_name, r.long_name),
  );
  const offScheduleDeltas =
    prevFiltered.length > 0
      ? computeRankDelta(
          offSchedule,
          deriveOffSchedule(prevFiltered, { minEvents: boardMin, direction: dir, size: Infinity }),
        )
      : undefined;
  const reliableDeltas =
    prevFiltered.length > 0
      ? computeRankDelta(
          boards.reliable,
          deriveBoards(prevFiltered, { minEvents: boardMin, size: Infinity }).reliable,
        )
      : undefined;

  const modePreserved: Record<string, string> = { window };
  const schoolPreserved: Record<string, string> = { window };
  const dirPreserved: Record<string, string> = { window };
  if (period) {
    modePreserved.period = period;
    schoolPreserved.period = period;
    dirPreserved.period = period;
  }
  if (mode) {
    schoolPreserved.mode = mode;
    dirPreserved.mode = mode;
  }
  if (includeSchool) {
    modePreserved.school = "1";
    dirPreserved.school = "1";
  }
  if (dir) {
    modePreserved.dir = dir;
    schoolPreserved.dir = dir;
  }

  // The shame boards take the same window and filters, so their links carry both.
  const shameNav = { window, period };
  const shameFilter = { mode, includeSchool };
  const shameTripHref = buildShameHref("/shame/trip", shameNav, shameFilter);

  return (
    <>
      <FleetSummary data={heroData} />

      <SectionLink title={`Shame of the ${window}`} href={shameTripHref} />
      <div className="grid gap-4 md:grid-cols-2">
        <ShameOfDay trip={shame.worst} period={window} href={shameTripHref} />
        <WorstStopCard
          stop={worstStops[0] ?? null}
          href={buildShameHref("/shame/stop", shameNav, shameFilter)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ModeFilter
            active={mode}
            basePath="/"
            preservedParams={modePreserved}
            availableModes={availableModes}
          />
          <SchoolBusToggle active={includeSchool} basePath="/" preservedParams={schoolPreserved} />
        </div>
        <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
      </div>

      {mode && visible.every((r) => r.events < boardMin) && (
        <p className="text-sm text-at-muted">
          Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this period - try a
          wider window or switch back to All.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={offSchedule.slice(0, BOARD_SIZE)}
          metric="delay"
          cancelled={cancelledByRoute}
          deltas={offScheduleDeltas}
          routeWindow={window}
          routePeriod={period}
          total={offSchedule.length}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("off", { mode, school: includeSchool, lean: dir }),
          })}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable.slice(0, BOARD_SIZE)}
          metric="onTime"
          deltas={reliableDeltas}
          routeWindow={window}
          routePeriod={period}
          total={boards.reliable.length}
          seeAllHref={buildHref("/routes", {
            window,
            period,
            ...viewQuery("reliable", { mode, school: includeSchool }),
          })}
        />
      </div>

      <p className="text-xs text-at-muted">
        Rankings are built from real-time stop events and refresh hourly. A cancelled trip counts as
        late at every stop it missed, by the wait for the next trip.
        {(offScheduleDeltas || reliableDeltas) &&
          ` Movement arrows compare each route to its position in the previous ${window === "month" ? "month" : "week"}.`}
      </p>
    </>
  );
}
