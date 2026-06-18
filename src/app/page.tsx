import { FleetSummary } from "@/components/FleetSummary";
import { ModeBreakdown } from "@/components/ModeBreakdown";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { cn } from "@/lib/cn";
import { getFleetSummary, getModeBreakdown, getMostRecentDataDay, getRankings } from "@/lib/data";
import { deriveBoards, MIN_BOARD_EVENTS, sortRows } from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import { nzDayRange } from "@/lib/time";
import type { JSX } from "react";

const THRESHOLD_SEC = 300;
const TODAY_REVALIDATE = 300; // 5 minutes

/** Query params for the home page. */
interface HomeSearchParams {
  sort?: string;
  mode?: string;
  school?: string;
}

/**
 * Home: today's network performance dashboard.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (table sort).
 * @returns Page markup.
 */
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const sort = (
    ["route", "events", "avg_delay", "on_time"].includes(sp.sort ?? "") ? sp.sort : "on_time"
  ) as RouteSort;
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;

  // Today (Auckland). If today lacks enough data to fill the boards yet (early
  // morning, or ingest still catching up), fall back to the latest day that does.
  let range = nzDayRange();
  let rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
  let dayLabel = "today";
  if (!rows.some((r) => r.events >= MIN_BOARD_EVENTS)) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzDayRange(latestDay);
      rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
      dayLabel = latestDay.toLocaleDateString("en-NZ", {
        timeZone: "Pacific/Auckland",
        day: "numeric",
        month: "short",
      });
    }
  }

  const [fleet, modes] = await Promise.all([
    getFleetSummary(range, THRESHOLD_SEC, TODAY_REVALIDATE),
    getModeBreakdown(range, THRESHOLD_SEC, TODAY_REVALIDATE),
  ]);
  // Filters narrow the route lists; fleet KPIs stay network-wide. School
  // services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name));
  const boards = deriveBoards(visible, { minEvents: MIN_BOARD_EVENTS });

  // Each control preserves the others' params so the filters compose in links.
  const modePreserved: Record<string, string> = {};
  const schoolPreserved: Record<string, string> = {};
  const tablePreserved: Record<string, string> = {};
  if (sort !== "on_time") {
    modePreserved.sort = sort;
    schoolPreserved.sort = sort;
  }
  if (mode) {
    schoolPreserved.mode = mode;
    tablePreserved.mode = mode;
  }
  if (includeSchool) {
    modePreserved.school = "1";
    tablePreserved.school = "1";
  }

  return (
    <main className={cn("space-y-6")}>
      <header className={cn("space-y-3")}>
        <div className={cn("flex flex-wrap items-end justify-between gap-2")}>
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-zero text-at-shore uppercase">
              Auckland network
            </p>
            <h1 className={cn("text-4xl leading-headline font-ultra tracking-zero")}>
              How Auckland&apos;s transport ran {dayLabel === "today" ? "today" : `on ${dayLabel}`}
            </h1>
            <p className="max-w-2xl text-at-muted">
              Punctuality across every bus, train, and ferry route - the earliest, the latest, and
              the most reliable, refreshed through the day.
            </p>
          </div>
          <span className={cn("shrink-0 text-sm text-at-muted")}>Showing {dayLabel}</span>
        </div>
        <div className="metro-rule" />
      </header>

      <FleetSummary data={fleet} />

      <div className={cn("flex flex-wrap items-center gap-3")}>
        <ModeFilter active={mode} basePath="/" preservedParams={modePreserved} />
        <SchoolBusToggle active={includeSchool} basePath="/" preservedParams={schoolPreserved} />
      </div>

      <div className={cn("grid gap-4 md:grid-cols-2")}>
        <RankBoard
          title="Running latest"
          accentClass="text-at-late"
          rows={boards.latest}
          metric="delay"
          thresholdSec={THRESHOLD_SEC}
        />
        <RankBoard
          title="Running earliest"
          accentClass="text-at-early"
          rows={boards.earliest}
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

      <a
        href="/rankings?window=week"
        className={cn(
          "flex items-center justify-between rounded-xl bg-at-ocean px-5 py-4 text-white shadow-sm",
        )}
      >
        <span className={cn("font-ultra tracking-zero")}>This week&apos;s top routes</span>
        <span className={cn("text-at-safety")}>View weekly &rsaquo;</span>
      </a>

      <details className={cn("rounded-xl bg-at-surface shadow-sm")}>
        <summary className={cn("cursor-pointer px-4 py-3 font-semibold")}>All routes</summary>
        <div className={cn("p-2")}>
          <RouteTable
            rows={sortRows(visible, sort)}
            basePath="/"
            preservedParams={tablePreserved}
            sort={sort}
          />
        </div>
      </details>
    </main>
  );
}
