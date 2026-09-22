// src/app/(home)/page.tsx
// Home page: the network dashboard for a day, week or month. The day view is
// rendered here; a week or month streams its three bands from one batch
// (PeriodOverview) behind their headings and filter chips. When
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
import {
  loadPeriodBatch,
  PeriodBoards,
  PeriodModeFilter,
  PeriodRouteCard,
  PeriodStopCard,
  PeriodTripCard,
  PeriodVerdict,
  type PeriodView,
} from "@/components/PeriodOverview";
import { RangeControls } from "@/components/RangeControls";
import { ON_TIME_CAPTION, ON_TIME_SHARE_CAPTION, RankBoard } from "@/components/RankBoard";
import { RankingsBodySkeleton } from "@/components/RankingsBodySkeleton";
import { RankingsHeader } from "@/components/RankingsHeader";
import { SchoolBusToggle } from "@/components/SchoolBusToggle";
import { SectionLink } from "@/components/SectionLink";
import { ShameOfDay } from "@/components/ShameOfDay";
import {
  FeatureCardRowSkeleton,
  FeatureCardSkeleton,
  KpiStripSkeleton,
  VehicleCardsSkeleton,
} from "@/components/SkeletonParts";
import { VehicleCards, vehicleModesShown, VehiclesHeading } from "@/components/VehiclesSection";
import { WorstRouteCard } from "@/components/WorstRouteCard";
import { WorstStopCard } from "@/components/WorstStopCard";
import { getServiceAlerts, networkWideAlerts } from "@/lib/at-alerts";
import {
  getCancelledByRoute,
  getCancelledCount,
  getEarliestDataDay,
  getLatestEventDate,
  getRankings,
  getShameOfDay,
  getShameRouteOfDay,
  getShameRouteStreak,
  getWorstStopsOfDay,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { DATA_START_DAY, DATA_START_LABEL } from "@/lib/data-start";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { cardMetadata, homeCardPath, homeCardTitle, parseHomeCard } from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { filterLiveHours, resolveRequestedDay, resolveShownDay } from "@/lib/page-nav";
import {
  dayRangeNav,
  overviewHeading,
  parseRangeWindow,
  periodRangeNav,
  routeLinkQuery,
  weekPeriodOf,
  windowPhrase,
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
import { buildShameHref, crownedRow } from "@/lib/shame-page";
import {
  monthRangeLabel,
  nzServiceDayString,
  serviceDatesInRange,
  serviceDayLabel,
  type DateRange,
} from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { Metadata } from "next";
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
 * The shared-link card for this view: its day or period and filters go into
 * the card URL, so a link to an archived day unfurls with that day, not today.
 * A bare day link is titled with the day the page opens on, which before today
 * has opened is the day before; that one cached lookup is the page's own, so
 * the metadata adds no query.
 * @param root0 - Page props.
 * @param root0.searchParams - The page's query params.
 * @returns The Open Graph and Twitter metadata.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  const card = parseHomeCard(sp);
  if (card.window === "day" && card.day === null) {
    const today = nzServiceDayString();
    const { serviceDate } = await resolveShownDay(null, today);
    if (serviceDate !== today) card.day = serviceDate;
  }
  return cardMetadata(
    homeCardTitle(card),
    "How on time Auckland's buses, trains and ferries ran, from AT's live feeds.",
    homeCardPath(sp),
  );
}

/**
 * Query params each home filter keeps when it links, so the filters compose:
 * every control carries the other two filters plus the page's own view params
 * (the day, or the window and period), and drops only the one it sets itself.
 * @param filters - The active filters.
 * @param filters.mode - Active mode, or null for every mode.
 * @param filters.includeSchool - Whether school services are included.
 * @param filters.dir - Delay-direction filter.
 * @param view - The view params every control keeps; undefined values are left out.
 * @returns One param set per control.
 */
function preservedFor(
  filters: { mode: ModeFilterValue; includeSchool: boolean; dir: DelayDirection },
  view: Record<string, string | undefined>,
): Record<"mode" | "school" | "dir", Record<string, string>> {
  const all: Record<string, string | undefined> = {
    ...view,
    mode: filters.mode ?? undefined,
    school: filters.includeSchool ? "1" : undefined,
    dir: filters.dir ?? undefined,
  };
  /**
   * The full set minus one control's own param and any unset value.
   * @param key - The param the control sets itself.
   * @returns The params that control keeps.
   */
  const without = (key: string): Record<string, string> =>
    Object.fromEntries(
      Object.entries(all).filter((e): e is [string, string] => e[0] !== key && e[1] !== undefined),
    );
  return { mode: without("mode"), school: without("school"), dir: without("dir") };
}

/**
 * Name a week or month for the vehicles card: the month's name, or a week's
 * first and last day.
 * @param window - "week" or "month".
 * @param range - The window's range.
 * @returns The label.
 */
function periodLabel(window: "week" | "month", range: DateRange): string {
  if (window === "month") return monthRangeLabel(range);
  const days = serviceDatesInRange(range);
  const first = days[0];
  const last = days.at(-1);
  return first && last ? `${serviceDayLabel(first)} to ${serviceDayLabel(last)}` : "This week";
}

/**
 * The vehicles band's fallback, sized to the modes the cards will show.
 * @param root0 - Props.
 * @param root0.mode - Mode filter, or null for every mode.
 * @returns The skeleton.
 */
function VehicleCardsFallback({ mode }: { mode: ModeFilterValue }): JSX.Element {
  const modes = vehicleModesShown(mode);
  return <VehicleCardsSkeleton modes={modes.length} trainNote={modes.includes("TRAIN")} />;
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
  const view: PeriodView = {
    window,
    mode,
    dir,
    includeSchool,
    period: period ?? undefined,
    range,
    anchor,
  };
  // Started here and not awaited: each band's data part awaits the one promise,
  // so the headings and chips between them never wait on the batch.
  const batch = loadPeriodBatch(view);
  const {
    mode: modePreserved,
    school: schoolPreserved,
    dir: dirPreserved,
  } = preservedFor({ mode, includeSchool, dir }, { window, period: view.period });
  // The shame boards take the same window and filters, so their links carry both.
  const shameNav = { window, period: view.period };
  const shameFilter = { mode, includeSchool };

  // The same three bands as the day view; see its render for the layout rule.
  return (
    <main className="space-y-10">
      <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-ultra tracking-zero text-at-ink sm:text-3xl">
            {overviewHeading(nav, period)}
          </h1>
          <RangeControls basePath="/" nav={nav} />
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Suspense
            fallback={<ModeFilter active={mode} basePath="/" preservedParams={modePreserved} />}
          >
            <PeriodModeFilter batch={batch} active={mode} preservedParams={modePreserved} />
          </Suspense>
          <SchoolBusToggle active={includeSchool} basePath="/" preservedParams={schoolPreserved} />
          <Link
            href={buildHref("/days", {
              window,
              period: view.period,
              mode: mode ?? undefined,
              school: includeSchool ? "1" : undefined,
            })}
            className="ml-auto text-sm font-semibold text-at-shore hover:underline"
          >
            Day by day
          </Link>
        </div>

        <Suspense fallback={<KpiStripSkeleton verdict />}>
          <PeriodVerdict batch={batch} />
        </Suspense>
      </section>

      <section className="space-y-4">
        <SectionLink
          title={`Shame of the ${window}`}
          href={buildShameHref("/shame/trip", shameNav, shameFilter)}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Suspense fallback={<FeatureCardSkeleton withHeadsign narrow />}>
            <PeriodTripCard batch={batch} when={windowPhrase(nav, period)} />
          </Suspense>
          <Suspense fallback={<FeatureCardSkeleton />}>
            <PeriodRouteCard batch={batch} when={windowPhrase(nav, period)} />
          </Suspense>
          <Suspense fallback={<FeatureCardSkeleton />}>
            <PeriodStopCard batch={batch} when={windowPhrase(nav, period)} />
          </Suspense>
        </div>
      </section>

      <section className="space-y-4">
        <RankingsHeader>
          <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
        </RankingsHeader>
        <Suspense fallback={<RankingsBodySkeleton />}>
          <PeriodBoards batch={batch} view={view} />
        </Suspense>
      </section>

      <section className="space-y-4">
        <VehiclesHeading
          href={buildHref("/vehicles", {
            window,
            period: view.period,
            mode: mode ?? undefined,
            school: includeSchool ? "1" : undefined,
          })}
        />
        <Suspense fallback={<VehicleCardsFallback mode={mode} />}>
          <VehicleCards
            range={range}
            label={periodLabel(window, range)}
            mode={mode}
            includeSchool={includeSchool}
          />
        </Suspense>
      </section>
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

  // Service day from ?day, or the one every day page opens on (the current day
  // once it has opened, else the day before).
  const requestedDay = resolveRequestedDay(sp.day);
  const shown = await resolveShownDay(requestedDay);
  const { range, serviceDate } = shown;
  const rows = await getRankings(range, THRESHOLD_SEC, TODAY_REVALIDATE);
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

  const {
    mode: modePreserved,
    school: schoolPreserved,
    dir: dirPreserved,
  } = preservedFor({ mode, includeSchool, dir }, { day: requestedDay ?? undefined });

  const nav = dayRangeNav(shown, earliestDay);

  // Three bands: the day's verdict, its shame, and the route rankings. Mode and
  // school sit in the first band because they filter all three; the direction
  // chips sit on the rankings heading because they filter only the off-schedule
  // board.
  return (
    <main className="space-y-10">
      <section className="space-y-4">
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

        <div className="flex flex-wrap items-center gap-3">
          <ModeFilter
            active={mode}
            basePath="/"
            preservedParams={modePreserved}
            availableModes={availableModes}
          />
          <SchoolBusToggle active={includeSchool} basePath="/" preservedParams={schoolPreserved} />
        </div>

        <FleetSummary data={heroData} verdict />
      </section>

      <section className="space-y-4">
        <SectionLink
          title="Shame of the day"
          href={buildShameHref("/shame/trip", { day: linkDay }, { mode, includeSchool })}
        />
        <Suspense fallback={<FeatureCardRowSkeleton />}>
          <HomeShameCards
            range={range}
            serviceDate={serviceDate}
            mode={mode}
            includeSchool={includeSchool}
            linkDay={linkDay}
            when={windowPhrase(nav, null)}
          />
        </Suspense>
      </section>

      <section className="space-y-4">
        <RankingsHeader>
          <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
        </RankingsHeader>

        {mode && visible.every((r) => r.events < boardMin) && (
          <p className="text-sm text-at-muted">
            Not enough {mode.charAt(0) + mode.slice(1).toLowerCase()} data for this day - try the{" "}
            <Link
              href={buildHref("/", {
                window: "week",
                // The week this day sits in, not the running one.
                period: weekPeriodOf(serviceDate),
                mode,
                school: includeSchool ? "1" : undefined,
                dir,
              })}
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
            caption={ON_TIME_CAPTION}
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
            caption={ON_TIME_SHARE_CAPTION}
            routeQuery={routeLinkQuery("day", linkDay, null)}
            total={boards.reliable.length}
            seeAllHref={buildHref("/routes", {
              day: linkDay,
              ...viewQuery("reliable", { mode, school: includeSchool }),
            })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <VehiclesHeading
          href={buildHref("/vehicles", {
            day: linkDay,
            mode: mode ?? undefined,
            school: includeSchool ? "1" : undefined,
          })}
        />
        <Suspense fallback={<VehicleCardsFallback mode={mode} />}>
          <VehicleCards
            range={range}
            label={linkDay ? serviceDayLabel(serviceDate) : "Today"}
            mode={mode}
            includeSchool={includeSchool}
          />
        </Suspense>
      </section>
    </main>
  );
}

/**
 * Streamed "of the day" cards: the worst run, route and stop. Each runs its own
 * board's day query and crowns it the way that board does ({@link crownedRow}
 * over the hours the board shows), so a card never names something the board it
 * sits above would not crown. The three aggregations (and the streak, which
 * needs the crowned run's route) are awaited off the critical path, so the
 * dashboard shell renders immediately.
 * @param root0 - Props.
 * @param root0.range - The resolved service-day window.
 * @param root0.serviceDate - The shown service date, for dropping hours still under way.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.includeSchool - Whether school services are included.
 * @param root0.linkDay - `?day=` value for past-day links, or undefined for today.
 * @param root0.when - The shown day as words ("today" or "that day").
 * @returns The three-card grid.
 */
async function HomeShameCards({
  range,
  serviceDate,
  mode,
  includeSchool,
  linkDay,
  when,
}: {
  range: DateRange;
  serviceDate: string;
  mode: ModeFilterValue;
  includeSchool: boolean;
  linkDay: string | undefined;
  when: string;
}): Promise<JSX.Element> {
  const filter = { mode, includeSchool };
  const [shameTrips, shameRoutes, shameStops] = await Promise.all([
    getShameOfDay(range, filter, TODAY_REVALIDATE),
    getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    getWorstStopsOfDay(range, filter, TODAY_REVALIDATE),
  ]);
  const tripHours = filterLiveHours(shameTrips.hours, serviceDate);
  const trip = crownedRow(tripHours);
  const route = crownedRow(filterLiveHours(shameRoutes.hours, serviceDate));
  const stop = crownedRow(filterLiveHours(shameStops.hours, serviceDate));
  // Needs the crowned run's route_id, so it runs after the parallel three.
  const routeStreakDays = trip.row
    ? await getShameRouteStreak(trip.row.route_id, range, TODAY_REVALIDATE)
    : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Each card opens what it names; the boards are a heading or a nav tab away. */}
      <ShameOfDay
        trip={trip.row}
        ranked={trip.ranked}
        hours={tripHours}
        routeStreakDays={routeStreakDays}
        when={when}
      />
      <WorstRouteCard route={route.row} ranked={route.ranked} when={when} day={linkDay} />
      <WorstStopCard stop={stop.row} ranked={stop.ranked} when={when} day={linkDay} />
    </div>
  );
}
