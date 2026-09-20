// src/app/(home)/page.tsx
// Home page: the network dashboard for a day, week or month. The day view is
// rendered here; a week or month streams in PeriodOverview behind the header. When
// no day is requested and the current service day is too sparse to fill the
// boards (early morning, or ingest catching up), it falls back to the most
// recent day that does. Mode, school-bus, delay-direction, and day filters each
// preserve the others' params so they compose in links, and the KPI strip is
// summarised from exactly the visible rows so the filters flow through without a
// separate fleet query. The alerts fetch starts early so it overlaps the day's
// queries, but the banner itself is awaited: it sits above the KPI strip, and
// streaming it in shoved the whole dashboard down as the reader arrived.

import { AlertBanner } from "@/components/AlertBanner";
import { DelayFilter } from "@/components/DelayFilter";
import { FleetSummary } from "@/components/FleetSummary";
import { ModeFilter, type ModeFilterValue } from "@/components/ModeFilter";
import { PeriodOverview } from "@/components/PeriodOverview";
import { RangeControls } from "@/components/RangeControls";
import { RankBoard } from "@/components/RankBoard";
import { RankingsBodySkeleton } from "@/components/RankingsBodySkeleton";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { SectionLink } from "@/components/SectionLink";
import { ShameOfDay } from "@/components/ShameOfDay";
import { FeatureCardPairSkeleton } from "@/components/SkeletonParts";
import { WorstStopCard } from "@/components/WorstStopCard";
import { getServiceAlerts, networkWideAlerts } from "@/lib/at-alerts";
import {
  getCancelledByRoute,
  getCancelledCount,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getShameOfDay,
  getShameRouteStreak,
  getWorstStops,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { DATA_START_DAY, DATA_START_LABEL } from "@/lib/data-start";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay, resolveRequestedDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  overviewHeading,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
} from "@/lib/range-page";
import {
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  summariseRows,
  type DelayDirection,
} from "@/lib/rankings";
import { parseRankingsParams } from "@/lib/rankings-page";
import { viewQuery } from "@/lib/route-explorer";
import { isSchoolBus } from "@/lib/school-bus";
import { nzServiceDayRange, nzServiceDayString, type DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import { Suspense, type JSX } from "react";

// Late bound for the on-time window + cache-key versioning; early side is per-mode.
const THRESHOLD_SEC = ON_TIME_LATE_SEC;
/** Routes each board shows; the full ranking is on the Routes page. */
const BOARD_SIZE = 10;

/** Query params for the home page. */
interface HomeSearchParams {
  window?: string;
  period?: string;
  mode?: string;
  school?: string;
  dir?: string;
  day?: string;
}

/**
 * Home for a week or month. The header and stepper render from two cheap cached
 * lookups; the ranking batch streams in behind them.
 * @param root0 - Props.
 * @param root0.window - "week" or "month".
 * @param root0.sp - The page's query params.
 * @returns Page markup.
 */
async function PeriodHome({
  window,
  sp,
}: {
  window: "week" | "month";
  sp: HomeSearchParams;
}): Promise<JSX.Element> {
  const { mode, dir, includeSchool } = parseRankingsParams(sp);
  // Anchor every window to the latest day with data so a quiet "today" still
  // shows a populated period.
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range, period, nav } = periodRangeNav("/", window, sp.period, anchor, earliest);
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
          {overviewHeading(nav, period)}
        </h1>
        <RangeControls basePath="/" nav={nav} />
      </header>

      <Suspense fallback={<RankingsBodySkeleton />}>
        <PeriodOverview
          window={window}
          mode={mode}
          dir={dir}
          includeSchool={includeSchool}
          period={period ?? undefined}
          range={range}
          anchor={anchor}
        />
      </Suspense>
    </main>
  );
}

