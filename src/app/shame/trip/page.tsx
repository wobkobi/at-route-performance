// src/app/shame/trip/page.tsx
// Shame-of-the-day page listing the most off-schedule run per hour (day view) or per day (week view).

import { LoadingBlock } from "@/components/Loading";
import { ModeIcon } from "@/components/ModeIcon";
import { FlameCount } from "@/components/shame/FlameCount";
import {
  ShameBoard,
  ShameDayLabel,
  ShameEmptyHourRow,
  ShameHourLabel,
  ShameRankLabel,
  ShameSplitRow,
  ShameSubjectLink,
  type ShameRowContext,
} from "@/components/shame/ShameBoard";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameRowDelay } from "@/components/shame/ShameRowDelay";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getShameDayHours,
  getShameOfDay,
  getShameOfWeek,
  getShameRouteStreaksBatch,
  getShameTripsInHours,
  SHAME_MIN_STOPS,
  SHAME_RANKED_LIMIT,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { getFilterUsage } from "@/lib/data/filter-usage";
import { formatCount, plural } from "@/lib/format";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import { tripHref } from "@/lib/page/hrefs";
import {
  fillServiceHours,
  filterLiveHours,
  noHourStarted,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
  type HourSlot,
} from "@/lib/page/nav";
import type { PeriodWindow } from "@/lib/page/range";
import { dayRangeNav, periodInPhrase, periodRangeNav, windowPhrase } from "@/lib/page/range";
import {
  buildShameHref,
  countById,
  hoursNoun,
  isCrownable,
  notStartedMessage,
  parseShameParams,
  pickWorst,
  shameDayListHref,
  shameHourHref,
  shameHoursLabel,
  shameHoursParam,
  WEEK_REVALIDATE,
  type ShameFilter,
  type ShameSearchParams,
} from "@/lib/page/shame";
import { routeDisplayName } from "@/lib/route/slug";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { nzClockTime } from "@/lib/time/format";
import { requestServiceDay } from "@/lib/time/request-now";
import { nzHourLabel, serviceDayLabel, type DateRange } from "@/lib/time/service-day";
import { hoursInRange, type HourRange } from "@/lib/time/time-of-day";
import { boundFor } from "@/lib/trip/departure-label";
import type { ShameTrip } from "@/types/dashboard";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

/**
 * Title and shared-link card, built from the query alone so the metadata
 * never waits on the database.
 * @param root0 - Page props.
 * @param root0.searchParams - The page's query params.
 * @returns The page metadata.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  const card = parseShameCard("trip", sp);
  const { hours } = parseShameParams(sp);
  const title = hours
    ? `Worst ${SHAME_RANKED_LIMIT} trips · ${shameHoursLabel(hours)}`
    : listCardTitle(card);
  const description =
    "The most off-schedule run of each hour or day on Auckland's buses, trains and ferries.";
  return { title, description, ...cardMetadata(title, description, cardPath(card)) };
}

const BASE = "/shame/trip";

/**
 * Trip-page href for a shamed run, scoped to the run's own instant so the
 * timeline resolves to that day's run.
 * @param t - The shamed run.
 * @returns The trip-page URL.
 */
function shamedTripHref(t: ShameTrip): string {
  return tripHref(t.routeId, t.trip_id, t.scheduled_start);
}

/**
 * Week/month board body: runs the per-day worst-run fan-out and renders one row
 * per service day. Streams in behind the header so the shell never waits on a
 * cold period.
 * @param root0 - Props.
 * @param root0.range - The active window.
 * @param root0.filter - Active mode/school filter.
 * @param root0.periodNoun - Copy noun for the period ("week" / "month").
 * @param root0.periodWhen - The period as the words that follow "in" ("the last 7 days").
 * @returns The populated board.
 */
