// src/app/rankings/page.tsx
/**
 * @description Rankings page rendering week or month network performance.
 */
import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
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
} from "@/lib/rankings";
import {
  parseRankingsParams,
  rankHref,
  resolvePrevRange,
  resolveRange,
  type RankingsSearchParams,
} from "@/lib/rankings-page";
import { isSchoolBus } from "@/lib/school-bus";
import type { JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 3600; // 1 hour

/**
 * Rankings page: week or month network performance.
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
  // shows a populated period. The earliest-day bound only feeds the stepper, so
  // it rides along rather than waiting behind the ranking batch.
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range, label } = resolveRange(window, sp.period, anchor);
  const [rows, worstStops, prevRows, shame] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, REVALIDATE),
    getRankings(resolvePrevRange(window, sp.period, anchor), THRESHOLD_SEC, REVALIDATE),
    getShameOfWeek(range, { mode, includeSchool }, REVALIDATE),
  ]);

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
  if (sp.period) {
    modePreserved.period = sp.period;
    schoolPreserved.period = sp.period;
    dirPreserved.period = sp.period;
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

      <FleetSummary data={heroData} />

      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Shame of the {window}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <ShameOfDay
          trip={shame.worst}
          period={window}
          href={`/shame/trip?window=${window}${sp.period ? `&period=${sp.period}` : ""}`}
        />
        <WorstStopCard
          stop={worstStops[0] ?? null}
          href={`/shame/stop?window=${window}${sp.period ? `&period=${sp.period}` : ""}`}
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
          routePeriod={sp.period}
          collapseAt={10}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          deltas={reliableDeltas}
          routeWindow={window}
          routePeriod={sp.period}
          collapseAt={10}
        />
      </div>

      <p className="text-xs text-at-muted">
        Rankings are built from real-time stop events and refresh hourly. Movement arrows compare
        each route to its position in the previous {window === "month" ? "month" : "week"}.
      </p>

      <RouteTable rows={visible} sort={sort} routeWindow={window} routePeriod={sp.period} />
    </main>
  );
}
