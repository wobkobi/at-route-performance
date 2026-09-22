// src/app/shame/route/page.tsx
// Worst-route page listing the most off-schedule route per hour (day view) or per day (week view).

import { FlameCount } from "@/components/FlameCount";
import { ModeIcon } from "@/components/ModeIcon";
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
  getShameDayHours,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRouteStreaksBatch,
  MIN_ROUTE_EVENTS_HOUR,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { cardMetadata, cardPath, listCardTitle, parseShameCard } from "@/lib/og";
import {
  fillServiceHours,
  filterLiveHours,
  resolveRangeView,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
  type HourSlot,
} from "@/lib/page-nav";
import {
  dayRangeNav,
  periodInPhrase,
  routeLinkQuery,
  weekPeriodOf,
  windowPhrase,
} from "@/lib/range-page";
import { routeSlug } from "@/lib/route-slug";
import {
  buildShameHref,
  countById,
  isCrownable,
  parseShameParams,
  pickWorst,
  WEEK_REVALIDATE,
  type ShameFilter,
  type ShameSearchParams,
} from "@/lib/shame-page";
import { weekdayShort, type DateRange } from "@/lib/time";
import type { ShameRouteRow } from "@/types/dashboard";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

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
  const card = parseShameCard("route", (await searchParams) ?? {});
  const title = listCardTitle(card);
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
    const [, m, d] = r.date ? r.date.split("-") : [];
    const dayLabel = r.date ? weekdayShort(r.date) : "";
    const dayCount = routeDayCounts.get(r.route_id) ?? 0;
    return (
      <Link href={href} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {r.date ? `${dayLabel} ${d}/${m}` : ""}
        </span>
        <ModeIcon
          mode={r.mode}
          shortName={r.short_name}
          longName={r.long_name}
          colour={r.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{name}</span>
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
      </Link>
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
  clampDayParam(BASE, sp);
  dropTodayParam(BASE, sp);
  const { filter, view, preserved, subtitle } = parseShameParams(sp);

  if (view !== "day") {
    /**
     * Build a link to this view for a period, preserving the active filter.
     * @param period - ISO week-start date or `YYYY-MM` month key, or null for the rolling default.
     * @returns The href.
     */
    const rangeHref = (period: string | null): string =>
      buildShameHref(BASE, { window: view, period: period ?? undefined }, filter);
    // Cheap cached bound for the stepper; the heavy per-day fan-out streams in
    // behind the header via Suspense.
    const earliestDay = await getEarliestDataDay(1);
    const { isMonth, periodNoun, periodParam, activeRange, periodLabel, prevHref, nextHref } =
      resolveRangeView(view, sp.period, earliestDay, rangeHref);
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
          filter={{
            basePath: BASE,
            mode: filter.mode,
            includeSchool: filter.includeSchool,
            nav: rangeNav,
          }}
          nav={{
            kind: "week",
            unit: periodNoun,
            // A stepped-back week's Day opens its Monday; a month opens today.
            dayToggleHref: buildShameHref(
              BASE,
              { day: isMonth ? undefined : (periodParam ?? undefined) },
              filter,
            ),
            periodLabel,
            prevHref,
            nextHref,
          }}
        />
        <Suspense fallback={<ShameBoardSkeleton layout="week" />}>
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
  const shown = await resolveShownDay(resolveRequestedDay(sp.day));
  const { range, serviceDate } = shown;
  const [shame, earliestDay, dayHours] = await Promise.all([
    getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
    getShameDayHours(range, filter, TODAY_REVALIDATE),
  ]);
  const dayNav = dayRangeNav(shown, earliestDay);

  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const routeHourCounts = countById(visibleHours, (h) => h.route_id);
  const routeStreakMap = await getShameRouteStreaksBatch(
    [...routeHourCounts.keys()],
    range,
    filter,
  );
  const linkDay = dayNav.isToday ? undefined : serviceDate;
  const dayWhen = windowPhrase(dayNav, null);
  // Stepping onto today drops `?day` so the URL stays canonical.
  const nextDayHref = dayNav.nextIsToday ? buildShameHref(BASE, {}, filter) : undefined;

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
    const href = linkDay
      ? `/route/${encodeURIComponent(slug)}?day=${linkDay}`
      : `/route/${encodeURIComponent(slug)}`;
    const hourCount = routeHourCounts.get(r.route_id) ?? 0;
    const streakInfo = routeStreakMap.get(r.route_id);
    const streakDays = streakInfo?.count ?? 1;
    const totalHours = hourCount + (streakInfo?.prevHours ?? 0);
    const worstOfDayStreak = (isWorst ? 1 : 0) + (streakInfo?.prevWorstOfDayDays ?? 0);
    return (
      <Link href={href} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <ShameHourLabel hour={r.hour} serviceDate={serviceDate} />
        <ModeIcon
          mode={r.mode}
          shortName={r.short_name}
          longName={r.long_name}
          colour={r.colour}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{name}</span>
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
      </Link>
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
    <main className="space-y-6">
      <ShameHeader
        title="Worst routes of the day"
        subtitle={`The most off-schedule route of each hour · ${subtitle}`}
        activeTab="route"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay }, filter),
          route: buildShameHref(BASE, { day: linkDay }, filter),
          stop: buildShameHref("/shame/stop", { day: linkDay }, filter),
        }}
        filter={{
          basePath: BASE,
          mode: filter.mode,
          includeSchool: filter.includeSchool,
          nav: { day: linkDay },
        }}
        nav={{
          kind: "day",
          weekToggleHref: buildShameHref(
            BASE,
            { window: "week", period: weekPeriodOf(serviceDate) ?? undefined },
            filter,
          ),
          basePath: BASE,
          serviceDate,
          preserved,
          hasPrev: dayNav.hasPrev,
          atFloor: dayNav.atFloor,
          hasNext: dayNav.hasNext,
          nextHref: nextDayHref,
          nextPending: dayNav.nextPending,
        }}
      />
      <ShameBoard
        layout="day"
        items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
        keyOf={(slot) => String(slot.hour)}
        emptyMessage="No route data recorded for this day."
        footerMessage="No routes were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderHourSlot}
      />
    </main>
  );
}
