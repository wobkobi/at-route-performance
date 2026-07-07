// src/app/rankings/page.tsx
/**
 * @description Rankings page rendering week or month network performance.
 */
import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { RankingsBodySkeleton } from "@/components/RankingsBodySkeleton";
import { RouteTable } from "@/components/RouteTable";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WindowControls } from "@/components/WindowControls";
import { WorstStopCard } from "@/components/WorstStopCard";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getShameOfWeek,
  getWorstStops,
} from "@/lib/data";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { resolveMonthNav, resolveRequestedMonth, resolveWeekNav } from "@/lib/page-nav";
import {
  computeRankDelta,
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import {
  parseRankingsParams,
  rankHref,
  resolvePrevRange,
  resolveRange,
  type RankingsSearchParams,
  type RankMode,
  type RankSort,
  type RankWindow,
} from "@/lib/rankings-page";
import { isSchoolBus } from "@/lib/school-bus";
import type { DateRange } from "@/lib/time";
import { Suspense, type JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 3600; // 1 hour

/**
 * Rankings body: runs the four-query ranking batch and derives the KPI strip,
 * shame cards, rank boards and route table. Streams in behind the header so
 * the shell never waits on a cold period (a cold month fans out to ~30 per-day
 * aggregations).
 * @param root0 - Props.
 * @param root0.window - The active window.
 * @param root0.sort - Route-table sort column.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.dir - Delay-direction filter for the off-schedule board.
 * @param root0.includeSchool - Whether school services are included.
 * @param root0.period - Raw `?period=` value, used for prev-range and row links.
 * @param root0.range - The active window's date range.
 * @param root0.anchor - The latest day with data (or now).
 * @returns The rankings body markup.
 */
async function RankingsBody({
  window,
  sort,
  mode,
  dir,
  includeSchool,
  period,
  range,
  anchor,
}: {
  window: RankWindow;
  sort: RankSort;
  mode: RankMode;
  dir: DelayDirection;
  includeSchool: boolean;
  period: string | undefined;
  range: DateRange;
  anchor: Date;
}): Promise<JSX.Element> {
  const [rows, worstStops, prevRows, shame] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, REVALIDATE),
    getRankings(resolvePrevRange(window, period, anchor), THRESHOLD_SEC, REVALIDATE),
    getShameOfWeek(range, { mode, includeSchool }, REVALIDATE),
  ]);
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  // The KPI strip reflects exactly the visible rows, so the mode filter and the
  // school-bus toggle both flow through to the totals (no separate fleet query).
  const heroData = summariseRows(visible);
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  // Mode chips are hidden when that mode has no qualifying rows for the period.
  const availableModes = new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode));
  // Full ranked lists: the boards show the top 10 and expand to the rest in
  // place, so deltas are computed across the whole list (current and previous).
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
  if (sort !== "on_time") {
    modePreserved.sort = sort;
    schoolPreserved.sort = sort;
    dirPreserved.sort = sort;
  }
  if (includeSchool) {
    modePreserved.school = "1";
    dirPreserved.school = "1";
  }
  if (dir) {
    modePreserved.dir = dir;
    schoolPreserved.dir = dir;
  }

  return (
    <>
      <FleetSummary data={heroData} />

      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Shame of the {window}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <ShameOfDay
          trip={shame.worst}
          period={window}
          href={`/shame/trip?window=${window}${period ? `&period=${period}` : ""}`}
        />
        <WorstStopCard
          stop={worstStops[0] ?? null}
          href={`/shame/stop?window=${window}${period ? `&period=${period}` : ""}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/rankings"
          preservedParams={modePreserved}
          availableModes={availableModes}
        />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/rankings"
          preservedParams={schoolPreserved}
        />
      </div>

      {mode && visible.every((r) => r.events < boardMin) && (
        <p className="text-sm text-at-muted">
          Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this period — try a
          wider window or switch back to All.
        </p>
      )}

      <div className="flex justify-end">
        <DelayFilter active={dir} basePath="/rankings" preservedParams={dirPreserved} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={offSchedule}
          metric="delay"
          deltas={offScheduleDeltas}
          routeWindow={window}
          routePeriod={period}
          collapseAt={10}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          deltas={reliableDeltas}
          routeWindow={window}
          routePeriod={period}
          collapseAt={10}
        />
      </div>

      <p className="text-xs text-at-muted">
        Rankings are built from real-time stop events and refresh hourly. Movement arrows compare
        each route to its position in the previous {window === "month" ? "month" : "week"}.
      </p>

      <RouteTable rows={visible} sort={sort} routeWindow={window} routePeriod={period} />
    </>
  );
}

/**
 * Rankings page: week or month network performance. The header and period
 * stepper render immediately from cheap cached lookups; the ranking batch
 * streams in behind them.
 * @param root0 - Page props.
 * @param root0.searchParams - Window, period, and sort params.
 * @returns Page markup.
 */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams?: Promise<RankingsSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const { window, sort, mode, dir, includeSchool, filters } = parseRankingsParams(sp);

  // Anchor every window to the latest day with data so a quiet "today" still
  // shows a populated period. Both lookups are cheap cached point queries.
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range, label } = resolveRange(window, sp.period, anchor);

  // Period stepper: the rolling week / current month is the present (no next);
  // stepping back pages through calendar periods, bounded by the earliest data.
  /**
   * Build a rankings link for a period, preserving the active filters.
   * @param period - The week or month period, or null for the rolling default.
   * @returns The rankings href.
   */
  const periodHref = (period: string | null): string => rankHref(window, period, filters);
  const { prevHref, nextHref } =
    window === "week"
      ? resolveWeekNav({
          periodParam: sp.period ?? null,
          earliestDay: earliest,
          makeHref: periodHref,
          now: anchor,
        })
      : resolveMonthNav({
          periodParam: resolveRequestedMonth(sp.period),
          earliestDay: earliest,
          makeHref: periodHref,
          now: anchor,
        });

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">Top routes</h1>
        <WindowControls
          window={window}
          periodLabel={label}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </header>

      <Suspense fallback={<RankingsBodySkeleton />}>
        <RankingsBody
          window={window}
          sort={sort}
          mode={mode}
          dir={dir}
          includeSchool={includeSchool}
          period={sp.period}
          range={range}
          anchor={anchor}
        />
      </Suspense>
    </main>
  );
}
