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

import { AlertBanner, ALERTS_HREF, AlertsLine } from "@/components/AlertBanner";
import { RangeControls } from "@/components/date/RangeControls";
import { DelayFilter } from "@/components/filter/DelayFilter";
import { ModeFilter } from "@/components/filter/ModeFilter";
import { ModeUsageFilter } from "@/components/filter/ModeUsageFilter";
import { SchoolBusToggle } from "@/components/filter/SchoolBusToggle";
import { LoadingBlock } from "@/components/Loading";
import { FleetSummary } from "@/components/ranking/FleetSummary";
import {
  loadPeriodBatch,
  PeriodBoards,
  PeriodRouteCard,
  PeriodStopCard,
  PeriodTripCard,
  PeriodVerdict,
  type PeriodView,
} from "@/components/ranking/PeriodOverview";
import { RankBoard } from "@/components/ranking/RankBoard";
import { RankingFilterMenus } from "@/components/ranking/RankingFilterMenus";
import { RankingFiltersNote } from "@/components/ranking/RankingFiltersNote";
import { WorstRouteCard } from "@/components/ranking/WorstRouteCard";
import { WorstStopCard } from "@/components/ranking/WorstStopCard";
import { SectionLink } from "@/components/SectionLink";
import { ShameOfDay } from "@/components/shame/ShameOfDay";
import { PageHeader } from "@/components/ui/PageHeader";
import { VehicleCards, VehiclesHeading } from "@/components/VehiclesSection";
import { ON_TIME_CAPTION, ON_TIME_SHARE_CAPTION, SITE_DESCRIPTION } from "@/lib/copy";
import {
  getCancelledByRoute,
  getCancelledCount,
  getEarliestDataDay,
  getFilteredCancellations,
  getFilteredRankings,
  getLatestEventDate,
  getRouteBoardInHours,
  getRouteBoardOfDay,
  getShameStreaks,
  getStopBoardInHours,
  getStopBoardOfDay,
  getTripBoardInHours,
  getTripBoardOfDay,
  TODAY_REVALIDATE,
} from "@/lib/data";
import {
  alertsForMode,
  getServiceAlerts,
  getUpcomingAlerts,
  hasSevereAlert,
  networkWideAlerts,
  type ServiceAlert,
} from "@/lib/feed/at-alerts";
import { modeWord, parseMode, type Mode } from "@/lib/mode";
import { homeCardPath, homeCardTitle, pageMetadata, parseHomeCard } from "@/lib/og";
import { preservedFilters } from "@/lib/page/filter-params";
import { filterLiveHours, resolveRequestedDay, resolveShownDay } from "@/lib/page/nav";
import type { PeriodWindow } from "@/lib/page/range";
import {
  dayRangeNav,
  overviewHeading,
  parseRangeWindow,
  periodRangeNav,
  routeLinkParams,
  weekPeriodOf,
  windowPhrase,
} from "@/lib/page/range";
import { parseRankingsParams } from "@/lib/page/rankings";
import { buildShameHref, crownedRow, crownedTop } from "@/lib/page/shame";
import {
  hasRankingFilters,
  parseRankingFilters,
  rankingFilterParams,
  routeParamsWithHours,
} from "@/lib/ranking-filters";
import {
  deriveBoards,
  deriveOffSchedule,
  MIN_BOARD_EVENTS,
  MIN_MODE_EVENTS,
  parseDelayDirection,
  summariseRows,
} from "@/lib/rankings";
import { viewQuery } from "@/lib/route/explorer";
import {
  parseSchoolFilter,
  rowAllowedBySchool,
  schoolDelta,
  schoolFilterParam,
  type SchoolFilter,
} from "@/lib/school-bus";
import { DATA_START_DAY, DATA_START_LABEL } from "@/lib/time/data-start";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestNow, requestServiceDay } from "@/lib/time/request-now";
import {
  monthRangeLabel,
  nzLocalHour,
  serviceDayLabel,
  weekLabel,
  type DateRange,
} from "@/lib/time/service-day";
import { hourRangeClock, type HourRange } from "@/lib/time/time-of-day";
import { buildHref, stripUnset } from "@/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

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
  hours?: string;
  daytype?: string;
  area?: string;
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
    const today = await requestServiceDay();
    const { serviceDate } = await resolveShownDay(null, today);
    if (serviceDate !== today) card.day = serviceDate;
  }
  return pageMetadata({
    description: SITE_DESCRIPTION,
    card: { title: homeCardTitle(card), path: homeCardPath(sp) },
  });
}

