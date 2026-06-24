import { AlertBanner } from "@/components/AlertBanner";
import { DayNav } from "@/components/DayNav";
import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { RankBoard } from "@/components/RankBoard";
import { RouteTable, type RouteSort } from "@/components/RouteTable";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { ShameOfDay } from "@/components/ShameOfDay";
import { WorstStopCard } from "@/components/WorstStopCard";
import { getServiceAlerts, networkWideAlerts } from "@/lib/at-alerts";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getRankings,
  getShameOfDay,
  getWorstStops,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import {
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import { nzServiceDayRange, nzServiceDayString } from "@/lib/time";
import type { JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
const TODAY_REVALIDATE = 300; // 5 minutes

/** Query params for the home page. */
interface HomeSearchParams {
  sort?: string;
  mode?: string;
  school?: string;
  dir?: string;
  day?: string;
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
  dropTodayParam("/", sp);
  const sort = (
    ["route", "events", "avg_delay", "on_time"].includes(sp.sort ?? "") ? sp.sort : "on_time"
  ) as RouteSort;
  const mode = (
    ["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null
  ) as ModeFilterValue;
  const dir = (["late", "early"].includes(sp.dir ?? "") ? sp.dir : null) as DelayDirection;

  // Service day from ?day (or the current one). When no day is requested and the
  // current service day is too sparse to fill the boards (early morning, or
  // ingest catching up), fall back to the most recent service day that does.
  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  let range = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  let rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
  if (!requestedDay && !rows.some((r) => r.events >= MIN_BOARD_EVENTS)) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
    }
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  // Filters narrow the route lists. School services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";
  // Stepper bounds, and the "of the day" cards are all independent once the
  // service-day window is finalised - run them in a single round-trip.
  const [earliestDay, shame, worstStops, allAlerts] = await Promise.all([
    getEarliestDataDay(1),
    getShameOfDay(range, { mode, includeSchool }, TODAY_REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, TODAY_REVALIDATE),
    getServiceAlerts(),
  ]);
  const networkAlerts = networkWideAlerts(allAlerts);
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;
  // Only pin ?day on route links for a past day; today's links stay clean so they
  // don't bounce through dropTodayParam's redirect (a 307 on every click).
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  // The KPI strip reflects exactly the visible rows, so the mode filter and the
  // school-bus toggle both flow through to the totals (no separate fleet query).
  const heroData = summariseRows(visible);
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  // Mode chips are hidden when that mode has no qualifying rows for the day.
  const availableModes = new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode));
  // Route table always shows all routes regardless of the active mode chip.
  const tableRows = includeSchool
    ? rows
    : rows.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  const boards = deriveBoards(visible, { minEvents: boardMin });
  const offSchedule = deriveOffSchedule(visible, { minEvents: boardMin, direction: dir });

  // Each control preserves the others' params so the filters compose in links.
  const modePreserved: Record<string, string> = {};
  const schoolPreserved: Record<string, string> = {};
  const dirPreserved: Record<string, string> = {};
  const dayPreserved: Record<string, string> = {};
  if (sort !== "on_time") {
    modePreserved.sort = sort;
    schoolPreserved.sort = sort;
    dirPreserved.sort = sort;
    dayPreserved.sort = sort;
  }
  if (mode) {
    schoolPreserved.mode = mode;
    dirPreserved.mode = mode;
    dayPreserved.mode = mode;
  }
  if (includeSchool) {
    modePreserved.school = "1";
    dirPreserved.school = "1";
    dayPreserved.school = "1";
  }
  if (dir) {
    modePreserved.dir = dir;
    schoolPreserved.dir = dir;
    dayPreserved.dir = dir;
  }
  // A non-default day pins itself onto every other control's links.
  if (requestedDay) {
    modePreserved.day = requestedDay;
    schoolPreserved.day = requestedDay;
    dirPreserved.day = requestedDay;
  }

  const shameParams = new URLSearchParams();
  if (serviceDate !== nzServiceDayString()) shameParams.set("day", serviceDate);
  if (includeSchool) shameParams.set("school", "1");
  if (mode) shameParams.set("mode", mode);
  const shameHref = `/shame${shameParams.toString() ? `?${shameParams.toString()}` : ""}`;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
          How bad was it today?
        </h1>
        <DayNav
          basePath="/"
          serviceDate={serviceDate}
          preservedParams={dayPreserved}
          hasPrev={hasPrevDay}
          hasNext={hasNextDay}
        />
      </header>

      <AlertBanner alerts={networkAlerts} />

      <FleetSummary data={heroData} />

      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Shame of the day</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {shame.worst != null ? (
          <ShameOfDay trip={shame.worst} href={shameHref} />
        ) : worstStops[0] ? (
          <WorstStopCard stop={worstStops[0]} day={linkDay} />
        ) : (
          <ShameOfDay trip={null} href={shameHref} />
        )}
        {shame.worst != null && <WorstStopCard stop={worstStops[0] ?? null} day={linkDay} />}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ModeFilter
          active={mode}
          basePath="/"
          preservedParams={modePreserved}
          availableModes={availableModes}
        />
        <SchoolBusToggle active={includeSchool} basePath="/" preservedParams={schoolPreserved} />
      </div>

      {mode && visible.every((r) => r.events < boardMin) && (
        <p className="text-sm text-at-muted">
          Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this day — try a wider
          window on the{" "}
          <a href="/rankings" className="underline">
            rankings
          </a>{" "}
          page or switch back to All.
        </p>
      )}

      <div className="flex justify-end">
        <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={offSchedule}
          metric="delay"
          routeDay={linkDay}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          routeDay={linkDay}
        />
      </div>

      <a
        href="/rankings"
        className="flex items-center justify-between gap-3 bg-at-ocean px-6 py-5 text-white transition-colors hover:bg-at-ocean/90"
      >
        <span className="text-lg font-ultra tracking-zero">Top routes</span>
      </a>

      <details className="border border-at-border bg-at-surface">
        <summary className="cursor-pointer px-4 py-3 font-semibold">All routes</summary>
        <div className="p-2">
          <RouteTable rows={tableRows} sort={sort} routeDay={linkDay} />
        </div>
      </details>
    </main>
  );
}
