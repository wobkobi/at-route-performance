// src/app/shame/route/page.tsx
// Worst-route page listing the most off-schedule route per hour (day view) or per day (week view).

import { LoadingBlock } from "@/components/Loading";
import { FlameCount } from "@/components/shame/FlameCount";
import {
  hourSlotRenderer,
  ShameBoard,
  ShameDayFlame,
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
  getFilterUsage,
  getLatestEventDate,
  getRouteBoardInHours,
  getRouteBoardOfDay,
  getRouteBoardOfWeek,
  getShameDayHours,
  getShameStreaks,
  MIN_ROUTE_EVENTS_HOUR,
  PERIOD_REVALIDATE,
  SHAME_RANKED_LIMIT,
  TODAY_REVALIDATE,
} from "@/lib/data";
import { formatCount, plural } from "@/lib/format";
import { cardPath, listShareCard, pageMetadata, parseShameCard, shameHeading } from "@/lib/og";
import { routeHref } from "@/lib/page/hrefs";
import {
  fillServiceHours,
  filterLiveHours,
  noHourStarted,
  resolveRequestedDay,
  resolveShownDay,
  serviceHourSpan,
} from "@/lib/page/nav";
import {
  dayRangeNav,
  periodInPhrase,
  periodRangeNav,
  routeLinkParams,
  weekPeriodOf,
  windowPhrase,
} from "@/lib/page/range";
import {
  buildShameHref,
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
  type ShameFilter,
  type ShameSearchParams,
} from "@/lib/page/shame";
import { routeDisplayName, routeSlug, routeSubtitle } from "@/lib/route/slug";
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
import type { ShameRouteRow } from "@/types/dashboard";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type JSX } from "react";

// Not yet converted to a prerendered shell: this segment still reads its
// search params and its data above any Suspense boundary, so it is allowed to
// block. Removing this line is what converts the route.
export const instant = false;

/**
 * The ranked board's heading, for the tab and the page alike.
 * @param hours - The picked hours.
 * @returns The heading.
 */
