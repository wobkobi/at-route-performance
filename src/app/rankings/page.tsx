import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeBreakdown } from "@/components/ModeBreakdown";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/cn";
import { getFleetSummary, getLatestEventDate, getModeBreakdown, getRankings } from "@/lib/data";
import {
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  sortRows,
  type DelayDirection,
} from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import { nzMonthRange, nzWeekRange, nzWeekStart, type DateRange } from "@/lib/time";
import type { JSX } from "react";

const THRESHOLD_SEC = 300;
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
 * Human week label like `Week of 14 Jun` from a range start.
 * @param d - Range start (UTC instant of the local Sunday).
 * @returns Formatted label.
 */
function weekLabel(d: Date): string {
  const day = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
  }).format(d);
  return `Week of ${day}`;
}

/**
 * Resolve the active range + label, falling back to the latest period with data.
 * @param window - "week" or "month".
 * @param period - Explicit period (`YYYY-MM-DD` Sunday or `YYYY-MM`), optional.
 * @returns The range and a human label.
 */
async function resolveRange(
  window: "week" | "month",
  period?: string,
): Promise<{ range: DateRange; label: string }> {
  if (window === "month") {
    let range = nzMonthRange(period);
    let label = monthLabel(range.start);
    if (!period && (await getRankings(range, THRESHOLD_SEC, REVALIDATE)).length === 0) {
      const latest = await getLatestEventDate();
      if (latest) {
        range = nzMonthRange(monthKey(latest));
        label = monthLabel(range.start);
      }
    }
    return { range, label };
  }
  let range = nzWeekRange(period);
  let label = weekLabel(range.start);
  if (!period && (await getRankings(range, THRESHOLD_SEC, REVALIDATE)).length === 0) {
    const latest = await getLatestEventDate();
    if (latest) {
      range = nzWeekRange(nzWeekStart(latest));
      label = weekLabel(range.start);
    }
  }
  return { range, label };
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

  const { range, label } = await resolveRange(window, sp.period);
  const [rows, fleet, modes] = await Promise.all([
    getRankings(range, THRESHOLD_SEC, REVALIDATE),
    getFleetSummary(range, THRESHOLD_SEC, REVALIDATE),
    getModeBreakdown(range, THRESHOLD_SEC, REVALIDATE),
  ]);
  // Filters narrow the route lists; fleet KPIs stay network-wide. School
  // services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  const boards = deriveBoards(visible, { minEvents: boardMin });
  const offSchedule = deriveOffSchedule(visible, { minEvents: boardMin, direction: dir });

  const tablePreserved: Record<string, string> = { window };
  const modePreserved: Record<string, string> = { window };
  const schoolPreserved: Record<string, string> = { window };
  const dirPreserved: Record<string, string> = { window };
  if (sp.period) {
    tablePreserved.period = sp.period;
    modePreserved.period = sp.period;
    schoolPreserved.period = sp.period;
    dirPreserved.period = sp.period;
  }
  if (mode) {
    tablePreserved.mode = mode;
    schoolPreserved.mode = mode;
    dirPreserved.mode = mode;
  }
  if (sort !== "on_time") {
    modePreserved.sort = sort;
    schoolPreserved.sort = sort;
    dirPreserved.sort = sort;
  }
  if (includeSchool) {
    tablePreserved.school = "1";
    modePreserved.school = "1";
    dirPreserved.school = "1";
  }
  if (dir) {
    modePreserved.dir = dir;
    schoolPreserved.dir = dir;
  }

  return (
    <main className={cn("space-y-6")}>
      <header className={cn("space-y-3")}>
        <div className={cn("flex flex-wrap items-end justify-between gap-3")}>
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-zero text-at-shore uppercase">Rankings</p>
            <h1 className={cn("text-4xl leading-headline font-ultra tracking-zero")}>Top routes</h1>
          </div>
          <WindowControls window={window} periodLabel={label} />
        </div>
        <div className="metro-rule" />
      </header>

      <FleetSummary data={fleet} />

      <div className={cn("flex flex-wrap items-center gap-3")}>
        <ModeFilter active={mode} basePath="/rankings" preservedParams={modePreserved} />
        <SchoolBusToggle
          active={includeSchool}
          basePath="/rankings"
          preservedParams={schoolPreserved}
        />
      </div>

      <div className={cn("space-y-2")}>
        <div className={cn("flex justify-end")}>
          <DelayFilter active={dir} basePath="/rankings" preservedParams={dirPreserved} />
        </div>
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={offSchedule}
          metric="delay"
          thresholdSec={THRESHOLD_SEC}
        />
      </div>

      <div className={cn("grid gap-4 md:grid-cols-2")}>
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          thresholdSec={THRESHOLD_SEC}
        />
        <ModeBreakdown modes={modes} />
      </div>

      <RouteTable
        rows={sortRows(visible, sort)}
        basePath="/rankings"
        preservedParams={tablePreserved}
        sort={sort}
      />
    </main>
  );
}
