import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
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
import {
  computeRankDelta,
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import {
  nzLast7DaysRange,
  nzMonthRange,
  nzWeekRange,
  nzWeekStart,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";
import type { JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const REVALIDATE = 3600; // 1 hour

/** Query params for the rankings page. */
interface RankingsSearchParams {
  window?: string;
  period?: string;
  sort?: string;
  mode?: string;
  school?: string;
  dir?: string;
}

/**
 * Month key like `2026-06` from an instant, in Auckland local time.
 * @param d - Instant.
 * @returns `YYYY-MM`.
 */
function monthKey(d: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
  });
  return f.format(d);
}

/**
 * Human month label like `June 2026` from a range start.
 * @param d - Range start (UTC instant of local month start).
 * @returns Formatted label.
 */
function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    month: "long",
    year: "numeric",
  }).format(new Date(d.getTime() + 86_400_000));
}

/**
 * Resolve the active range + label, anchored to the latest day with data so a
 * quiet "today" still shows a populated period. The week view opens on the
 * rolling last 7 days; an explicit `period` is a calendar week (reached by
 * stepping back). Month defaults to the anchor's calendar month.
 * @param window - "week" or "month".
 * @param period - Explicit period (`YYYY-MM-DD` Monday or `YYYY-MM`), optional.
 * @param anchor - The latest day with data (or now).
 * @returns The range and a human label.
 */
function resolveRange(
  window: "week" | "month",
  period: string | undefined,
  anchor: Date,
): { range: DateRange; label: string } {
  if (window === "month") {
    const range = nzMonthRange(period ?? monthKey(anchor));
    return { range, label: monthLabel(range.start) };
  }
  if (period) {
    const range = nzWeekRange(period);
    return { range, label: weekRangeLabel(range) };
  }
  return { range: nzLast7DaysRange(anchor), label: "Last 7 days" };
}

/**
 * Build a rankings URL for a window/period, preserving the active filters.
 * @param window - The window.
 * @param period - The period (Monday `YYYY-MM-DD`), or null for the rolling default.
 * @param filters - The active mode / school / sort / direction filters.
 * @param filters.mode - Active mode, or null.
 * @param filters.school - Whether school services are shown.
 * @param filters.sort - Active table sort.
 * @param filters.dir - Active delay-direction filter, or null.
 * @returns The href.
 */
function rankHref(
  window: "week" | "month",
  period: string | null,
  filters: { mode: string | null; school: boolean; sort: string; dir: string | null },
): string {
  const p = new URLSearchParams({ window });
  if (period) p.set("period", period);
  if (filters.mode) p.set("mode", filters.mode);
  if (filters.school) p.set("school", "1");
  if (filters.sort !== "on_time") p.set("sort", filters.sort);
  if (filters.dir) p.set("dir", filters.dir);
  return `/rankings?${p.toString()}`;
}

/**
 * Range for the period immediately before the given window/period, used for
 * rank-movement comparison.
 * @param window - "week" or "month".
 * @param period - Explicit period key, or undefined for the rolling default.
 * @param anchor - Latest day with data.
 * @returns The previous period's half-open date range.
 */
function resolvePrevRange(
  window: "week" | "month",
  period: string | undefined,
  anchor: Date,
): DateRange {
  if (window === "month") {
    const key = period ?? monthKey(anchor);
    const [y, m] = key.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return nzMonthRange(prev);
  }
  if (period) return nzWeekRange(shiftWeek(period, -7));
  return nzLast7DaysRange(new Date(anchor.getTime() - 7 * 86_400_000));
}

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
  const window = sp.window === "month" ? "month" : "week";
  const sort = (
    ["route", "events", "avg_delay", "on_time"].includes(sp.sort ?? "") ? sp.sort : "on_time"
  ) as RouteSort;
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const dir = (["late", "early"].includes(sp.dir ?? "") ? sp.dir : null) as DelayDirection;
  // Filters narrow the route lists. School services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";

  // Anchor every window to the latest day with data so a quiet "today" still
  // shows a populated period.
  const latest = await getLatestEventDate();
  const anchor = latest ?? new Date();
  const { range, label } = resolveRange(window, sp.period, anchor);
  const [rows, worstStops, prevRows, shame] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, REVALIDATE),
    getRankings(resolvePrevRange(window, sp.period, anchor), THRESHOLD_SEC, REVALIDATE),
    getShameOfWeek(range, { mode, includeSchool }, REVALIDATE),
  ]);

  // Week stepper: the rolling last-7-days view is the present (no next); stepping
  // back pages through calendar weeks. Prev stops at the earliest week with data.
  const filters = { mode, school: includeSchool, sort, dir };
  let prevHref: string | null = null;
  let nextHref: string | null = null;
  if (window === "week") {
    const thisWeekStart = nzWeekStart(anchor);
    const earliest = await getEarliestDataDay(1);
    const earliestWeekStart = earliest ? nzWeekStart(earliest) : null;
    const prevWeek = shiftWeek(sp.period ?? thisWeekStart, -7);
    if (!earliestWeekStart || prevWeek >= earliestWeekStart) {
      prevHref = rankHref(window, prevWeek, filters);
    }
    if (sp.period) {
      const nextWeek = shiftWeek(sp.period, 7);
      nextHref =
        nextWeek >= thisWeekStart
          ? rankHref(window, null, filters)
          : rankHref(window, nextWeek, filters);
    }
  }
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
  const boards = deriveBoards(visible, { minEvents: boardMin });
  const offSchedule = deriveOffSchedule(visible, { minEvents: boardMin, direction: dir });
  const prevFiltered = (mode ? prevRows.filter((r) => r.mode === mode) : prevRows).filter(
    (r) => includeSchool || !isSchoolBus(r.short_name, r.long_name),
  );
  const offScheduleDeltas =
    prevFiltered.length > 0
      ? computeRankDelta(
          offSchedule,
          deriveOffSchedule(prevFiltered, { minEvents: boardMin, direction: dir }),
        )
      : undefined;
  const reliableDeltas =
    prevFiltered.length > 0
      ? computeRankDelta(
          boards.reliable,
          deriveBoards(prevFiltered, { minEvents: boardMin }).reliable,
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
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          deltas={reliableDeltas}

          routeWindow={window}
          routePeriod={sp.period}
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