async function TripRangeBoard({
  range,
  filter,
  periodNoun,
  periodWhen,
}: {
  range: DateRange;
  filter: ShameFilter;
  periodNoun: PeriodWindow;
  periodWhen: string;
}): Promise<JSX.Element> {
  const shame = await getShameOfWeek(range, filter, WEEK_REVALIDATE);
  const worstKey = shame.worst?.date ?? null;
  const routeDayCounts = countById(shame.days, (d) => d.routeId);

  /**
   * Render one range-view day row.
   * @param t - The day's worst run.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderWeekRow = (t: ShameTrip, ctx: ShameRowContext): JSX.Element => {
    const isWorst = t.date === worstKey;
    const name = routeDisplayName(t);
    const dayCount = routeDayCounts.get(t.routeId) ?? 0;
    return (
      <ShameSplitRow
        ctx={ctx}
        className={cn(isWorst && "bg-at-late/5")}
        label={
          t.date ? (
            <ShameDayLabel
              date={t.date}
              href={shameDayListHref(BASE, dayLinkParam(t.date), filter)}
              linkLabel={`Worst ${SHAME_RANKED_LIMIT} runs on ${serviceDayLabel(t.date)}`}
            />
          ) : (
            <span className="w-16 shrink-0" />
          )
        }
      >
        <ModeIcon
          mode={t.mode}
          shortName={t.shortName}
          longName={t.longName}
          colour={t.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ShameSubjectLink href={shamedTripHref(t)}>{name}</ShameSubjectLink>
            {isWorst && <ShameWorstBadge />}
            {dayCount > 1 && (
              <FlameCount
                tier="week"
                count={dayCount}
                worst={isWorst}
                label={`${name} appeared as the worst trip on ${dayCount} days in ${periodWhen}`}
              />
            )}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">
            {boundFor(t.headsign, t.mode)?.concat(" · ") ?? ""}
            <span className="whitespace-nowrap">{nzClockTime(t.scheduled_start)}</span> ·{" "}
            <span className="whitespace-nowrap">{plural(t.stops, "stop")}</span>
          </span>
        </span>
        <ShameRowDelay
          avgDelaySec={t.avg_delay_sec}
          avgAbsDelaySec={t.avg_abs_delay_sec}
          mode={t.mode}
        />
      </ShameSplitRow>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={shame.days}
      keyOf={(t, i) => t.date ?? String(i)}
      emptyMessage={`No runs recorded for this ${periodNoun}.`}
      renderRow={renderWeekRow}
    />
  );
}

/**
 * Day board body: the day's hourly rows, awaited behind the header's Suspense
 * boundary so the window controls and filters are on screen while the run
 * queries run.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode/school filter.
 * @param root0.dayWhen - The day as the row copy names it ("today" / "that day").
 * @param root0.linkDay - The shown day's param for links, or undefined for today.
 * @returns The board.
 */
async function TripDayBoard({
  range,
  serviceDate,
  filter,
  dayWhen,
  linkDay,
}: {
  range: DateRange;
  serviceDate: string;
  filter: ShameFilter;
  dayWhen: string;
  linkDay: string | undefined;
}): Promise<JSX.Element> {
  const [shame, dayHours] = await Promise.all([
    getShameOfDay(range, filter, TODAY_REVALIDATE),
    getShameDayHours(range, filter, TODAY_REVALIDATE),
  ]);
  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const routeHourCounts = countById(visibleHours, (h) => h.routeId);
  const routeStreakMap = await getShameRouteStreaksBatch(
    [...routeHourCounts.keys()],
    range,
    filter,
  );

  const worst = pickWorst(visibleHours);
  const worstKey = worst && isCrownable(worst) ? `${worst.hour}-${worst.trip_id}` : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;

  /**
   * Render one day-view hour row: the row opens the hour's worst runs, the
   * route number the run itself.
   * @param t - The hour's worst run.
   * @param ctx - Surface context from the board.
   * @returns The row element.
   */
  const renderDayRow = (t: ShameTrip, ctx: ShameRowContext): JSX.Element => {
    const isWorst = worstKey === `${t.hour}-${t.trip_id}`;
    const name = routeDisplayName(t);
    const hourCount = routeHourCounts.get(t.routeId) ?? 0;
    const streakInfo = routeStreakMap.get(t.routeId);
    const streakDays = streakInfo?.count ?? 1;
    const totalHours = hourCount + (streakInfo?.prevHours ?? 0);
    const worstOfDayStreak = (isWorst ? 1 : 0) + (streakInfo?.prevWorstOfDayDays ?? 0);
    return (
      <ShameSplitRow
        ctx={ctx}
        className={cn(isWorst && "bg-at-late/5")}
        label={
          <ShameHourLabel
            hour={t.hour}
            serviceDate={serviceDate}
            href={shameHourHref(BASE, linkDay, t.hour, filter)}
            linkLabel={`Worst ${SHAME_RANKED_LIMIT} runs starting in the ${nzHourLabel(t.hour)} hour`}
          />
        }
      >
        <ModeIcon
          mode={t.mode}
          shortName={t.shortName}
          longName={t.longName}
          colour={t.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ShameSubjectLink href={shamedTripHref(t)}>{name}</ShameSubjectLink>
            {isWorst && <ShameWorstBadge />}
            {worstOfDayStreak >= 2 ? (
              <FlameCount
                tier="streak"
                count={worstOfDayStreak}
                worst={isWorst}
                label={`${name}: worst of the day ${worstOfDayStreak} days in a row · ${totalHours} hours total`}
              />
            ) : streakDays >= 2 ? (
              <FlameCount
                tier="streak"
                count={streakDays}
                worst={isWorst}
                label={`${name}: on the shame list ${streakDays} days in a row · ${totalHours} hours total`}
              />
            ) : hourCount > 1 ? (
              <FlameCount
                tier="day"
                count={hourCount}
                worst={isWorst}
                label={`${name} appeared in ${hourCount} hourly slots ${dayWhen}`}
              />
            ) : null}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">
            {boundFor(t.headsign, t.mode)?.concat(" · ") ?? ""}
            <span className="whitespace-nowrap">{nzClockTime(t.scheduled_start)}</span> ·{" "}
            <span className="whitespace-nowrap">{plural(t.stops, "stop")}</span>
          </span>
        </span>
        <ShameRowDelay
          avgDelaySec={t.avg_delay_sec}
          avgAbsDelaySec={t.avg_abs_delay_sec}
          mode={t.mode}
        />
      </ShameSplitRow>
    );
  };

  /**
   * Render one hour of the day board: its worst run, or a line saying no
   * run met the minimum sample that hour.
   * @param slot - The hour and its row, if any.
   * @param ctx - Surface context from the board.
   * @returns The row element.
   */
  const renderHourSlot = (slot: HourSlot<ShameTrip>, ctx: ShameRowContext): JSX.Element =>
    slot.row ? (
      renderDayRow(slot.row, ctx)
    ) : (
      <ShameEmptyHourRow
        hour={slot.hour}
        serviceDate={serviceDate}
        title="No run fits this hour"
        reason={`No run starting this hour recorded ${SHAME_MIN_STOPS} stops`}
        ctx={ctx}
      />
    );

  return (
    <ShameBoard
      layout="day"
      items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
      keyOf={(slot) => String(slot.hour)}
      emptyMessage="No runs recorded for this day."
      footerMessage="No runs were notably off schedule during these hours."
      showFooter={noneNotablyBad}
      renderRow={renderHourSlot}
    />
  );
}

/**
 * Day board narrowed to part of the day (or the whole day, from a week or month
 * row): its worst runs, in the hourly board's row style with the rank in the
 * hour's place.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode/school filter.
 * @param root0.hours - The part of the day.
 * @returns The board.
 */
async function TripHoursBoard({
  range,
  serviceDate,
  filter,
  hours,
}: {
  range: DateRange;
  serviceDate: string;
  filter: ShameFilter;
  hours: HourRange;
}): Promise<JSX.Element> {
  const { rows, total } = await getShameTripsInHours(range, filter, hours, TODAY_REVALIDATE);
  const crowned = isCrownable(rows[0] ?? null);

  /**
   * Render one ranked run.
   * @param t - The run.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderRow = (t: ShameTrip, ctx: ShameRowContext): JSX.Element => {
    const rank = rows.indexOf(t) + 1;
    const isWorst = crowned && rank === 1;
    const name = routeDisplayName(t);
    return (
      <Link href={shamedTripHref(t)} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <ShameRankLabel rank={rank} />
        <ModeIcon
          mode={t.mode}
          shortName={t.shortName}
          longName={t.longName}
          colour={t.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-at-ink">{name}</span>
            {isWorst && <ShameWorstBadge />}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">
            {boundFor(t.headsign, t.mode)?.concat(" · ") ?? ""}
            <span className="whitespace-nowrap">{nzClockTime(t.scheduled_start)}</span> ·{" "}
            <span className="whitespace-nowrap">{plural(t.stops, "stop")}</span>
          </span>
        </span>
        <ShameRowDelay
          avgDelaySec={t.avg_delay_sec}
          avgAbsDelaySec={t.avg_abs_delay_sec}
          mode={t.mode}
        />
      </Link>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={rows}
      keyOf={(t) => t.trip_id}
      emptyMessage={
        noHourStarted(hoursInRange(hours), serviceDate)
          ? notStartedMessage(hours)
          : `No run with ${SHAME_MIN_STOPS} stops started ${hoursNoun(hours)}.`
      }
      footerMessage={`Showing the worst ${SHAME_RANKED_LIMIT} of ${formatCount(total)} runs.`}
      showFooter={total > rows.length}
      renderRow={renderRow}
    />
  );
}

/**
 * Shame of the Day / Week: the most off-schedule run of each hour (day view) or
 * each service day (week view).
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `window`, `period`).
 * @returns Page markup.
 */
export default async function TripShamePage({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  clampDayParam(BASE, sp, today);
  dropTodayParam(BASE, sp, today);
  const { filter, view, subtitle, hours } = parseShameParams(sp);

  if (view !== "day") {
    // Cheap cached bounds for the stepper; the heavy per-day fan-out streams in
    // behind the header via Suspense. The window is anchored to the latest day
    // with data, as the home page anchors its own, so this board and the home
    // card that opens it cover the same days.
    const [latest, earliestDay] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
    const {
      range: activeRange,
      period: periodParam,
      nav: rangeControls,
    } = periodRangeNav(BASE, view, sp.period, latest ?? new Date(), earliestDay);
    const periodNoun = view;
    const rangeNav = { window: view, period: periodParam ?? undefined };

    return (
      <main className="space-y-6">
        <ShameHeader
          title={`Worst trips of the ${periodNoun}`}
          subtitle={`The most off-schedule run of each day · ${subtitle}`}
          activeTab="trip"
          tabHrefs={{
            trip: buildShameHref(BASE, rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
            stop: buildShameHref("/shame/stop", rangeNav, filter),
          }}
          basePath={BASE}
          nav={rangeControls}
          filter={{
            mode: filter.mode,
            schools: filter.schools,
            usage: getFilterUsage(activeRange),
            nav: rangeNav,
          }}
        />
        <Suspense fallback={<LoadingBlock label="Loading the board" />}>
          <TripRangeBoard
            range={activeRange}
            filter={filter}
            periodNoun={periodNoun}
            periodWhen={periodInPhrase(periodNoun, periodParam)}
          />
        </Suspense>
      </main>
    );
  }

  // Day view (default): worst trip per hour.
  const [shown, earliestDay] = await Promise.all([
    resolveShownDay(resolveRequestedDay(sp.day), today),
    getEarliestDataDay(1),
  ]);
  const { range, serviceDate } = shown;
  const dayNav = dayRangeNav(shown, earliestDay, today);
  const linkDay = dayNav.isToday ? undefined : serviceDate;

  return (
    <main className="space-y-6">
      <ShameHeader
        title={
          hours
            ? `Worst ${SHAME_RANKED_LIMIT} trips · ${shameHoursLabel(hours)}`
            : "Worst trips of the day"
        }
        subtitle={
          hours
            ? `The most off-schedule runs starting ${hoursNoun(hours)} · ${subtitle}`
            : `The most off-schedule run of each hour · ${subtitle}`
        }
        activeTab="trip"
        tabHrefs={{
          trip: buildShameHref(BASE, { day: linkDay, hours }, filter),
          route: buildShameHref("/shame/route", { day: linkDay, hours }, filter),
          stop: buildShameHref("/shame/stop", { day: linkDay, hours }, filter),
        }}
        basePath={BASE}
        nav={dayNav}
        filter={{
          mode: filter.mode,
          schools: filter.schools,
          usage: getFilterUsage(range),
          nav: { day: linkDay, hours: shameHoursParam(hours) },
        }}
        allHoursHref={hours ? buildShameHref(BASE, { day: linkDay }, filter) : undefined}
      />
      <Suspense fallback={<LoadingBlock label="Loading the board" />}>
        {hours ? (
          <TripHoursBoard range={range} serviceDate={serviceDate} filter={filter} hours={hours} />
        ) : (
          <TripDayBoard
            range={range}
            serviceDate={serviceDate}
            filter={filter}
            dayWhen={windowPhrase(dayNav, null)}
            linkDay={linkDay}
          />
        )}
      </Suspense>
    </main>
  );
}
