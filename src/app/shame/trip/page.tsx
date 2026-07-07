// src/app/shame/trip/page.tsx
/**
 * @description Shame-of-the-day page listing the most off-schedule run per hour (day view) or per day (week view).
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
  getShameOfDay,
  getShameOfWeek,
  getShameRouteStreaksBatch,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import {
  filterLiveHours,
  maybeFallbackDay,
  resolveActiveWeekRange,
  resolveMonthNav,
  resolveRequestedDay,
  resolveRequestedMonth,
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
  nzClockTime,
  nzHourLabel,
  nzMonthRange,
  nzServiceDayRange,
  nzServiceDayString,
  shiftWeek,
  weekdayShort,
} from "@/lib/time";
import type { ShameTrip } from "@/types/dashboard";
import type { JSX } from "react";

const BASE = "/shame/trip";

/**
 * Trip-page href for a shamed run, scoped to the run's own instant so the
 * timeline resolves to that day's run.
 * @param t - The shamed run.
 * @returns The trip-page URL.
 */
function tripHref(t: ShameTrip): string {
  return `/route/${encodeURIComponent(routeSlug(t.route_id))}/trip/${encodeURIComponent(
    t.trip_id,
  )}?d=${encodeURIComponent(t.scheduled_start)}`;
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
  dropTodayParam(BASE, sp);
  const { filter, view, preserved, subtitle } = parseShameParams(sp);

  if (view !== "day") {
    const isMonth = view === "month";
    const periodParam = isMonth ? resolveRequestedMonth(sp.period) : resolveRequestedDay(sp.period);
    const activeRange = isMonth
      ? nzMonthRange(periodParam ?? undefined)
      : resolveActiveWeekRange(periodParam).activeWeekRange;
    const [shame, earliestDay] = await Promise.all([
      getShameOfWeek(activeRange, filter, WEEK_REVALIDATE),
      getEarliestDataDay(1),
    ]);
    /**
     * Build a link to this view for a period, preserving the active filter.
     * @param period - ISO week-start date or `YYYY-MM` month key, or null for the rolling default.
     * @returns The href.
     */
    const rangeHref = (period: string | null): string =>
      buildShameHref(BASE, { window: view, period: period ?? undefined }, filter);
    const { periodLabel, prevHref, nextHref } = isMonth
      ? resolveMonthNav({ periodParam, earliestDay, makeHref: rangeHref })
      : resolveWeekNav({ periodParam, earliestDay, makeHref: rangeHref });

    const periodNoun = isMonth ? "month" : "week";
    const worstKey = shame.worst?.date ?? null;
    const routeDayCounts = countById(shame.days, (d) => d.route_id);
    const rangeNav = { window: view, period: periodParam ?? undefined };

    /**
     * Render one week-view day row.
     * @param t - The day's worst run.
     * @param ctx - Surface context from the board.
     * @returns The row anchor element.
     */
    const renderWeekRow = (t: ShameTrip, ctx: ShameRowContext): JSX.Element => {
      const isWorst = t.date === worstKey;
      const name = t.short_name || t.long_name || routeSlug(t.route_id);
      const [, m, d] = (t.date ?? "").split("-");
      const dayLabel = t.date ? weekdayShort(t.date) : "";
      const dayCount = routeDayCounts.get(t.route_id) ?? 0;
      return (
        <a href={tripHref(t)} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
          <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
            {dayLabel} {d}/{m}
          </span>
          <ModeIcon
            mode={t.mode}
            shortName={t.short_name}
            longName={t.long_name}
            colour={t.colour}
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
                  label={`${name} appeared as the worst trip on ${dayCount} days this ${periodNoun}`}
                />
              )}
            </span>
            <span className="block text-xs text-at-muted tabular-nums">
              {t.headsign && /\D/.test(t.headsign) ? `to ${t.headsign} · ` : ""}
              {nzClockTime(t.scheduled_start)} · {t.stops} stops
            </span>
          </span>
          <ShameRowDelay
            avgDelaySec={t.avg_delay_sec}
            avgAbsDelaySec={t.avg_abs_delay_sec}
            mode={t.mode}
          />
        </a>
      );
    };

    return (
      <main className="space-y-6">
        <ShameHeader
          title={`Shame of the ${isMonth ? "Month" : "Week"}`}
          subtitle={`The most off-schedule run of each day · ${subtitle}`}
          activeTab="trip"
          tabHrefs={{
            trip: buildShameHref(BASE, rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
            stop: buildShameHref("/shame/stop", rangeNav, filter),
          }}
          nav={{
            kind: "week",
            unit: periodNoun,
            dayToggleHref: buildShameHref(BASE, {}, filter),
            periodLabel,
            prevHref,
            nextHref,
          }}
        />
        <ShameBoard
          layout="week"
          items={shame.days}
          keyOf={(t, i) => t.date ?? String(i)}
          emptyMessage={`No runs recorded for this ${periodNoun}.`}
          renderRow={renderWeekRow}
        />
      </main>
    );
  }

  // Day view (default): worst trip per hour.
  const requestedDay = resolveRequestedDay(sp.day);
  const initialRange = nzServiceDayRange(requestedDay ?? new Date());
  const [initialShame, earliestDay] = await Promise.all([
    getShameOfDay(initialRange, filter, TODAY_REVALIDATE),
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
    shame = await getShameOfDay(range, filter, TODAY_REVALIDATE);
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
  const worstKey = worst && isCrownable(worst) ? `${worst.hour}-${worst.trip_id}` : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;

  /**
   * Render one day-view hour row.
   * @param t - The hour's worst run.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderDayRow = (t: ShameTrip, ctx: ShameRowContext): JSX.Element => {
    const isWorst = worstKey === `${t.hour}-${t.trip_id}`;
    const name = t.short_name || t.long_name || routeSlug(t.route_id);
    const hourCount = routeHourCounts.get(t.route_id) ?? 0;
    const streakInfo = routeStreakMap.get(t.route_id);
    const streakDays = streakInfo?.count ?? 1;
    const totalHours = hourCount + (streakInfo?.prevHours ?? 0);
    const worstOfDayStreak = (isWorst ? 1 : 0) + (streakInfo?.prevWorstOfDayDays ?? 0);
    return (
      <a href={tripHref(t)} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <span className="w-12 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {nzHourLabel(t.hour)}
        </span>
        <ModeIcon
          mode={t.mode}
          shortName={t.short_name}
          longName={t.long_name}
          colour={t.colour}
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
                label={`${name} appeared in ${hourCount} hourly slots today`}
              />
            ) : null}
          </span>
          <span className="block text-xs text-at-muted tabular-nums">
            {t.headsign && /\D/.test(t.headsign) ? `to ${t.headsign} · ` : ""}
            {nzClockTime(t.scheduled_start)} · {t.stops} stops
          </span>
        </span>
        <ShameRowDelay
          avgDelaySec={t.avg_delay_sec}
          avgAbsDelaySec={t.avg_abs_delay_sec}
          mode={t.mode}
        />
      </a>
    );
  };

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Shame of the Day"
        subtitle={`The most off-schedule run of each hour · ${subtitle}`}
        activeTab="trip"
        tabHrefs={{
          trip: buildShameHref(BASE, { day: linkDay }, filter),
          route: buildShameHref("/shame/route", { day: linkDay }, filter),
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
        keyOf={(t) => `${t.hour}-${t.trip_id}`}
        emptyMessage="No runs recorded for this day."
        footerMessage="No runs were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderDayRow}
      />
    </main>
  );
}
