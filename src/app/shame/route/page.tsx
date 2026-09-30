// src/app/shame/route/page.tsx
// Worst-route page listing the most off-schedule route per hour (day view) or per day (week view).

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
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRoutesInHours,
  getShameRouteStreaksBatch,
  MIN_ROUTE_EVENTS_HOUR,
  SHAME_RANKED_LIMIT,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { getFilterUsage } from "@/lib/data/filter-usage";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import {
  fillServiceHours,
  filterLiveHours,
  noHourStarted,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
  type HourSlot,
} from "@/lib/page/nav";
import {
  dayRangeNav,
  periodInPhrase,
  periodRangeNav,
  routeLinkQuery,
  weekPeriodOf,
  windowPhrase,
} from "@/lib/page/range";
import {
  buildShameHref,
  countById,
  hoursNoun,
  isCrownable,
  isWholeDay,
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
import { routeSlug } from "@/lib/route/slug";
import { clampDayParam, dayLinkParam, dropTodayParam } from "@/lib/time/day-url";
import { requestServiceDay } from "@/lib/time/request-now";
import { nzHourLabel, serviceDayLabel, type DateRange } from "@/lib/time/service-day";
import {
  hourRangeParam,
  HOURS_PARAM,
  hoursInRange,
  singleHourRange,
  type HourRange,
} from "@/lib/time/time-of-day";
import { buildHref } from "@/lib/utils";
import type { ShameRouteRow } from "@/types/dashboard";
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
  const card = parseShameCard("route", sp);
  const { hours } = parseShameParams(sp);
  const title = hours
    ? `Worst ${SHAME_RANKED_LIMIT} routes · ${shameHoursLabel(hours)}`
    : listCardTitle(card);
  const description =
    "The most off-schedule route of each hour or day on Auckland's buses, trains and ferries.";
  return { title, description, ...cardMetadata(title, description, cardPath(card)) };
}

const BASE = "/shame/route";

/**
 * Week/month board body: runs the per-day worst-route fan-out and renders one
 * row per service day. Streams in behind the header so the shell never waits on
 * a cold period.
 * @param root0 - Props.
 * @param root0.range - The active window.
 * @param root0.filter - Active mode/school filter.
 * @param root0.isMonth - Whether the month variant is active.
 * @param root0.periodParam - Validated period param, or null for the rolling default.
 * @returns The populated board.
 */
