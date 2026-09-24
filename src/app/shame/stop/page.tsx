// src/app/shame/stop/page.tsx
// Worst-stop page listing the most off-schedule stop per hour (day view) or per day (week view).

import {
  ShameBoard,
  ShameEmptyHourRow,
  ShameHourLabel,
  type ShameRowContext,
} from "@/components/shame/ShameBoard";
import { ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameRowDelay } from "@/components/shame/ShameRowDelay";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getShameDayHours,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
  MIN_STOP_EVENTS_HOUR,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/day-url";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import {
  fillServiceHours,
  filterLiveHours,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
  startedServiceHourCount,
  type HourSlot,
} from "@/lib/page-nav";
import { dayRangeNav, periodInPhrase, periodRangeNav, windowPhrase } from "@/lib/range-page";
import type { DelayDirection } from "@/lib/rankings";
import {
  buildShameHref,
  countById,
  isCrownable,
  parseShameParams,
  pickWorst,
  subtitleWithDirection,
  WEEK_REVALIDATE,
  type ShameFilter,
  type ShameSearchParams,
} from "@/lib/shame-page";
import { weekdayShort, type DateRange } from "@/lib/time";
import { buildHref } from "@/lib/utils";
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
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
  const card = parseShameCard("stop", (await searchParams) ?? {});
  const title = listCardTitle(card);
  const description =
    "The most off-schedule stop of each hour or day on Auckland's buses, trains and ferries.";
  return { title, description, ...cardMetadata(title, description, cardPath(card)) };
}

const BASE = "/shame/stop";

/**
 * Plain-English count of how often a stop was bad ("twice" / "3 times").
 * @param count - The number of slots the stop was bad in.
 * @returns The phrase, e.g. "twice" or "3 times".
 */
function badTimes(count: number): string {
  return count === 2 ? "twice" : `${count} times`;
}

/**
 * Why a board came back empty. With a direction set an empty board is an
 * ordinary result rather than missing data, so it says which direction found
 * nothing instead of claiming nothing was recorded.
 * @param direction - The active direction, or null for both.
 * @param period - What the board covers: "day", "week" or "month".
 * @returns The message under an empty board.
 */
function emptyBoardMessage(direction: DelayDirection, period: string): string {
  return direction
    ? `No stop ran ${direction} on average this ${period}.`
    : `No stop data recorded for this ${period}.`;
}

/**
 * Why one hour of the day board has no row. The arrivals floor is only half the
 * reason once a direction is set: an hour can hold plenty of busy stops and
 * still have none running the way the board is filtered to.
 * @param direction - The active direction, or null for both.
 * @returns The reason line for an empty hour.
 */
function emptyHourReason(direction: DelayDirection): string {
  return direction
    ? `No stop with ${MIN_STOP_EVENTS_HOUR} arrivals ran ${direction} this hour`
    : `No stop had ${MIN_STOP_EVENTS_HOUR} arrivals this hour`;
}

/**
 * Week/month board body: runs the per-day worst-stop fan-out and renders one
 * row per service day. Streams in behind the header so the shell never waits on
 * a cold period.
 * @param root0 - Props.
 * @param root0.range - The active window.
 * @param root0.filter - Active mode, school and direction filter.
 * @param root0.periodNoun - Copy noun for the period ("week" / "month").
 * @param root0.periodWhen - The period as the words that follow "in" ("the last 7 days").
 * @returns The populated board.
 */
