// src/app/page.tsx
/**
 * @description Home page rendering today's network performance dashboard. When
 * no day is requested and the current service day is too sparse to fill the
 * boards (early morning, or ingest catching up), it falls back to the most
 * recent day that does. Mode, school-bus, delay-direction, and day filters each
 * preserve the others' params so they compose in links, and the KPI strip is
 * summarised from exactly the visible rows so the filters flow through without a
 * separate fleet query. The service-alerts fetch is kicked off without awaiting
 * and streamed in through Suspense so the dashboard shell doesn't wait on AT
 * alert latency.
 */
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
import { getServiceAlerts, networkWideAlerts, type ServiceAlert } from "@/lib/at-alerts";
import {
  getEarliestDataDay,
  getRankings,
  getShameOfDay,
  getShameRouteStreak,
  getWorstStops,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import {
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import { Suspense, type JSX } from "react";

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
  const requestedDay = resolveRequestedDay(sp.day);
  let range = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  let rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
  const fallbackDay = await maybeFallbackDay(
    requestedDay,
    !rows.some((r) => r.events >= MIN_BOARD_EVENTS),
    MIN_BOARD_EVENTS,
  );
  if (fallbackDay) {
    range = nzServiceDayRange(fallbackDay);
    serviceDate = nzServiceDayString(range.start);
    rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  // Filters narrow the route lists. School services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";
  // Stepper bounds, and the "of the day" cards are all independent once the
  // service-day window is finalised - run them in a single round-trip.
  // Start the service-alerts fetch without blocking the page: the banner streams
  // in via Suspense once it resolves, so a cold alerts cache (or dev reload)
  // doesn't gate the rest of the dashboard behind ~1-2s of AT latency.
  const alertsPromise = getServiceAlerts();
  const [earliestDay, shame, worstStops] = await Promise.all([
    getEarliestDataDay(1),
    getShameOfDay(range, { mode, includeSchool }, TODAY_REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, TODAY_REVALIDATE),
  ]);
  // Needs shame.worst.route_id, so runs after the parallel batch.
  const routeStreakDays = shame.worst
    ? await getShameRouteStreak(shame.worst.route_id, range, TODAY_REVALIDATE)
    : 0;
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
  // Full ranked lists: the boards show the top 10 and expand to the rest in place.
  const boards = deriveBoards(visible, { minEvents: boardMin, size: Infinity });
  const offSchedule = deriveOffSchedule(visible, {
    minEvents: boardMin,
    direction: dir,
    size: Infinity,
  });

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

  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString() ? "/" : undefined;

  const shameHref = buildHref("/shame/trip", {
    day: serviceDate !== nzServiceDayString() ? serviceDate : undefined,
    school: includeSchool ? "1" : undefined,
    mode: mode ?? undefined,
  });

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
          nextHref={nextDayHref}
        />
      </header>

      <Suspense fallback={null}>
        <HomeAlertBanner alertsPromise={alertsPromise} />
      </Suspense>

      <FleetSummary data={heroData} />

      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Shame of the day</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <ShameOfDay
          trip={shame.worst}
          href={shameHref}
          hours={shame.hours}
          routeStreakDays={routeStreakDays}
        />
        <WorstStopCard stop={worstStops[0] ?? null} day={linkDay} />
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
          collapseAt={10}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable}
          metric="onTime"
          routeDay={linkDay}
          collapseAt={10}
        />
      </div>

      <details className="border border-at-border bg-at-surface">
        <summary className="cursor-pointer px-4 py-3 font-semibold">All routes</summary>
        <div className="p-2">
          <RouteTable rows={tableRows} sort={sort} routeDay={linkDay} />
        </div>
      </details>
    </main>
  );
}

/**
 * Streamed network-wide service-alert banner. Awaits the shared alerts feed off
 * the critical path so the dashboard shell renders without waiting on AT alert
 * latency; renders nothing while it streams (and when there are no alerts).
 * @param root0 - Props.
 * @param root0.alertsPromise - The in-flight network-wide service-alerts fetch.
 * @returns The alert banner.
 */
async function HomeAlertBanner({
  alertsPromise,
}: {
  alertsPromise: Promise<ServiceAlert[]>;
}): Promise<JSX.Element> {
  return <AlertBanner alerts={networkWideAlerts(await alertsPromise)} />;
}