async function RouteRangeBoard({
  range,
  filter,
  isMonth,
  periodParam,
}: {
  range: DateRange;
  filter: ShameFilter;
  isMonth: boolean;
  periodParam: string | null;
}): Promise<JSX.Element> {
  const shame = await getShameRouteOfWeek(range, filter, WEEK_REVALIDATE);
  const periodNoun = isMonth ? "month" : "week";
  const worstKey = shame.worst?.date ?? null;
  const routeDayCounts = countById(shame.days, (d) => d.route_id);

  /**
   * Render one range-view day row.
   * @param r - The day's worst route.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderWeekRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
    const isWorst = r.date === worstKey;
    const name = r.short_name || r.long_name || routeSlug(r.route_id);
    const slug = routeSlug(r.route_id);
    // Open the route's week view either way: a week row keeps the board's week
    // (rolling or fixed), and a month row opens the week holding its day, since
    // the route page has no month window.
    const weekPeriod = isMonth && r.date ? weekPeriodOf(r.date) : periodParam;
    const href = `/route/${encodeURIComponent(slug)}${routeLinkQuery("week", null, weekPeriod)}`;
    const dayCount = routeDayCounts.get(r.route_id) ?? 0;
    return (
      <ShameSplitRow
        ctx={ctx}
        className={cn(isWorst && "bg-at-late/5")}
        label={
          r.date ? (
            <ShameDayLabel
              date={r.date}
              href={shameDayListHref(BASE, dayLinkParam(r.date), filter)}
              linkLabel={`Worst ${SHAME_RANKED_LIMIT} routes on ${serviceDayLabel(r.date)}`}
            />
          ) : (
            <span className="w-16 shrink-0" />
          )
        }
      >
        <ModeIcon
          mode={r.mode}
          shortName={r.short_name}
          longName={r.long_name}
          colour={r.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ShameSubjectLink href={href}>{name}</ShameSubjectLink>
            {isWorst && <ShameWorstBadge />}
            {dayCount > 1 && (
              <FlameCount
                tier="week"
                count={dayCount}
                worst={isWorst}
                label={`${name} was the worst route on ${dayCount} days in ${periodInPhrase(
                  periodNoun,
                  periodParam,
                )}`}
              />
            )}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">{r.events} arrivals</span>
        </span>
        <ShameRowDelay
          avgDelaySec={r.avg_delay_sec}
          avgAbsDelaySec={r.avg_abs_delay_sec}
          mode={r.mode}
        />
      </ShameSplitRow>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={shame.days}
      keyOf={(r, i) => r.date ?? String(i)}
      emptyMessage={`No route data recorded for this ${periodNoun}.`}
      renderRow={renderWeekRow}
    />
  );
}

/**
 * Day board body: the day's hourly rows, awaited behind the header's Suspense
 * boundary so the window controls and filters are on screen while the route
 * queries run.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode/school filter.
 * @param root0.dayWhen - The day as the row copy names it ("today" / "that day").
 * @param root0.linkDay - The `?day` a row's link carries, or undefined on today.
 * @returns The board.
 */
async function RouteDayBoard({
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
    getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    getShameDayHours(range, filter, TODAY_REVALIDATE),
  ]);
  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const routeHourCounts = countById(visibleHours, (h) => h.route_id);
  const routeStreakMap = await getShameRouteStreaksBatch(
    [...routeHourCounts.keys()],
    range,
    filter,
  );

  const worst = pickWorst(visibleHours);
  const worstKey = worst && isCrownable(worst) ? `${worst.hour}-${worst.route_id}` : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;

  /**
   * Render one day-view hour row.
   * @param r - The hour's worst route.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderDayRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
    const isWorst = worstKey === `${r.hour}-${r.route_id}`;
    const name = r.short_name || r.long_name || routeSlug(r.route_id);
    const slug = routeSlug(r.route_id);
    // The row is one hour's, so the route page opens on that hour: its whole-day
    // figures are a different number under the same route name.
    const href = buildHref(`/route/${encodeURIComponent(slug)}`, {
      day: linkDay,
      [HOURS_PARAM]: hourRangeParam(singleHourRange(r.hour)),
    });
    const hourCount = routeHourCounts.get(r.route_id) ?? 0;
    const streakInfo = routeStreakMap.get(r.route_id);
    const streakDays = streakInfo?.count ?? 1;
    const totalHours = hourCount + (streakInfo?.prevHours ?? 0);
    const worstOfDayStreak = (isWorst ? 1 : 0) + (streakInfo?.prevWorstOfDayDays ?? 0);
    return (
      <ShameSplitRow
        ctx={ctx}
        className={cn(isWorst && "bg-at-late/5")}
        label={
          <ShameHourLabel
            hour={r.hour}
            serviceDate={serviceDate}
            href={shameHourHref(BASE, linkDay, r.hour, filter)}
            linkLabel={`Worst ${SHAME_RANKED_LIMIT} routes in the ${nzHourLabel(r.hour)} hour`}
          />
        }
      >
        <ModeIcon
          mode={r.mode}
          shortName={r.short_name}
          longName={r.long_name}
          colour={r.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <ShameSubjectLink href={href}>{name}</ShameSubjectLink>
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
                label={
                  isWorst
                    ? `${name}: worst route of the day · worst in ${hourCount} hours`
                    : `${name}: worst route in ${hourCount} hours ${dayWhen}`
                }
              />
            ) : null}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">{r.events} arrivals</span>
        </span>
        <ShameRowDelay
          avgDelaySec={r.avg_delay_sec}
          avgAbsDelaySec={r.avg_abs_delay_sec}
          mode={r.mode}
        />
      </ShameSplitRow>
    );
  };

  /**
   * Render one hour of the day board: its worst route, or a line saying no
   * route met the minimum sample that hour.
   * @param slot - The hour and its row, if any.
   * @param ctx - Surface context from the board.
   * @returns The row element.
   */
  const renderHourSlot = (slot: HourSlot<ShameRouteRow>, ctx: ShameRowContext): JSX.Element =>
    slot.row ? (
      renderDayRow(slot.row, ctx)
    ) : (
      <ShameEmptyHourRow
        hour={slot.hour}
        serviceDate={serviceDate}
        title="No route fits this hour"
        reason={`No route had ${MIN_ROUTE_EVENTS_HOUR} arrivals from runs starting this hour`}
        ctx={ctx}
      />
    );

  return (
    <ShameBoard
      layout="day"
      items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
      keyOf={(slot) => String(slot.hour)}
      emptyMessage="No route data recorded for this day."
      footerMessage="No routes were notably off schedule during these hours."
      showFooter={noneNotablyBad}
      renderRow={renderHourSlot}
    />
  );
}

