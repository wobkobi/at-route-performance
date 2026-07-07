// src/app/shame/route/page.tsx
/**
 * @description Worst-route page listing the most off-schedule route per hour (day view) or per day (week view).
 */
import { FlameCount } from "@/components/FlameCount";
import { ModeIcon } from "@/components/ModeIcon";
import { ShameBoard, type ShameRowContext } from "@/components/shame/ShameBoard";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameRowDelay } from "@/components/shame/ShameRowDelay";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRouteStreaksBatch,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import {
  filterLiveHours,
  maybeFallbackDay,
  resolveActiveWeekRange,
  resolveRequestedDay,
  resolveWeekNav,
} from "@/lib/page-nav";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import {
  buildShameHref,
  countById,
  isCrownable,
  parseShameParams,
  pickWorst,
  TODAY_REVALIDATE,
  WEEK_REVALIDATE,
  type ShameSearchParams,
} from "@/lib/shame-page";
import {
  nzHourLabel,
  nzServiceDayRange,
  nzServiceDayString,
  shiftWeek,
  weekdayShort,
} from "@/lib/time";
import type { ShameRouteRow } from "@/types/dashboard";
import type { JSX } from "react";

const BASE = "/shame/route";

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
  dropTodayParam(BASE, sp);
  const { filter, isWeekView, preserved, subtitle } = parseShameParams(sp);

  if (isWeekView) {
    const periodParam = resolveRequestedDay(sp.period);
    const { activeWeekRange } = resolveActiveWeekRange(periodParam);
    const [shame, earliestDay] = await Promise.all([
      getShameRouteOfWeek(activeWeekRange, filter, WEEK_REVALIDATE),
      getEarliestDataDay(1),
    ]);
    /**
     * Build a week link for this page, preserving the active filter.
     * @param period - ISO week-start date, or null for the rolling current week.
     * @returns The week href.
     */
    const weekHref = (period: string | null): string =>
      buildShameHref(BASE, { window: "week", period: period ?? undefined }, filter);
    const { periodLabel, prevHref, nextHref } = resolveWeekNav({
      periodParam,
      earliestDay,
      makeHref: weekHref,
    });

    const worstKey = shame.worst?.date ?? null;
    const routeDayCounts = countById(shame.days, (d) => d.route_id);
    const weekNav = { window: "week" as const, period: periodParam ?? undefined };

    /**
     * Render one week-view day row.
     * @param r - The day's worst route.
     * @param ctx - Surface context from the board.
     * @returns The row anchor element.
     */
    const renderWeekRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
      const isWorst = r.date === worstKey;
      const name = r.short_name || r.long_name || routeSlug(r.route_id);
      const slug = routeSlug(r.route_id);
      // Keep the drill-down on the same fixed week: the route page's week view
      // reads ?period=, not ?day=.
      const href = `/route/${encodeURIComponent(slug)}?window=week${periodParam ? `&period=${periodParam}` : ""}`;
      const [, m, d] = (r.date ?? "").split("-");
      const dayLabel = r.date ? weekdayShort(r.date) : "";
      const dayCount = routeDayCounts.get(r.route_id) ?? 0;
      return (
        <a href={href} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
          <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
            {dayLabel} {d}/{m}
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
                  label={`${name} was the worst route on ${dayCount} days this week`}
                />
              )}
            </span>
            <span className="block text-xs text-at-muted tabular-nums">{r.events} events</span>
          </span>
          <ShameRowDelay
            avgDelaySec={r.avg_delay_sec}
            avgAbsDelaySec={r.avg_abs_delay_sec}
            mode={r.mode}
          />
        </a>
      );
    };

    return (
      <main className="space-y-6">
        <ShameHeader
          title="Worst Route of the Week"
          subtitle={`The most off-schedule route of each day · ${subtitle}`}
          activeTab="route"
          tabHrefs={{
            trip: buildShameHref("/shame/trip", weekNav, filter),
            route: buildShameHref(BASE, weekNav, filter),
            stop: buildShameHref("/shame/stop", weekNav, filter),
          }}
          nav={{
            kind: "week",
            dayToggleHref: buildShameHref(BASE, {}, filter),
            periodLabel,
            prevHref,
            nextHref,
          }}
        />
        <ShameBoard
          layout="week"
          items={shame.days}
          keyOf={(r, i) => r.date ?? String(i)}
          emptyMessage="No route data recorded for this week."
          renderRow={renderWeekRow}
        />
      </main>
    );
  }

  // Day view (default): worst route per hour.
  const requestedDay = resolveRequestedDay(sp.day);
  const initialRange = nzServiceDayRange(requestedDay ?? new Date());
  const [initialShame, earliestDay] = await Promise.all([
    getShameRouteOfDay(initialRange, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
  ]);
  let range = initialRange;
  let serviceDate = nzServiceDayString(range.start);
  let shame = initialShame;
  const fallbackDay = await maybeFallbackDay(
    requestedDay,
    shame.hours.length === 0,
    MIN_BOARD_EVENTS,
  );
  if (fallbackDay) {
    range = nzServiceDayRange(fallbackDay);
    serviceDate = nzServiceDayString(range.start);
    shame = await getShameRouteOfDay(range, filter, TODAY_REVALIDATE);
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;

  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const routeHourCounts = countById(visibleHours, (h) => h.route_id);
  const routeStreakMap = await getShameRouteStreaksBatch(
    [...routeHourCounts.keys()],
    range,
    filter,
    TODAY_REVALIDATE,
  );
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? buildShameHref(BASE, {}, filter)
      : undefined;

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
      <a href={href} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <span className="w-12 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {nzHourLabel(r.hour)}
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
                    : `${name}: worst route in ${hourCount} hours today`
                }
              />
            ) : null}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">{r.events} events</span>
        </span>
        <ShameRowDelay
          avgDelaySec={r.avg_delay_sec}
          avgAbsDelaySec={r.avg_abs_delay_sec}
          mode={r.mode}
        />
      </a>
    );
  };

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Worst Route of the Day"
        subtitle={`The most off-schedule route of each hour · ${subtitle}`}
        activeTab="route"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay }, filter),
          route: buildShameHref(BASE, { day: linkDay }, filter),
          stop: buildShameHref("/shame/stop", { day: linkDay }, filter),
        }}
        nav={{
          kind: "day",
          weekToggleHref: buildShameHref(BASE, { window: "week" }, filter),
          basePath: BASE,
          serviceDate,
          preserved,
          hasPrev: hasPrevDay,
          hasNext: hasNextDay,
          nextHref: nextDayHref,
        }}
      />
      <ShameBoard
        layout="day"
        items={visibleHours}
        keyOf={(r) => `${r.hour}-${r.route_id}`}
        emptyMessage="No route data recorded for this day."
        footerMessage="No routes were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderDayRow}
      />
    </main>
  );
}
