// src/app/shame/trip/page.tsx
// Shame-of-the-day page listing the most off-schedule run per hour (day view) or per day (week view).

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
  getShameOfDay,
  getShameOfWeek,
  getShameRouteStreaksBatch,
  SHAME_MIN_STOPS,
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
import { dayRangeNav, periodInPhrase, weekPeriodOf, windowPhrase } from "@/lib/range-page";
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
import { nzClockTime, weekdayShort, type DateRange } from "@/lib/time";
import type { ShameTrip } from "@/types/dashboard";
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
  const card = parseShameCard("trip", (await searchParams) ?? {});
  const title = listCardTitle(card);
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
function tripHref(t: ShameTrip): string {
  return `/route/${encodeURIComponent(routeSlug(t.route_id))}/trip/${encodeURIComponent(
    t.trip_id,
  )}?d=${encodeURIComponent(t.scheduled_start)}`;
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
  periodNoun: "week" | "month";
  periodWhen: string;
}): Promise<JSX.Element> {
  const shame = await getShameOfWeek(range, filter, WEEK_REVALIDATE);
  const worstKey = shame.worst?.date ?? null;
  const routeDayCounts = countById(shame.days, (d) => d.route_id);

  /**
   * Render one range-view day row.
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
      <Link href={tripHref(t)} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
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
                label={`${name} appeared as the worst trip on ${dayCount} days in ${periodWhen}`}
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
      </Link>
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
          title={`Worst trips of the ${periodNoun}`}
          subtitle={`The most off-schedule run of each day · ${subtitle}`}
          activeTab="trip"
          tabHrefs={{
            trip: buildShameHref(BASE, rangeNav, filter),
            route: buildShameHref("/shame/route", rangeNav, filter),
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
        <Suspense
          fallback={
            <ShameBoardSkeleton
              layout="week"
              shape={{ icon: true, mobileLines: 4, gridLines: 2 }}
            />
          }
        >
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
  const shown = await resolveShownDay(resolveRequestedDay(sp.day));
  const { range, serviceDate } = shown;
  const [shame, earliestDay, dayHours] = await Promise.all([
    getShameOfDay(range, filter, TODAY_REVALIDATE),
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
      <Link href={tripHref(t)} className={cn(ctx.anchorClass, isWorst && "bg-at-late/5")}>
        <ShameHourLabel hour={t.hour} serviceDate={serviceDate} />
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
                label={`${name} appeared in ${hourCount} hourly slots ${dayWhen}`}
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
      </Link>
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
    <main className="space-y-6">
      <ShameHeader
        title="Worst trips of the day"
        subtitle={`The most off-schedule run of each hour · ${subtitle}`}
        activeTab="trip"
        tabHrefs={{
          trip: buildShameHref(BASE, { day: linkDay }, filter),
          route: buildShameHref("/shame/route", { day: linkDay }, filter),
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
        emptyMessage="No runs recorded for this day."
        footerMessage="No runs were notably off-schedule during these hours."
        showFooter={noneNotablyBad}
        renderRow={renderHourSlot}
      />
    </main>
  );
}