async function StopRangeBoard({
  range,
  filter,
  periodNoun,
  periodWhen,
}: {
  range: DateRange;
  filter: ShameFilter;
  periodNoun: "week" | "month";
  periodWhen: string;
}): Promise<JSX.Element> {
  const shame = await getWorstStopsOfWeek(range, filter, WEEK_REVALIDATE);
  // Crowned by day, not by stop: a stop that tops several days wins one of them,
  // and its other rows are ordinary rows.
  const worstKey = shame.worst?.date ?? null;
  const stopDayCounts = countById(shame.days, (d) => d.stop_id);

  /**
   * Render one range-view day row.
   * @param s - The day's worst stop.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderWeekRow = (s: ShameDayStop, ctx: ShameRowContext): JSX.Element => {
    const isWorst = s.date === worstKey;
    const [, m, d] = s.date.split("-");
    const dayLabel = weekdayShort(s.date);
    const weekCount = stopDayCounts.get(s.stop_id) ?? 0;
    return (
      <Link
        href={buildHref(`/stop/${encodeURIComponent(s.stop_id)}`, {
          day: dayLinkParam(s.date),
        })}
        className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}
      >
        <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {dayLabel} {d}/{m}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{s.name}</span>
            {isWorst && <ShameWorstBadge />}
          </span>
          <span className="block text-xs text-at-muted">{s.events} arrivals</span>
          {weekCount > 1 && (
            <span className="block text-xs text-at-muted">
              {s.name} was bad {badTimes(weekCount)} in {periodWhen}
            </span>
          )}
        </span>
        <ShameRowDelay
          avgDelaySec={s.avg_delay_sec}
          avgAbsDelaySec={s.avg_abs_delay_sec}
          mode={s.mode}
        />
      </Link>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={shame.days}
      keyOf={(s) => s.date}
      emptyMessage={emptyBoardMessage(filter.direction, periodNoun)}
      renderRow={renderWeekRow}
    />
  );
}

/**
 * Day board body: the day's hourly rows, awaited behind the header's Suspense
 * boundary so the window controls and filters are on screen while the stop
 * queries run.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode, school and direction filter.
 * @param root0.dayWhen - The day as the row copy names it ("today" / "that day").
 * @param root0.linkDay - The `?day` a row's link carries, or undefined on today.
 * @returns The board.
 */
async function StopDayBoard({
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
    getWorstStopsOfDay(range, filter, TODAY_REVALIDATE),
    // The span is which hours the day ran, shared with the trips and routes
    // boards, so it is read without the direction: narrowed, a Late board would
    // lose the hours whose worst stop ran early rather than showing them empty.
    getShameDayHours(range, { ...filter, direction: null }, TODAY_REVALIDATE),
  ]);
  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const stopHourCounts = countById(visibleHours, (h) => h.stop_id);

  const worst = pickWorst(visibleHours);
  const worstKey = worst && isCrownable(worst) ? `${worst.hour}-${worst.stop_id}` : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;

  /**
   * Render one day-view hour row.
   * @param s - The hour's worst stop.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderDayRow = (s: ShameStop, ctx: ShameRowContext): JSX.Element => {
    const isWorst = worstKey === `${s.hour}-${s.stop_id}`;
    const hourCount = stopHourCounts.get(s.stop_id) ?? 0;
    return (
      <Link
        href={`/stop/${encodeURIComponent(s.stop_id)}${linkDay ? `?day=${linkDay}` : ""}`}
        className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}
      >
        <ShameHourLabel hour={s.hour} serviceDate={serviceDate} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{s.name}</span>
            {isWorst && <ShameWorstBadge />}
          </span>
          <span className="block text-xs text-at-muted">{s.events} arrivals</span>
          {hourCount > 1 && (
            <span className="block text-xs text-at-muted">
              {s.name} was bad {badTimes(hourCount)} {dayWhen}
            </span>
          )}
        </span>
        <ShameRowDelay
          avgDelaySec={s.avg_delay_sec}
          avgAbsDelaySec={s.avg_abs_delay_sec}
          mode={s.mode}
        />
      </Link>
    );
  };

  /**
   * Render one hour of the day board: its worst stop, or a line saying no
   * stop met the minimum sample that hour.
   * @param slot - The hour and its row, if any.
   * @param ctx - Surface context from the board.
   * @returns The row element.
   */
  const renderHourSlot = (slot: HourSlot<ShameStop>, ctx: ShameRowContext): JSX.Element =>
    slot.row ? (
      renderDayRow(slot.row, ctx)
    ) : (
      <ShameEmptyHourRow
        hour={slot.hour}
        serviceDate={serviceDate}
        title="No stop fits this hour"
        reason={emptyHourReason(filter.direction)}
        ctx={ctx}
      />
    );

  return (
    <ShameBoard
      layout="day"
      items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
      keyOf={(slot) => String(slot.hour)}
      emptyMessage={emptyBoardMessage(filter.direction, "day")}
      footerMessage="No stops were notably off schedule during these hours."
      showFooter={noneNotablyBad}
      renderRow={renderHourSlot}
    />
  );
}

/**
 * Worst Stop of the Day / Week: the most off-schedule stop of each hour (day
 * view) or each service day (week view). Mirrors the Shame of the Day page but
 * for stops rather than trips.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `window`, `period`).
 * @returns Page markup.
 */
export default async function StopShamePage({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  clampDayParam(BASE, sp);
  dropTodayParam(BASE, sp);
  const { filter, view, subtitle: modeSubtitle } = parseShameParams(sp);
  const subtitle = subtitleWithDirection(modeSubtitle, filter.direction);

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
          title={`Worst stops of the ${periodNoun}`}
          subtitle={`The most off-schedule stop of each day · ${subtitle}`}
          activeTab="stop"
          tabHrefs={{
            trip: buildShameHref("/shame/trip", rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
            stop: buildShameHref(BASE, rangeNav, filter),
          }}
          basePath={BASE}
          nav={rangeControls}
          filter={{
            mode: filter.mode,
            includeSchool: filter.includeSchool,
            nav: rangeNav,
            direction: { active: filter.direction },
          }}
        />
        <Suspense
          fallback={
            <ShameBoardSkeleton
              layout="week"
              shape={{ icon: false, mobileLines: 2, gridLines: 2 }}
            />
          }
        >
          <StopRangeBoard
            range={activeRange}
            filter={filter}
            periodNoun={periodNoun}
            periodWhen={periodInPhrase(periodNoun, periodParam)}
          />
        </Suspense>
      </main>
    );
  }

  // Day view: worst stop per hour.
  const [shown, earliestDay] = await Promise.all([
    resolveShownDay(resolveRequestedDay(sp.day)),
    getEarliestDataDay(1),
  ]);
  const { range, serviceDate } = shown;
  const dayNav = dayRangeNav(shown, earliestDay);
  const linkDay = dayNav.isToday ? undefined : serviceDate;

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Worst stops of the day"
        subtitle={`The most off-schedule stop of each hour · ${subtitle}`}
        activeTab="stop"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay }, filter),
          route: buildShameHref("/shame/route", { day: linkDay }, filter),
          stop: buildShameHref(BASE, { day: linkDay }, filter),
        }}
        basePath={BASE}
        nav={dayNav}
        filter={{
          mode: filter.mode,
          includeSchool: filter.includeSchool,
          nav: { day: linkDay },
          direction: { active: filter.direction },
        }}
      />
      <Suspense
        fallback={
          <ShameBoardSkeleton
            layout="day"
            shape={{ icon: false, mobileLines: 2, gridLines: 2 }}
            rows={startedServiceHourCount(serviceDate)}
          />
        }
      >
        <StopDayBoard
          range={range}
          serviceDate={serviceDate}
          filter={filter}
          dayWhen={windowPhrase(dayNav, null)}
          linkDay={linkDay}
        />
      </Suspense>
    </main>
  );
}