/**
 * Name a week or month for the vehicles card: the month's name, or a week's
 * first and last day.
 * @param window - "week" or "month".
 * @param range - The window's range.
 * @returns The label.
 */
function periodLabel(window: PeriodWindow, range: DateRange): string {
  return window === "month" ? monthRangeLabel(range) : weekLabel(range);
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
  window: PeriodWindow;
  sp: HomeSearchParams;
}): Promise<JSX.Element> {
  const { mode, dir, schools } = parseRankingsParams(sp);
  // Anchor every window to the latest day with data so a quiet "today" still
  // shows a populated period. Today itself is one request-time clock read for
  // the whole render (see lib/time/request-now.ts).
  const [today, latest, earliest] = await Promise.all([
    requestServiceDay(),
    getLatestEventDate(),
    getEarliestDataDay(1),
  ]);
  const anchor = latest ?? new Date();
  const { range, period, nav } = periodRangeNav("/", window, sp.period, anchor, earliest, today);
  const filters = parseRankingFilters(sp, false);
  const view: PeriodView = {
    window,
    mode,
    dir,
    schools,
    period: period ?? undefined,
    range,
    anchor,
    filters,
  };
  // Started here and not awaited: each band's data part awaits the one promise,
  // so the headings and chips between them never wait on the batch.
  const batch = loadPeriodBatch(view);
  const {
    mode: modePreserved,
    school: schoolPreserved,
    dir: dirPreserved,
  } = preservedFilters(
    { mode, schools, dir },
    { window, period: view.period, ...rankingFilterParams(filters) },
  );
  // Everything but the narrowing params, which the filter boxes set themselves.
  const filterPreserved = stripUnset({
    window,
    period: view.period,
    mode: mode ?? undefined,
    school: schoolFilterParam(schools),
    dir: dir ?? undefined,
  });
  // The shame boards take the same window and filters, so their links carry both.
  const shameNav = { window, period: view.period };
  // No direction: the home page's `dir` narrows its own route boards, and the
  // link goes to the trips board, which ranks whole runs and reads none.
  const shameFilter = { mode, schools, direction: null };

  // The same three bands as the day view; see its render for the layout rule.
  return (
    <main className="space-y-6">
      <section className="space-y-5">
        <PageHeader size="hero" title={overviewHeading(nav, period)} />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-at-border py-3">
          <RangeControls basePath="/" nav={nav} />
          <div className="flex flex-wrap items-center gap-3">
            <ModeUsageFilter
              active={mode}
              basePath="/"
              preservedParams={modePreserved}
              modes={batch.core.then((c) => c.availableModes)}
            />
            <SchoolBusToggle value={schools} basePath="/" preservedParams={schoolPreserved} />
            <RankingFilterMenus
              basePath="/"
              preservedParams={filterPreserved}
              hours={filters.hours}
              days={filters.days}
              areas={filters.areas}
              showDays
              nowHour={null}
            />
          </div>
          <Link
            href={buildHref("/days", {
              window,
              period: view.period,
              mode: mode ?? undefined,
              school: schoolFilterParam(schools),
            })}
            className="at-link ml-auto text-sm font-semibold"
          >
            Day by day
          </Link>
        </div>

        <Suspense fallback={<LoadingBlock label="Loading the verdict" />}>
          <PeriodVerdict batch={batch} />
        </Suspense>
        <RankingFiltersNote filters={filters} window={window} live={false} />
      </section>

      <section className="space-y-4">
        <SectionLink
          title={`Worst of the ${window}`}
          href={buildShameHref("/shame/trip", shameNav, shameFilter)}
        />
        {/* One boundary for the three cards, not one each: they all read the same
            batch promise, so they arrive together and three wheels in a row would
            only be three ways of saying the same thing. */}
        <Suspense fallback={<LoadingBlock label="Loading the worst of the period" />}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PeriodTripCard batch={batch} when={windowPhrase(nav, period)} />
            <PeriodRouteCard batch={batch} when={windowPhrase(nav, period)} />
            <PeriodStopCard batch={batch} when={windowPhrase(nav, period)} />
          </div>
        </Suspense>
      </section>

      <section className="space-y-4">
        <SectionLink
          title="Route rankings"
          href={buildHref("/routes", {
            window,
            period: view.period,
            ...viewQuery("all", { mode, school: schools, areas: filters.areas }),
          })}
        >
          <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
        </SectionLink>
        <Suspense fallback={<LoadingBlock label="Loading the route rankings" />}>
          <PeriodBoards batch={batch} view={view} />
        </Suspense>
      </section>

      <section className="space-y-4">
        <VehiclesHeading
          href={buildHref("/vehicles", {
            window,
            period: view.period,
            mode: mode ?? undefined,
            school: schoolFilterParam(schools),
          })}
        />
        <Suspense fallback={<LoadingBlock label="Loading the vehicle counts" />}>
          <VehicleCards
            range={range}
            label={periodLabel(window, range)}
            mode={mode}
            schools={schools}
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
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  clampDayParam("/", sp, today);
  dropTodayParam("/", sp, today);
  const mode = parseMode(sp.mode);
  const dir = parseDelayDirection(sp.dir);

  // Service day from ?day, or the one every day page opens on (the current day
  // once it has opened, else the day before).
  const requestedDay = resolveRequestedDay(sp.day);
  const shown = await resolveShownDay(requestedDay, today);
  const { range, serviceDate } = shown;
  // Time of day and area narrow the rankings and the KPI strip; a day is
  // already one kind of day, so the day type is a week and month filter only.
  const filters = parseRankingFilters(sp, true);
  const rows = await getFilteredRankings(range, filters, TODAY_REVALIDATE);
  // Filters narrow the route lists. School services (S###) are left out unless
  // ?school=1 adds them or ?school=only keeps them alone.
  const schools = parseSchoolFilter(sp.school);
  // Kick the alerts fetch off early so it overlaps the queries below. Today's
  // alerts line streams it; a past day's banner awaits it at render.
  // Its 5-minute cache means only the first request in a window pays AT's
  // latency. Null when AT's feed did not answer.
  const alertsPromise = getServiceAlerts().catch((): null => null);
  const earliestDay = await getEarliestDataDay(1);
  // Only pin ?day on route links for a past day; today's links stay clean so they
  // don't bounce through dropTodayParam's redirect (a 307 on every click).
  const linkDay = dayLinkParam(serviceDate, today);
  const modeFiltered = mode ? rows.filter((r) => r.mode === mode) : rows;
  const visible = modeFiltered.filter((r) => rowAllowedBySchool(r, schools));
  // The KPI strip reflects exactly the visible rows, so the mode filter and the
  // school-bus toggle both flow through to the totals (no separate fleet query).
  // Cancellations are the exception: they produce no arrival row, so they need
  // their own count under the same filters.
  const [cancelledTotal, cancelledByRoute, cancelledWithoutSchool] = hasRankingFilters(filters)
    ? await getFilteredCancellations(range, filters, { mode, schools }).then(
        (c) => [c.total, c.byRoute, schools === "include" ? c.withoutSchool : null] as const,
      )
    : await Promise.all([
        getCancelledCount(range, { mode, schools }, TODAY_REVALIDATE),
        getCancelledByRoute(range, { mode, schools }, TODAY_REVALIDATE),
        // The count school services leave out, for the "+N" beside each figure.
        schools === "include"
          ? getCancelledCount(range, { mode, schools: "exclude" }, TODAY_REVALIDATE)
          : null,
      ]);
  const heroData = { ...summariseRows(visible), cancelled: cancelledTotal };
  // "+N" only when school services sit beside the rest; alone they add to nothing.
  const schoolAdded =
    schools === "include" ? schoolDelta(visible, cancelledTotal, cancelledWithoutSchool) : null;
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
  } = preservedFilters(
    { mode, schools, dir },
    { day: requestedDay ?? undefined, ...rankingFilterParams(filters) },
  );
  // Everything but the narrowing params, which the filter boxes set themselves.
  const filterPreserved = stripUnset({
    day: requestedDay ?? undefined,
    mode: mode ?? undefined,
    school: schoolFilterParam(schools),
    dir: dir ?? undefined,
  });
  const routeParams = routeParamsWithHours(routeLinkParams("day", linkDay, null), filters.hours);
  // The hour under way today, so the time box can grey the hours still to come.
  const nowHour = linkDay === undefined ? nzLocalHour(await requestNow()) : null;

  const nav = dayRangeNav(shown, earliestDay, today);

  // Three bands: the day's verdict, its shame, and the route rankings. Mode and
  // school sit in the first band because they filter all three; the direction
  // chips sit on the rankings heading because they filter only the off-schedule
  // board.
  return (
    <main className="space-y-6">
      <section className="space-y-5">
        <PageHeader size="hero" title={overviewHeading(nav, null)} />

        {/* Every control the page has, on one rule-bounded row. Stacked - window
            tabs, then the day stepper, then the mode chips, then the school
            toggle - they filled a phone screen before a single figure. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-at-border py-3">
          <RangeControls basePath="/" nav={nav} />
          <div className="flex flex-wrap items-center gap-3">
            <ModeFilter
              active={mode}
              basePath="/"
              preservedParams={modePreserved}
              availableModes={availableModes}
            />
            <SchoolBusToggle value={schools} basePath="/" preservedParams={schoolPreserved} />
            <RankingFilterMenus
              basePath="/"
              preservedParams={filterPreserved}
              hours={filters.hours}
              days={null}
              areas={filters.areas}
              showDays={false}
              nowHour={nowHour}
            />
          </div>
        </div>

        {serviceDate === DATA_START_DAY && (
          <p className="text-sm text-at-muted">
            This is the first day on record. Nothing before {DATA_START_LABEL} was captured.
          </p>
        )}

        {/* Today links to the Alerts page in one line. A past day keeps the
            network-wide banner, labelled as running now: AT publishes no past
            alerts, so a count of today's would read as that day's. */}
        {linkDay === undefined ? (
          <Suspense fallback={null}>
            <HomeAlertsLine alertsPromise={alertsPromise} mode={mode} />
          </Suspense>
        ) : (
          <AlertBanner alerts={networkWideAlerts((await alertsPromise) ?? [])} pastWindow />
        )}

        <FleetSummary data={heroData} verdict schoolAdded={schoolAdded} />
        <RankingFiltersNote filters={filters} window="day" live={linkDay === undefined} />
      </section>

      <section className="space-y-4">
        {/* The boards rank a part of the day as the cards below do, so the link
            opens the list whose top row each card names. */}
        <SectionLink
          title="Worst of the day"
          href={buildShameHref(
            "/shame/trip",
            { day: linkDay, hours: filters.hours },
            { mode, schools, direction: null },
          )}
        />
        <Suspense fallback={<LoadingBlock label="Loading the worst of the day" />}>
          <HomeShameCards
            range={range}
            serviceDate={serviceDate}
            mode={mode}
            schools={schools}
            linkDay={linkDay}
            when={windowPhrase(nav, null)}
            hours={filters.hours}
          />
        </Suspense>
      </section>

      <section className="space-y-4">
        <SectionLink
          title="Route rankings"
          href={buildHref("/routes", {
            day: linkDay,
            ...viewQuery("all", { mode, school: schools, areas: filters.areas }),
          })}
        >
          <DelayFilter active={dir} basePath="/" preservedParams={dirPreserved} />
        </SectionLink>

        {mode && visible.every((r) => r.events < boardMin) && (
          <p className="text-sm text-at-muted">
            Not enough {modeWord(mode)} data for this day. Try the{" "}
            <Link
              href={buildHref("/", {
                window: "week",
                // The week this day sits in, not the running one.
                period: weekPeriodOf(serviceDate),
                mode,
                school: schoolFilterParam(schools),
                dir,
              })}
              className="at-link"
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
            routeParams={routeParams}
            total={offSchedule.length}
            minEvents={boardMin}
            seeAllHref={buildHref("/routes", {
              day: linkDay,
              ...viewQuery("off", { mode, school: schools, direction: dir, areas: filters.areas }),
            })}
          />
          <RankBoard
            title="Most reliable"
            accentClass="text-at-ontime"
            rows={boards.reliable.slice(0, BOARD_SIZE)}
            metric="onTime"
            caption={ON_TIME_SHARE_CAPTION}
            routeParams={routeParams}
            total={boards.reliable.length}
            minEvents={boardMin}
            seeAllHref={buildHref("/routes", {
              day: linkDay,
              ...viewQuery("reliable", { mode, school: schools, areas: filters.areas }),
            })}
          />
        </div>
      </section>

      <section className="space-y-4">
        <VehiclesHeading
          href={buildHref("/vehicles", {
            day: linkDay,
            mode: mode ?? undefined,
            school: schoolFilterParam(schools),
          })}
        />
        <Suspense fallback={<LoadingBlock label="Loading the vehicle counts" />}>
          <VehicleCards
            range={range}
            label={linkDay ? serviceDayLabel(serviceDate) : "Today"}
            mode={mode}
            schools={schools}
            hours={filters.hours}
            live={linkDay === undefined}
          />
        </Suspense>
      </section>
    </main>
  );
}

/**
 * Today's one-line link to the Alerts page ({@link AlertsLine}), counting the
 * alerts running now and coming up under the page's mode filter. Renders
 * nothing when AT's feed did not answer: the Alerts tab says so itself.
 * @param root0 - Props.
 * @param root0.alertsPromise - The alerts running now, or null when AT's feed did not answer.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @returns The line, or null.
 */
async function HomeAlertsLine({
  alertsPromise,
  mode,
}: {
  alertsPromise: Promise<ServiceAlert[] | null>;
  mode: Mode | null;
}): Promise<JSX.Element | null> {
  const [running, upcoming] = await Promise.all([
    alertsPromise,
    getUpcomingAlerts().catch((): ServiceAlert[] => []),
  ]);
  if (!running) return null;
  const now = alertsForMode(running, mode);
  return (
    <AlertsLine
      href={buildHref(ALERTS_HREF, { mode: mode ?? undefined })}
      running={now.length}
      upcoming={alertsForMode(upcoming, mode).length}
      severe={hasSevereAlert(now)}
    />
  );
}

/**
 * Streamed "of the day" cards: the worst run, route and stop. Each runs its own
 * board's day query and crowns it the way that board does ({@link crownedRow}
 * over the hours the board shows), so a card never names something the board it
 * sits above would not crown. With a part of the day set, each reads instead the
 * ranked list its board shows for those hours and crowns that list's top row
 * ({@link crownedTop}); the day's hour-by-hour counts and the streak describe
 * the whole day, so they are left off. The aggregations are awaited off the
 * critical path, so the dashboard shell renders immediately.
 * @param root0 - Props.
 * @param root0.range - The resolved service-day window.
 * @param root0.serviceDate - The shown service date, for dropping hours still under way.
 * @param root0.mode - Active mode filter, or null for every mode.
 * @param root0.schools - Which school services count (default leave them out).
 * @param root0.linkDay - `?day=` value for past-day links, or undefined for today.
 * @param root0.when - The shown day as words ("today" or "that day").
 * @param root0.hours - The part of the day the page is narrowed to, or null for all of it.
 * @returns The three-card grid.
 */
async function HomeShameCards({
  range,
  serviceDate,
  mode,
  schools,
  linkDay,
  when,
  hours,
}: {
  range: DateRange;
  serviceDate: string;
  mode: Mode | null;
  schools: SchoolFilter;
  linkDay: string | undefined;
  when: string;
  hours: HourRange | null;
}): Promise<JSX.Element> {
  const filter = { mode, schools };
  if (hours) {
    const live = linkDay === undefined;
    const [trips, routes, stops] = await Promise.all([
      getTripBoardInHours(range, filter, hours, TODAY_REVALIDATE),
      getRouteBoardInHours(range, filter, hours, TODAY_REVALIDATE),
      getStopBoardInHours(range, filter, hours, TODAY_REVALIDATE),
    ]);
    const trip = crownedTop(trips.rows);
    const route = crownedTop(routes.rows);
    const stop = crownedTop(stops.rows);
    // "No shame from 7am to 10am today".
    const span = `from ${hourRangeClock(hours, live)} ${when}`;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ShameOfDay trip={trip.row} ranked={trip.ranked} when={span} />
        <WorstRouteCard
          route={route.row}
          ranked={route.ranked}
          when={span}
          day={linkDay}
          hours={hours}
          live={live}
        />
        <WorstStopCard
          stop={stop.row}
          ranked={stop.ranked}
          when={span}
          day={linkDay}
          hours={hours}
          live={live}
        />
      </div>
    );
  }
  const [shameTrips, shameRoutes, shameStops] = await Promise.all([
    getTripBoardOfDay(range, filter, TODAY_REVALIDATE),
    getRouteBoardOfDay(range, filter, TODAY_REVALIDATE),
    getStopBoardOfDay(range, filter, TODAY_REVALIDATE),
  ]);
  const tripHours = filterLiveHours(shameTrips.hours, serviceDate);
  const trip = crownedRow(tripHours);
  const route = crownedRow(filterLiveHours(shameRoutes.hours, serviceDate));
  const stop = crownedRow(filterLiveHours(shameStops.hours, serviceDate));
  // Needs the crowned trip's route, so it runs after the parallel three. The
  // card's trip holds the day's crown, so that day starts the run.
  const crownedDays = trip.row
    ? 1 +
      ((await getShameStreaks("trip", [trip.row.routeId], range, filter)).get(trip.row.routeId)
        ?.prevCrownedDays ?? 0)
    : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Each card opens what it names; the boards are a heading or a nav tab away. */}
      <ShameOfDay
        trip={trip.row}
        ranked={trip.ranked}
        hours={tripHours}
        crownedDays={crownedDays}
        when={when}
      />
      <WorstRouteCard route={route.row} ranked={route.ranked} when={when} day={linkDay} />
      <WorstStopCard stop={stop.row} ranked={stop.ranked} when={when} day={linkDay} />
    </div>
  );
}