function rankedTitle(hours: HourRange): string {
  return `Worst ${SHAME_RANKED_LIMIT} routes · ${shameHoursLabel(hours)}`;
}

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
  const { hours, view } = parseShameParams(sp);
  const description =
    "The most off-schedule route of each hour or day on Auckland's buses, trains and ferries.";
  return pageMetadata({
    title: hours ? rankedTitle(hours) : shameHeading("route", view),
    description,
    card: hours ? { title: rankedTitle(hours), path: cardPath(card) } : listShareCard(card),
  });
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
  const shame = await getRouteBoardOfWeek(range, filter, PERIOD_REVALIDATE);
  const periodNoun = isMonth ? "month" : "week";
  const worstKey = shame.worst?.date ?? null;
  const routeDayCounts = countBy(shame.days, (d) => d.routeId);

  /**
   * Render one range-view day row.
   * @param r - The day's worst route.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderWeekRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
    const isWorst = r.date === worstKey;
    const name = routeDisplayName(r);
    const slug = routeSlug(r.routeId);
    // Open the route's week view either way: a week row keeps the board's week
    // (rolling or fixed), and a month row opens the week holding its day, since
    // the route page has no month window.
    const weekPeriod = isMonth && r.date ? weekPeriodOf(r.date) : periodParam;
    const href = routeHref(slug, routeLinkParams("week", null, weekPeriod));
    const dayCount = routeDayCounts.get(r.routeId) ?? 0;
    return (
      <ShameSplitRow
        ctx={ctx}
        worst={isWorst}
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
        <ShameRowBody
          route={r}
          subject={<ShameSubjectLink href={href}>{name}</ShameSubjectLink>}
          subtitle={routeSubtitle(r)}
          worst={isWorst}
          flame={
            dayCount > 1 && (
              <FlameCount
                kind="crown"
                count={dayCount}
                worst={isWorst}
                label={`${name} was the worst route on ${dayCount} days in ${periodInPhrase(
                  periodNoun,
                  periodParam,
                )}`}
              />
            )
          }
          detail={plural(r.events, "arrival")}
          figures={r}
        />
      </ShameSplitRow>
    );
  };

  return (
    <ShameBoard
      items={shame.days}
      keyOf={(r, i) => r.date ?? String(i)}
      emptyMessage={`No routes recorded in ${periodInPhrase(periodNoun, periodParam)}.`}
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
    getRouteBoardOfDay(range, filter, TODAY_REVALIDATE),
    getShameDayHours(range, filter, TODAY_REVALIDATE),
  ]);
  const visibleHours = filterLiveHours(shame.hours, serviceDate);
  const daySpan = serviceHourSpan(dayHours);
  const routeHourCounts = countBy(visibleHours, (h) => h.routeId);
  const routeStreakMap = await getShameStreaks("route", [...routeHourCounts.keys()], range, filter);

  const worst = pickWorst(visibleHours);
  const worstKey = worst && isCrownable(worst) ? `${worst.hour}-${worst.routeId}` : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;

  /**
   * Render one day-view hour row.
   * @param r - The hour's worst route.
   * @param ctx - Surface context from the board.
   * @returns The row anchor element.
   */
  const renderDayRow = (r: ShameRouteRow, ctx: ShameRowContext): JSX.Element => {
    const isWorst = worstKey === `${r.hour}-${r.routeId}`;
    const name = routeDisplayName(r);
    const slug = routeSlug(r.routeId);
    // The row is one hour's, so the route page opens on that hour: its whole-day
    // figures are a different number under the same route name.
    const href = routeHref(slug, {
      day: linkDay,
      [HOURS_PARAM]: hourRangeParam(singleHourRange(r.hour)),
    });
    const hourCount = routeHourCounts.get(r.routeId) ?? 0;
    return (
      <ShameSplitRow
        ctx={ctx}
        worst={isWorst}
        label={
          <ShameHourLabel
            hour={r.hour}
            serviceDate={serviceDate}
            href={shameHourHref(BASE, linkDay, r.hour, filter)}
            linkLabel={`Worst ${SHAME_RANKED_LIMIT} routes in the ${nzHourLabel(r.hour)} hour`}
          />
        }
      >
        <ShameRowBody
          route={r}
          subject={<ShameSubjectLink href={href}>{name}</ShameSubjectLink>}
          subtitle={routeSubtitle(r)}
          worst={isWorst}
          flame={
            <ShameDayFlame
              name={name}
              noun="route"
              worst={isWorst}
              hourCount={hourCount}
              streak={routeStreakMap.get(r.routeId)}
              hoursLabel={
                isWorst
                  ? `${name}: worst route of the day · worst in ${hourCount} hours`
                  : `${name}: worst route in ${hourCount} hours ${dayWhen}`
              }
            />
          }
          detail={plural(r.events, "arrival")}
          figures={r}
        />
      </ShameSplitRow>
    );
  };

  const renderHourSlot = hourSlotRenderer(renderDayRow, {
    serviceDate,
    title: "No route fits this hour",
    reason: `No route had ${MIN_ROUTE_EVENTS_HOUR} arrivals from trips starting this hour`,
  });

  return (
    <ShameBoard
      items={visibleHours.length > 0 ? fillServiceHours(visibleHours, serviceDate, daySpan) : []}
      keyOf={(slot) => String(slot.hour)}
      emptyMessage={`No routes recorded ${dayWhen}.`}
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
  const { rows, total } = await getRouteBoardInHours(range, filter, hours, TODAY_REVALIDATE);
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
    const href = routeHref(r.routeId, {
      day: linkDay,
      [HOURS_PARAM]: hourRangeParam(isWholeDay(hours) ? null : hours),
    });
    return (
      <Link href={href} className={cn(ctx.anchorClass, isWorst && "at-worst")}>
        <ShameRankLabel rank={rank} />
        <ShameRowBody
          route={r}
          subject={<span className="font-semibold text-at-ink">{routeDisplayName(r)}</span>}
          subtitle={routeSubtitle(r)}
          worst={isWorst}
          detail={plural(r.events, "arrival")}
          figures={r}
        />
      </Link>
    );
  };

  return (
    <ShameBoard
      items={rows}
      keyOf={(r) => r.routeId}
      emptyMessage={
        noHourStarted(hoursInRange(hours), serviceDate)
          ? notStartedMessage(hours)
          : `No route had ${MIN_ROUTE_EVENTS_HOUR} arrivals from trips starting ${hoursNoun(hours)}.`
      }
      footerMessage={`Showing the worst ${SHAME_RANKED_LIMIT} of ${formatCount(total)} routes.`}
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
  const { filter, view, subtitle, hours } = parseShameParams(sp);
  if (view === "day") {
    clampDayParam(BASE, sp, today);
    dropTodayParam(BASE, sp, today);
  }

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
    const isMonth = view === "month";
    const rangeNav = { window: view, period: periodParam ?? undefined };

    return (
      <main className="space-y-4">
        <ShameHeader
          title={shameHeading("route", view)}
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
  const linkDay = dayLinkParam(serviceDate, today);

  return (
    <main className="space-y-4">
      <ShameHeader
        title={hours ? rankedTitle(hours) : shameHeading("route", "day")}
        subtitle={
          hours
            ? `The most off-schedule routes over trips starting ${hoursNoun(hours)} · ${subtitle}`
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
