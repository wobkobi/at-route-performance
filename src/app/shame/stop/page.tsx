// src/app/shame/stop/page.tsx
/**
 * @description Worst-stop page listing the most off-schedule stop per hour (day view) or per day (week view).
 */
import { ShameBoard, type ShameRowContext } from "@/components/shame/ShameBoard";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { cn } from "@/lib/cn";
import { getEarliestDataDay, getWorstStopsOfDay, getWorstStopsOfWeek } from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
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
  nzMonthRange,
  nzServiceDayRange,
  nzServiceDayString,
  shiftWeek,
  weekdayShort,
} from "@/lib/time";
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
import type { JSX } from "react";

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
  dropTodayParam(BASE, sp);
  const { filter, view, preserved } = parseShameParams(sp);

  if (view !== "day") {
    const isMonth = view === "month";
    const monthParam = isMonth ? resolveRequestedMonth(sp.period) : null;
    const periodParam = isMonth ? null : resolveRequestedDay(sp.period);
    const activeRange = isMonth
      ? nzMonthRange(monthParam ?? undefined)
      : resolveActiveWeekRange(periodParam).activeWeekRange;
    const [shame, earliestDay] = await Promise.all([
      getWorstStopsOfWeek(activeRange, filter, WEEK_REVALIDATE),
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
      ? resolveMonthNav({ periodParam: monthParam, earliestDay, makeHref: rangeHref })
      : resolveWeekNav({ periodParam, earliestDay, makeHref: rangeHref });

    const periodNoun = isMonth ? "month" : "week";
    const worstId = shame.worst?.stop_id ?? null;
    const stopDayCounts = countById(shame.days, (d) => d.stop_id);
    const rangeNav = { window: view, period: (isMonth ? monthParam : periodParam) ?? undefined };

    /**
     * Render one week-view day row.
     * @param s - The day's worst stop.
     * @param ctx - Surface context from the board.
     * @returns The row anchor element.
     */
    const renderWeekRow = (s: ShameDayStop, ctx: ShameRowContext): JSX.Element => {
      const isWorst = s.stop_id === worstId;
      const [, m, d] = s.date.split("-");
      const dayLabel = weekdayShort(s.date);
      const weekCount = stopDayCounts.get(s.stop_id) ?? 0;
      return (
        <a
          href={`/stop/${encodeURIComponent(s.stop_id)}?day=${s.date}`}
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
            <span className="block text-xs text-at-muted">{s.events} events</span>
            {weekCount > 1 && (
              <span className="block text-xs text-at-muted">
                {s.name} was bad {badTimes(weekCount)} this {periodNoun}
              </span>
            )}
          </span>
          <span
            className="shrink-0 cursor-help pt-px font-semibold text-at-late tabular-nums"
            title="Average deviation from the scheduled arrival time"
          >
            {formatDuration(s.avg_abs_delay_sec)} off
          </span>
        </a>
      );
    };

    return (
      <main className="space-y-6">
        <ShameHeader
          title={`Worst Stop of the ${isMonth ? "Month" : "Week"}`}
          subtitle="The most off-schedule stop of each day"
          activeTab="stop"
          tabHrefs={{
            trip: buildShameHref("/shame/trip", rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
            stop: buildShameHref(BASE, rangeNav, filter),
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
          keyOf={(s) => s.date}
          emptyMessage={`No stop data recorded for this ${periodNoun}.`}
          renderRow={renderWeekRow}
        />
      </main>
    );
  }

  // Day view: worst stop per hour.
  const requestedDay = resolveRequestedDay(sp.day);
  const initialRange = nzServiceDayRange(requestedDay ?? new Date());
  const [initialShame, earliestDay] = await Promise.all([
    getWorstStopsOfDay(initialRange, filter, TODAY_REVALIDATE),
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
    shame = await getWorstStopsOfDay(range, filter, TODAY_REVALIDATE);
  }

  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;

  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const stopHourCounts = countById(visibleHours, (h) => h.stop_id);
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? buildShameHref(BASE, {}, filter)
      : undefined;

  const worst = pickWorst(visibleHours);
  const worstId = worst && isCrownable(worst) ? worst.stop_id : null;
  const noneNotablyBad = visibleHours.length > 0 && worstId === null;

  /**
   * Render one day-view hour row.
   * @param s - The hour's worst stop.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderDayRow = (s: ShameStop, ctx: ShameRowContext): JSX.Element => {
    const isWorst = s.stop_id === worstId;
    const hourCount = stopHourCounts.get(s.stop_id) ?? 0;
    return (
      <a
        href={`/stop/${encodeURIComponent(s.stop_id)}`}
        className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}
      >
        <span className="w-12 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {nzHourLabel(s.hour)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{s.name}</span>
            {isWorst && <ShameWorstBadge />}
          </span>
          <span className="block text-xs text-at-muted">{s.events} events</span>
          {hourCount > 1 && (
            <span className="block text-xs text-at-muted">
              {s.name} was bad {badTimes(hourCount)} today
            </span>
          )}
        </span>
        <span
          className="shrink-0 cursor-help pt-px font-semibold text-at-late tabular-nums"
          title="Average deviation from the scheduled arrival time"
        >
          {formatDuration(s.avg_abs_delay_sec)} off
        </span>
      </a>
    );
  };

  return (
    <main className="space-y-6">
      <ShameHeader
        title="Worst Stop of the Day"
        subtitle="The most off-schedule stop of each hour"
        activeTab="stop"
        tabHrefs={{
          trip: buildShameHref("/shame/trip", { day: linkDay }, filter),
          route: buildShameHref("/shame/route", { day: linkDay }, filter),
          stop: buildShameHref(BASE, { day: linkDay }, filter),
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
        keyOf={(s) => `${s.hour}-${s.stop_id}`}
        emptyMessage="No stop data recorded for this day."
        footerMessage="No stops were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderDayRow}
      />
    </main>
  );
}
