// src/app/shame/stop/page.tsx
// Worst-stop page listing the most off-schedule stop per hour (day view) or per day (week view).

import { LoadingBlock } from "@/components/Loading";
import {
  hourSlotRenderer,
  ShameBoard,
  ShameDayLabel,
  ShameHourLabel,
  ShameRankLabel,
  ShameRowBody,
  ShameSplitRow,
  ShameSubjectLink,
  type ShameRowContext,
} from "@/components/shame/ShameBoard";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { cn } from "@/lib/cn";
import { countBy } from "@/lib/collections";
import {
  getEarliestDataDay,
  getLatestEventDate,
  getShameDayHours,
  getShameStopsInHours,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
  MIN_STOP_EVENTS_HOUR,
  SHAME_RANKED_LIMIT,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { getFilterUsage } from "@/lib/data/filter-usage";
import { formatCount, plural } from "@/lib/format";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import { stopHref } from "@/lib/page/hrefs";
import {
  fillServiceHours,
  filterLiveHours,
  noHourStarted,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
} from "@/lib/page/nav";
import { dayRangeNav, periodInPhrase, periodRangeNav, windowPhrase } from "@/lib/page/range";
import {
  buildShameHref,
  hoursNoun,
  isCrownable,
  notStartedMessage,
  parseShameParams,
  pickWorst,
  shameDayListHref,
  shameHourHref,
  shameHoursLabel,
  shameHoursParam,
  subtitleWithDirection,
  WEEK_REVALIDATE,
  type ShameFilter,
  type ShameSearchParams,
} from "@/lib/page/shame";
import type { DelayDirection } from "@/lib/rankings";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import { nzHourLabel, serviceDayLabel, type DateRange } from "@/lib/time/service-day";
import { hoursInRange, type HourRange } from "@/lib/time/time-of-day";
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
  const sp = (await searchParams) ?? {};
  const card = parseShameCard("stop", sp);
  const { hours } = parseShameParams(sp);
  const title = hours
    ? `Worst ${SHAME_RANKED_LIMIT} stops · ${shameHoursLabel(hours)}`
    : listCardTitle(card);
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
 * @param when - The window as the words after "recorded" ("today", "in the last 7 days").
 * @returns The message under an empty board.
 */
function emptyBoardMessage(direction: DelayDirection, when: string): string {
  return direction ? `No stop ran ${direction} on average ${when}.` : `No stops recorded ${when}.`;
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
 * @param root0.periodWhen - The period as the words that follow "in" ("the last 7 days").
 * @returns The populated board.
 */
async function StopRangeBoard({
  range,
  filter,
  periodWhen,
}: {
  range: DateRange;
  filter: ShameFilter;
  periodWhen: string;
}): Promise<JSX.Element> {
  const shame = await getWorstStopsOfWeek(range, filter, WEEK_REVALIDATE);
  // Crowned by day, not by stop: a stop that tops several days wins one of them,
  // and its other rows are ordinary rows.
  const worstKey = shame.worst?.date ?? null;
  const stopDayCounts = countBy(shame.days, (d) => d.stop_id);

  /**
   * Render one range-view day row.
   * @param s - The day's worst stop.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderWeekRow = (s: ShameDayStop, ctx: ShameRowContext): JSX.Element => {
    const isWorst = s.date === worstKey;
    const weekCount = stopDayCounts.get(s.stop_id) ?? 0;
    const day = dayLinkParam(s.date);
    return (
      <ShameSplitRow
        ctx={ctx}
        worst={isWorst}
        label={
          <ShameDayLabel
            date={s.date}
            href={shameDayListHref(BASE, day, filter, { dir: filter.direction ?? undefined })}
            linkLabel={`Worst ${SHAME_RANKED_LIMIT} stops on ${serviceDayLabel(s.date)}`}
          />
        }
      >
        <ShameRowBody
          subject={
            <ShameSubjectLink href={stopHref(s.stop_id, { day })}>{s.name}</ShameSubjectLink>
          }
          worst={isWorst}
          detail={plural(s.events, "arrival")}
          note={weekCount > 1 && `${s.name} was bad ${badTimes(weekCount)} in ${periodWhen}`}
          figures={s}
        />
      </ShameSplitRow>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={shame.days}
      keyOf={(s) => s.date}
      emptyMessage={emptyBoardMessage(filter.direction, `in ${periodWhen}`)}
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
  const stopHourCounts = countBy(visibleHours, (h) => h.stop_id);

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
      <ShameSplitRow
        ctx={ctx}
        worst={isWorst}
        label={
          <ShameHourLabel
            hour={s.hour}
            serviceDate={serviceDate}
            href={shameHourHref(BASE, linkDay, s.hour, filter, {
              dir: filter.direction ?? undefined,
            })}
            linkLabel={`Worst ${SHAME_RANKED_LIMIT} stops in the ${nzHourLabel(s.hour)} hour`}
          />
        }
      >
        <ShameRowBody
          subject={
            <ShameSubjectLink href={stopHref(s.stop_id, { day: linkDay })}>
              {s.name}
            </ShameSubjectLink>
          }
          worst={isWorst}
          detail={plural(s.events, "arrival")}
          note={hourCount > 1 && `${s.name} was bad ${badTimes(hourCount)} ${dayWhen}`}
          figures={s}
        />
      </ShameSplitRow>
    );
  };

  const renderHourSlot = hourSlotRenderer(renderDayRow, {
    serviceDate,
    title: "No stop fits this hour",
    reason: emptyHourReason(filter.direction),
  });

  return (
    <ShameBoard
      layout="day"
      items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
      keyOf={(slot) => String(slot.hour)}
      emptyMessage={emptyBoardMessage(filter.direction, dayWhen)}
      footerMessage="No stops were notably off schedule during these hours."
      showFooter={noneNotablyBad}
      renderRow={renderHourSlot}
    />
  );
}

/**
 * Day board narrowed to part of the day (or the whole day, from a week or month
 * row): its worst stations, in the hourly board's row style with the rank in the
 * hour's place.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode, school and direction filter.
 * @param root0.hours - The part of the day.
 * @param root0.linkDay - The shown day's param for links, or undefined for today.
 * @returns The board.
 */
async function StopHoursBoard({
  range,
  serviceDate,
  filter,
  hours,
  linkDay,
}: {
  range: DateRange;
  serviceDate: string;
  filter: ShameFilter;
  hours: HourRange;
  linkDay: string | undefined;
}): Promise<JSX.Element> {
  const { rows, total } = await getShameStopsInHours(range, filter, hours, TODAY_REVALIDATE);
  const crowned = isCrownable(rows[0] ?? null);

  /**
   * Render one ranked station.
   * @param s - The station.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderRow = (s: ShameStop, ctx: ShameRowContext): JSX.Element => {
    const rank = rows.indexOf(s) + 1;
    const isWorst = crowned && rank === 1;
    return (
      <Link
        href={stopHref(s.stop_id, { day: linkDay })}
        className={cn(ctx.anchorClass, isWorst && "at-worst")}
      >
        <ShameRankLabel rank={rank} />
        <ShameRowBody
          subject={<span className="font-semibold text-at-ink">{s.name}</span>}
          worst={isWorst}
          detail={plural(s.events, "arrival")}
          figures={s}
        />
      </Link>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={rows}
      keyOf={(s) => s.stop_id}
      emptyMessage={
        noHourStarted(hoursInRange(hours), serviceDate)
          ? notStartedMessage(hours)
          : filter.direction
            ? `No stop ran ${filter.direction} on average ${hoursNoun(hours)}.`
            : `No stop had enough arrivals ${hoursNoun(hours)}.`
      }
      footerMessage={`Showing the worst ${SHAME_RANKED_LIMIT} of ${formatCount(total)} stops.`}
      showFooter={total > rows.length}
      renderRow={renderRow}
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
  // One request-time clock read for the whole render, taken before the day-param redirects below
  // so none of them reads the clock during the static prerender (see lib/time/request-now.ts).
  const today = await requestServiceDay();
  const { filter, view, subtitle: modeSubtitle, hours } = parseShameParams(sp);
  if (view === "day") {
    clampDayParam(BASE, sp, today);
    dropTodayParam(BASE, sp, today);
  }
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
    } = periodRangeNav(BASE, view, sp.period, latest ?? new Date(), earliestDay, today);
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
            schools: filter.schools,
            usage: getFilterUsage(activeRange),
            nav: rangeNav,
            direction: { active: filter.direction },
          }}
        />
        <Suspense fallback={<LoadingBlock label="Loading the board" />}>
          <StopRangeBoard
            range={activeRange}
            filter={filter}
            periodWhen={periodInPhrase(periodNoun, periodParam)}
          />
        </Suspense>
      </main>
    );
  }

  // Day view: worst stop per hour.
  const [shown, earliestDay] = await Promise.all([
    resolveShownDay(resolveRequestedDay(sp.day), today),
    getEarliestDataDay(1),
  ]);
  const { range, serviceDate } = shown;
  const dayNav = dayRangeNav(shown, earliestDay, today);
  const linkDay = dayLinkParam(serviceDate, today);

  return (
    <main className="space-y-6">
      <ShameHeader
        title={
          hours
            ? `Worst ${SHAME_RANKED_LIMIT} stops · ${shameHoursLabel(hours)}`
            : "Worst stops of the day"
        }
        subtitle={
          hours
            ? `The most off-schedule stops ${hoursNoun(hours)} · ${subtitle}`
            : `The most off-schedule stop of each hour · ${subtitle}`
        }
        activeTab="stop"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay, hours }, filter),
          route: buildShameHref("/shame/route", { day: linkDay, hours }, filter),
          stop: buildShameHref(BASE, { day: linkDay, hours }, filter),
        }}
        basePath={BASE}
        nav={dayNav}
        filter={{
          mode: filter.mode,
          schools: filter.schools,
          usage: getFilterUsage(range),
          nav: { day: linkDay, hours: shameHoursParam(hours) },
          direction: { active: filter.direction },
        }}
        allHoursHref={
          hours
            ? buildShameHref(BASE, { day: linkDay }, filter, { dir: filter.direction ?? undefined })
            : undefined
        }
      />
      <Suspense fallback={<LoadingBlock label="Loading the board" />}>
        {hours ? (
          <StopHoursBoard
            range={range}
            serviceDate={serviceDate}
            filter={filter}
            hours={hours}
            linkDay={linkDay}
          />
        ) : (
          <StopDayBoard
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