/**
 * Day board narrowed to part of the day (or the whole day, from a week or month
 * row): its worst routes, in the hourly board's row style with the rank in the
 * hour's place. A row opens the route page on the same hours, since its figures
 * are those hours' and not the whole day's.
 * @param root0 - Props.
 * @param root0.range - The shown day's 4am-to-4am window.
 * @param root0.serviceDate - The shown service date.
 * @param root0.filter - Active mode/school filter.
 * @param root0.hours - The part of the day.
 * @param root0.linkDay - The shown day's param for links, or undefined for today.
 * @returns The board.
 */
async function RouteHoursBoard({
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
  const { rows, total } = await getShameRoutesInHours(range, filter, hours, TODAY_REVALIDATE);
  const crowned = isCrownable(rows[0] ?? null);

  /**
   * Render one ranked route.
   * @param r - The route.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
    const rank = rows.indexOf(r) + 1;
    const isWorst = crowned && rank === 1;
    const name = r.short_name || r.long_name || routeSlug(r.route_id);
    const href = buildHref(`/route/${encodeURIComponent(routeSlug(r.route_id))}`, {
      day: linkDay,
      [HOURS_PARAM]: hourRangeParam(isWholeDay(hours) ? null : hours),
    });
    return (
      <Link href={href} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <ShameRankLabel rank={rank} />
        <ModeIcon
          mode={r.mode}
          shortName={r.short_name}
          longName={r.long_name}
          colour={r.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-at-ink">{name}</span>
            {isWorst && <ShameWorstBadge />}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">{r.events} arrivals</span>
        </span>
        <ShameRowDelay
          avgDelaySec={r.avg_delay_sec}
          avgAbsDelaySec={r.avg_abs_delay_sec}
          mode={r.mode}
        />
      </Link>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={rows}
      keyOf={(r) => r.route_id}
      emptyMessage={
        noHourStarted(hoursInRange(hours), serviceDate)
          ? notStartedMessage(hours)
          : `No route had ${MIN_ROUTE_EVENTS_HOUR} arrivals from runs starting ${hoursNoun(hours)}.`
      }
      footerMessage={`Showing the worst ${SHAME_RANKED_LIMIT} of ${total.toLocaleString("en-NZ")} routes.`}
      showFooter={total > rows.length}
      renderRow={renderRow}
    />
  );
}

/**
 * Route-shame page: the worst route for each hour (day view) or service day
 * (week view), derived from arrival-event deviation aggregates.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `window`, `period`).
 * @returns Page markup.
 */
export default async function RoutesShamePage({
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
    const isMonth = view === "month";
    const periodNoun = view;
    const rangeNav = { window: view, period: periodParam ?? undefined };

    return (
      <main className="space-y-6">
        <ShameHeader
          title={`Worst routes of the ${periodNoun}`}
          subtitle={`The most off-schedule route of each day · ${subtitle}`}
          activeTab="route"
          tabHrefs={{
            trip: buildShameHref("/shame/trip", rangeNav, filter),
            route: buildShameHref(BASE, rangeNav, filter),
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
          <RouteRangeBoard
            range={activeRange}
            filter={filter}
            isMonth={isMonth}
            periodParam={periodParam}
          />
        </Suspense>
      </main>
    );
  }

  // Day view (default): worst route per hour.
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
            ? `Worst ${SHAME_RANKED_LIMIT} routes · ${shameHoursLabel(hours)}`
            : "Worst routes of the day"
        }
        subtitle={
          hours
            ? `The most off-schedule routes over runs starting ${hoursNoun(hours)} · ${subtitle}`
            : `The most off-schedule route of each hour · ${subtitle}`
        }
        activeTab="route"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay, hours }, filter),
          route: buildShameHref(BASE, { day: linkDay, hours }, filter),
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
          <RouteHoursBoard
            range={range}
            serviceDate={serviceDate}
            filter={filter}
            hours={hours}
            linkDay={linkDay}
          />
        ) : (
          <RouteDayBoard
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