/**
 * Home: the network performance dashboard.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (window, period, mode, school, delay direction, day).
 * @returns Page markup.
 */
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  const window = parseRangeWindow(sp.window);
  if (window !== "day") return <PeriodHome window={window} sp={sp} />;
  clampDayParam("/", sp);
  dropTodayParam("/", sp);
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
  // Filters narrow the route lists. School services (S###) are hidden unless ?school=1.
  const includeSchool = sp.school === "1";
  // Kick the alerts fetch off early so it overlaps the queries below; it is
  // awaited at render (see the banner) rather than streamed, and its 5-minute
  // cache means only the first request in a window pays AT's latency. The
  // heavier "of the day" cards do still stream.
  const alertsPromise = getServiceAlerts();
  const earliestDay = await getEarliestDataDay(1);
  // Only pin ?day on route links for a past day; today's links stay clean so they
  // don't bounce through dropTodayParam's redirect (a 307 on every click).
  const linkDay = serviceDate === nzServiceDayString() ? undefined : serviceDate;
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = includeSchool
    ? modeFiltered
    : modeFiltered.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  // The KPI strip reflects exactly the visible rows, so the mode filter and the
  // school-bus toggle both flow through to the totals (no separate fleet query).
  // Cancellations are the exception: they produce no arrival row, so they need
  // their own count under the same filters.
  const [cancelledTotal, cancelledByRoute] = await Promise.all([
    getCancelledCount(range, { mode, includeSchool }, TODAY_REVALIDATE),
    getCancelledByRoute(range, { mode, includeSchool }, TODAY_REVALIDATE),
  ]);
  const heroData = { ...summariseRows(visible), cancelled: cancelledTotal };
  // A single-mode view uses a lower bar so low-frequency modes (ferries) appear.
  const boardMin = mode ? MIN_MODE_EVENTS : MIN_BOARD_EVENTS;
  // Mode chips are hidden when that mode has no qualifying rows for the day.
  const availableModes = new Set(rows.filter((r) => r.events >= boardMin).map((r) => r.mode));
  // Full ranked lists, for the counts: the boards show the top 10 and link to
  // the rest on the Routes page.
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
  // A non-default day pins itself onto every other control's links.
  if (requestedDay) {
    modePreserved.day = requestedDay;
    schoolPreserved.day = requestedDay;
    dirPreserved.day = requestedDay;
  }

  const nav = dayRangeNav(serviceDate, earliestDay);

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
          {overviewHeading(nav, null)}
        </h1>
        <RangeControls basePath="/" nav={nav} />
      </header>

      {serviceDate === DATA_START_DAY && (
        <p className="text-sm text-at-muted">
          This is the first day on record. Nothing before {DATA_START_LABEL} was captured.
        </p>
      )}

      <AlertBanner
        alerts={networkWideAlerts(await alertsPromise)}
        pastWindow={linkDay !== undefined}
      />

      <FleetSummary data={heroData} />

      <SectionLink title="Shame of the day" href={buildHref("/shame", { day: linkDay })} />
      <Suspense fallback={<FeatureCardPairSkeleton />}>
        <HomeShameCards range={range} mode={mode} includeSchool={includeSchool} linkDay={linkDay} />
      </Suspense>

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
          Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this day - try the{" "}
          <Link
            href={buildHref("/", { window: "week", mode, school: includeSchool ? "1" : undefined })}
            className="underline"
          >
            week
          </Link>{" "}
          or switch back to All.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoard
          title="Most off-schedule"
          accentClass="text-at-ink"
          rows={offSchedule.slice(0, BOARD_SIZE)}
          metric="delay"
          cancelled={cancelledByRoute}
          routeQuery={routeLinkQuery("day", linkDay, null)}
          total={offSchedule.length}
          seeAllHref={buildHref("/routes", {
            day: linkDay,
            ...viewQuery("off", { mode, school: includeSchool, lean: dir }),
          })}
        />
        <RankBoard
          title="Most reliable"
          accentClass="text-at-ontime"
          rows={boards.reliable.slice(0, BOARD_SIZE)}
          metric="onTime"
          routeQuery={routeLinkQuery("day", linkDay, null)}
          total={boards.reliable.length}
          seeAllHref={buildHref("/routes", {
            day: linkDay,
            ...viewQuery("reliable", { mode, school: includeSchool }),
          })}
        />
      </div>
    </main>
  );
}

/**
 * Streamed "of the day" cards: the worst run and the worst stop. Awaits the two
 * heavy day aggregations (and the streak, which needs the worst run's route)
 * off the critical path so the dashboard shell renders immediately.
 * @param root0 - Props.
 * @param root0.range - The resolved service-day window.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.includeSchool - Whether school services are included.
 * @param root0.linkDay - `?day=` value for past-day links, or undefined for today.
 * @returns The two-card grid.
 */
async function HomeShameCards({
  range,
  mode,
  includeSchool,
  linkDay,
}: {
  range: DateRange;
  mode: ModeFilterValue;
  includeSchool: boolean;
  linkDay: string | undefined;
}): Promise<JSX.Element> {
  const [shame, worstStops] = await Promise.all([
    getShameOfDay(range, { mode, includeSchool }, TODAY_REVALIDATE),
    getWorstStops(range, { mode, includeSchool }, 1, TODAY_REVALIDATE),
  ]);
  // Needs shame.worst.route_id, so runs after the parallel pair.
  const routeStreakDays = shame.worst
    ? await getShameRouteStreak(shame.worst.route_id, range, TODAY_REVALIDATE)
    : 0;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Both cards open what they name; the section heading owns the board link. */}
      <ShameOfDay trip={shame.worst} hours={shame.hours} routeStreakDays={routeStreakDays} />
      <WorstStopCard stop={worstStops[0] ?? null} day={linkDay} />
    </div>
  );
}
