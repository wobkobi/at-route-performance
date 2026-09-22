// src/app/shame/stop/page.tsx
// Worst-stop page listing the most off-schedule stop per hour (day view) or per day (week view).

import { ShameBoard, ShameEmptyHourRow, type ShameRowContext } from "@/components/shame/ShameBoard";
import { ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import { ShameHeader } from "@/components/shame/ShameHeader";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getShameDayHours,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
  MIN_STOP_EVENTS_HOUR,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { clampDayParam, dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
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
import { dayRangeNav, weekPeriodOf } from "@/lib/range-page";
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
import { nzHourLabel, weekdayShort, type DateRange } from "@/lib/time";
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
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
 * Week/month board body: runs the per-day worst-stop fan-out and renders one
 * row per service day. Streams in behind the header so the shell never waits on
 * a cold period.
 * @param root0 - Props.
 * @param root0.range - The active window.
 * @param root0.filter - Active mode/school filter.
 * @param root0.periodNoun - Copy noun for the period ("week" / "month").
 * @returns The populated board.
 */
async function StopRangeBoard({
  range,
  filter,
  periodNoun,
}: {
  range: DateRange;
  filter: ShameFilter;
  periodNoun: "week" | "month";
}): Promise<JSX.Element> {
  const shame = await getWorstStopsOfWeek(range, filter, WEEK_REVALIDATE);
  const worstId = shame.worst?.stop_id ?? null;
  const stopDayCounts = countById(shame.days, (d) => d.stop_id);

  /**
   * Render one range-view day row.
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
      <Link
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
          <span className="block text-xs text-at-muted">{s.events} arrivals</span>
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
      </Link>
    );
  };

  return (
    <ShameBoard
      layout="week"
      items={shame.days}
      keyOf={(s) => s.date}
      emptyMessage={`No stop data recorded for this ${periodNoun}.`}
      renderRow={renderWeekRow}
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
  const { filter, view, preserved } = parseShameParams(sp);

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
          title={`Worst Stop of the ${isMonth ? "Month" : "Week"}`}
          subtitle="The most off-schedule stop of each day"
          activeTab="stop"
          tabHrefs={{
            trip: buildShameHref("/shame/trip", rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
            stop: buildShameHref(BASE, rangeNav, filter),
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
        <Suspense
          fallback={
            <ShameBoardSkeleton
              layout="week"
              shape={{ icon: false, mobileLines: 2, gridLines: 2 }}
            />
          }
        >
          <StopRangeBoard range={activeRange} filter={filter} periodNoun={periodNoun} />
        </Suspense>
      </main>
    );
  }

  // Day view: worst stop per hour.
  const shown = await resolveShownDay(resolveRequestedDay(sp.day));
  const { range, serviceDate } = shown;
  const [shame, earliestDay, dayHours] = await Promise.all([
    getWorstStopsOfDay(range, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
    getShameDayHours(range, filter, TODAY_REVALIDATE),
  ]);
  const dayNav = dayRangeNav(shown, earliestDay);

  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const stopHourCounts = countById(visibleHours, (h) => h.stop_id);
  const linkDay = dayNav.isToday ? undefined : serviceDate;
  // Stepping onto today drops `?day` so the URL stays canonical.
  const nextDayHref = dayNav.nextIsToday ? buildShameHref(BASE, {}, filter) : undefined;

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
      <Link
        href={`/stop/${encodeURIComponent(s.stop_id)}${linkDay ? `?day=${linkDay}` : ""}`}
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
          <span className="block text-xs text-at-muted">{s.events} arrivals</span>
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
        label={nzHourLabel(slot.hour)}
        title="No stop fits this hour"
        reason={`No stop had ${MIN_STOP_EVENTS_HOUR} arrivals this hour`}
        ctx={ctx}
      />
    );

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
        emptyMessage="No stop data recorded for this day."
        footerMessage="No stops were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderHourSlot}
      />
    </main>
  );
}
