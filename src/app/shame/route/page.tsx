// src/app/shame/route/page.tsx
import { DayNav } from "@/components/DayNav";
import { FlameCount } from "@/components/FlameCount";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRouteStreaksBatch,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDelay, formatDuration } from "@/lib/format";
import { isOnTime, ON_TIME_LATE_SEC } from "@/lib/on-time";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import {
  nzHourLabel,
  nzLast7DaysRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";
import type { ShameRouteRow } from "@/types/dashboard";
import type { JSX } from "react";

const TODAY_REVALIDATE = 300;
const WEEK_REVALIDATE = 3600;

/** Human label for an active mode/school filter, for the page subtitle. */
const MODE_LABEL: Record<string, string> = { BUS: "Buses", TRAIN: "Trains", FERRY: "Ferries" };

/** Query params for the Route Shame page. */
interface RouteShameSearchParams {
  day?: string;
  mode?: string;
  school?: string;
  window?: string;
  period?: string;
}

/**
 * Build a shame-page URL preserving the active mode/school filter params.
 * @param nav - Window, period, and day params to include.
 * @param nav.window - `week` when in week view.
 * @param nav.period - ISO week-start date when `window` is `week`.
 * @param nav.day - ISO service date for past-day day-view links.
 * @param filter - Active mode/school filter.
 * @param filter.mode - Route mode string, or null for all modes.
 * @param filter.includeSchool - Whether school services are included.
 * @param base - Base path (default `/shame/route`).
 * @returns The href.
 */
function buildHref(
  nav: { window?: string; period?: string; day?: string },
  filter: { mode: string | null; includeSchool: boolean },
  base = "/shame/route",
): string {
  const p = new URLSearchParams();
  if (nav.window) p.set("window", nav.window);
  if (nav.period) p.set("period", nav.period);
  if (nav.day) p.set("day", nav.day);
  if (filter.mode) p.set("mode", filter.mode);
  if (filter.includeSchool) p.set("school", "1");
  const qs = p.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
}

/**
 * Route-shame page: the worst route for each hour (day view) or service day
 * (week view), derived from arrival-event deviation aggregates. Mirrors the
 * trip shame page but groups by route rather than individual trip.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `window`, `period`).
 * @returns Page markup.
 */
export default async function RoutesShamePage({
  searchParams,
}: {
  searchParams?: Promise<RouteShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  dropTodayParam("/shame/route", sp);
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as
    "BUS" | "TRAIN" | "FERRY" | null;
  const includeSchool = sp.school === "1";
  const filter = { mode, includeSchool };
  const isWeekView = sp.window === "week";

  const subtitle = mode
    ? MODE_LABEL[mode]
    : includeSchool
      ? "All services"
      : "Buses, trains & ferries";

  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  if (includeSchool) preserved.school = "1";

  if (isWeekView) {
    const periodParam = sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : null;
    const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
    const activeWeekRange = fixedWeekRange ?? nzLast7DaysRange(new Date());
    const [shame, earliestDay] = await Promise.all([
      getShameRouteOfWeek(activeWeekRange, filter, WEEK_REVALIDATE),
      getEarliestDataDay(1),
    ]);
    const periodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";
    const thisWeekStart = nzWeekStart(new Date());
    const prevWeek = shiftWeek(periodParam ?? thisWeekStart, -7);
    const earliestWeekStart = earliestDay ? nzWeekStart(earliestDay) : null;
    const prevHref =
      !earliestWeekStart || prevWeek >= earliestWeekStart
        ? buildHref({ window: "week", period: prevWeek }, filter)
        : null;
    let nextHref: string | null = null;
    if (periodParam) {
      const nextWeek = shiftWeek(periodParam, 7);
      nextHref =
        nextWeek >= thisWeekStart
          ? buildHref({ window: "week" }, filter)
          : buildHref({ window: "week", period: nextWeek }, filter);
    }

    const worstKey = shame.worst?.date ?? null;
    const routeDayCounts = new Map<string, number>();
    for (const d of shame.days) {
      routeDayCounts.set(d.route_id, (routeDayCounts.get(d.route_id) ?? 0) + 1);
    }
    const weekNav = { window: "week" as const, period: periodParam ?? undefined };

    return (
      <main className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
              Worst Route of the Week
            </h1>
            <p className="mt-0.5 text-sm text-at-muted">
              The most off-schedule route of each day · {subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <a href={buildHref(weekNav, filter, "/shame/trip")} className="chip chip-off">
                Trips
              </a>
              <a href={buildHref(weekNav, filter)} className="chip chip-on">
                Routes
              </a>
              <a href={buildHref(weekNav, filter, "/shame/stop")} className="chip chip-off">
                Stops
              </a>
            </div>
            <a href={buildHref({}, filter)} className="chip chip-off text-sm">
              Day
            </a>
            <div className="flex items-center gap-1">
              {prevHref ? (
                <a
                  href={prevHref}
                  aria-label="Previous week"
                  className="chip chip-off flex items-center"
                >
                  <ChevronLeft className="block h-4 w-4" />
                </a>
              ) : null}
              <span className="px-1 text-sm font-semibold tabular-nums">{periodLabel}</span>
              {nextHref ? (
                <a
                  href={nextHref}
                  aria-label="Next week"
                  className="chip chip-off flex items-center"
                >
                  <ChevronRight className="block h-4 w-4" />
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {shame.days.length === 0 ? (
          <p className="border border-at-border bg-at-surface p-4 text-at-muted">
            No route data recorded for this week.
          </p>
        ) : (
          <div className="border border-at-border bg-at-surface">
            <ul>
              {shame.days.map((r, i) => {
                const isWorst = r.date === worstKey;
                const name = r.short_name || r.long_name || routeSlug(r.route_id);
                const slug = routeSlug(r.route_id);
                const href = `/route/${encodeURIComponent(slug)}?window=week${periodParam ? `&day=${r.date}` : ""}`;
                const [, m, d] = (r.date ?? "").split("-");
                const dayLabel = r.date
                  ? new Intl.DateTimeFormat("en-NZ", {
                      timeZone: "Pacific/Auckland",
                      weekday: "short",
                    }).format(new Date(r.date + "T12:00:00Z"))
                  : "";
                const dateLabel = `${d}/${m}`;
                const dayCount = routeDayCounts.get(r.route_id) ?? 0;
                return (
                  <li key={r.date ?? i}>
                    <a
                      href={href}
                      className={cn(
                        "flex items-start gap-3 border-t border-at-border px-4 py-3 transition-colors hover:bg-at-shore-pale",
                        isWorst && "bg-at-late/5",
                      )}
                    >
                      <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
                        {dayLabel} {dateLabel}
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
                          {isWorst && (
                            <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                              Worst
                            </span>
                          )}
                          {dayCount > 1 && (
                            <FlameCount
                              tier="week"
                              count={dayCount}
                              worst={isWorst}
                              label={`${name} was the worst route on ${dayCount} days this week`}
                            />
                          )}
                        </span>
                        <span className="block text-xs text-at-muted tabular-nums">
                          {r.events} events
                        </span>
                      </span>
                      <span className="shrink-0 pt-px text-right">
                        <span
                          className={`block font-semibold tabular-nums ${
                            Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                              ? "cursor-help text-at-ink"
                              : isOnTime(r.avg_delay_sec, r.mode)
                                ? "text-at-ontime"
                                : r.avg_delay_sec < 0
                                  ? "text-at-early"
                                  : "text-at-late"
                          }`}
                          title={
                            Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                              ? "Some services ran early, some ran late — shows absolute average deviation from schedule"
                              : undefined
                          }
                        >
                          {Math.abs(r.avg_delay_sec) >= r.avg_abs_delay_sec * 0.5
                            ? formatDelay(r.avg_delay_sec, { mode: r.mode })
                            : `${formatDuration(r.avg_abs_delay_sec)} off`}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    );
  }

  // Day view (default): worst route per hour.
  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  const [initialShame, earliestDay] = await Promise.all([
    getShameRouteOfDay(range, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
  ]);
  let shame = initialShame;
  if (!requestedDay && shame.hours.length === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      shame = await getShameRouteOfDay(range, filter, TODAY_REVALIDATE);
    }
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;

  // For today's live view, drop hours that haven't started yet so that
  // AT realtime predicted-future slots don't show as phantom on-time entries.
  const isLiveDay = serviceDate === nzServiceDayString();
  const nowHourNZ = isLiveDay
    ? parseInt(
        new Intl.DateTimeFormat("en-NZ", {
          hour: "2-digit",
          hour12: false,
          timeZone: "Pacific/Auckland",
        }).format(new Date()),
        10,
      )
    : -1;
  const visibleHours = isLiveDay
    ? shame.hours.filter((h) => (h.hour >= 5 ? h.hour <= nowHourNZ : nowHourNZ < 5))
    : shame.hours;

  const routeHourCounts = new Map<string, number>();
  for (const h of visibleHours) {
    routeHourCounts.set(h.route_id, (routeHourCounts.get(h.route_id) ?? 0) + 1);
  }
  const uniqueRouteIds = [...routeHourCounts.keys()];
  const routeStreakMap = await getShameRouteStreaksBatch(
    uniqueRouteIds,
    range,
    filter,
    TODAY_REVALIDATE,
  );
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? buildHref({}, filter)
      : undefined;

  const worstVisible = visibleHours.reduce<ShameRouteRow | null>(
    (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
    null,
  );
  // Only crown a WORST if the top route is genuinely off-schedule (avg abs
  // deviation above the on-time threshold). On quiet days every route may be
  // within the on-time window - in that case no badge is shown.
  const worstKey =
    worstVisible && worstVisible.avg_abs_delay_sec > ON_TIME_LATE_SEC
      ? `${worstVisible.hour}-${worstVisible.route_id}`
      : null;
  const noneNotablyBad = visibleHours.length > 0 && worstKey === null;
  const ITEMS_PER_COL = 10;

  /**
   * Render one hour row.
   * @param r - The shame route row.
   * @returns The list item element.
   */
  function renderRow(r: ShameRouteRow): JSX.Element {
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
      <li key={`${r.hour}-${r.route_id}`}>
        <a
          href={href}
          className={cn(
            "flex items-start gap-3 border-t border-at-border px-4 py-3 transition-colors hover:bg-at-shore-pale",
            isWorst && "bg-at-late/5",
          )}
        >
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
              {isWorst && (
                <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                  Worst
                </span>
              )}
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
          <span className="shrink-0 pt-px text-right">
            <span
              className={`block font-semibold tabular-nums ${
                Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                  ? "cursor-help text-at-ink"
                  : isOnTime(r.avg_delay_sec, r.mode)
                    ? "text-at-ontime"
                    : r.avg_delay_sec < 0
                      ? "text-at-early"
                      : "text-at-late"
              }`}
              title={
                Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                  ? "Some services ran early, some ran late — shows absolute average deviation from schedule"
                  : undefined
              }
            >
              {Math.abs(r.avg_delay_sec) >= r.avg_abs_delay_sec * 0.5
                ? formatDelay(r.avg_delay_sec, { mode: r.mode })
                : `${formatDuration(r.avg_abs_delay_sec)} off`}
            </span>
          </span>
        </a>
      </li>
    );
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
            Worst Route of the Day
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">
            The most off-schedule route of each hour · {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <a href={buildHref({ day: linkDay }, filter, "/shame/trip")} className="chip chip-off">
              Trips
            </a>
            <a href={buildHref({ day: linkDay }, filter)} className="chip chip-on">
              Routes
            </a>
            <a href={buildHref({ day: linkDay }, filter, "/shame/stop")} className="chip chip-off">
              Stops
            </a>
          </div>
          <a href={buildHref({ window: "week" }, filter)} className="chip chip-off text-sm">
            Week
          </a>
          <DayNav
            basePath="/shame/route"
            serviceDate={serviceDate}
            preservedParams={preserved}
            hasPrev={hasPrevDay}
            hasNext={hasNextDay}
            nextHref={nextDayHref}
          />
        </div>
      </header>

      {visibleHours.length === 0 ? (
        <p className="border border-at-border bg-at-surface p-4 text-at-muted">
          No route data recorded for this day.
        </p>
      ) : (
        <div className="border border-at-border bg-at-surface">
          {/* Mobile: sequential single-column list */}
          <ul className="md:hidden">{visibleHours.map((r) => renderRow(r))}</ul>
          {/*
            Desktop: explicit CSS Grid placement so col1[i] and col2[i] share
            the same grid row. The browser equalises their height, keeping the
            horizontal dividers aligned across both columns.
          */}
          <ul className="hidden md:grid md:grid-cols-2">
            {visibleHours.map((r, i) => {
              const isRight = i >= ITEMS_PER_COL;
              const rowIdx = isRight ? i - ITEMS_PER_COL : i;
              const isWorstRow = worstKey === `${r.hour}-${r.route_id}`;
              const name = r.short_name || r.long_name || routeSlug(r.route_id);
              const slug = routeSlug(r.route_id);
              const href = linkDay
                ? `/route/${encodeURIComponent(slug)}?day=${linkDay}`
                : `/route/${encodeURIComponent(slug)}`;
              const hourCount = routeHourCounts.get(r.route_id) ?? 0;
              const dStreakInfo = routeStreakMap.get(r.route_id);
              const streakDays = dStreakInfo?.count ?? 1;
              const dTotalHours = hourCount + (dStreakInfo?.prevHours ?? 0);
              const dWorstOfDayStreak =
                (isWorstRow ? 1 : 0) + (dStreakInfo?.prevWorstOfDayDays ?? 0);
              return (
                <li
                  key={`${r.hour}-${r.route_id}`}
                  className={cn(
                    rowIdx > 0 && "border-t border-at-border",
                    isRight && "border-l border-at-border",
                  )}
                  style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
                >
                  <a
                    href={href}
                    className={cn(
                      "flex h-full items-start gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
                      isWorstRow && "bg-at-late/5",
                    )}
                  >
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
                        {isWorstRow && (
                          <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                            Worst
                          </span>
                        )}
                        {dWorstOfDayStreak >= 2 ? (
                          <FlameCount
                            tier="streak"
                            count={dWorstOfDayStreak}
                            worst={isWorstRow}
                            label={`${name}: worst of the day ${dWorstOfDayStreak} days in a row · ${dTotalHours} hours total`}
                          />
                        ) : streakDays >= 2 ? (
                          <FlameCount
                            tier="streak"
                            count={streakDays}
                            worst={isWorstRow}
                            label={`${name}: on the shame list ${streakDays} days in a row · ${dTotalHours} hours total`}
                          />
                        ) : hourCount > 1 ? (
                          <FlameCount
                            tier="day"
                            count={hourCount}
                            worst={isWorstRow}
                            label={
                              isWorstRow
                                ? `${name}: worst route of the day · worst in ${hourCount} hours`
                                : `${name}: worst route in ${hourCount} hours today`
                            }
                          />
                        ) : null}
                      </span>
                      <span className="block text-xs text-at-muted tabular-nums">
                        {r.events} events
                      </span>
                    </span>
                    <span className="shrink-0 pt-px text-right">
                      <span
                        className={`block font-semibold tabular-nums ${
                          Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                            ? "cursor-help text-at-ink"
                            : isOnTime(r.avg_delay_sec, r.mode)
                              ? "text-at-ontime"
                              : r.avg_delay_sec < 0
                                ? "text-at-early"
                                : "text-at-late"
                        }`}
                        title={
                          Math.abs(r.avg_delay_sec) < r.avg_abs_delay_sec * 0.5
                            ? "Some services ran early, some ran late — shows absolute average deviation from schedule"
                            : undefined
                        }
                      >
                        {Math.abs(r.avg_delay_sec) >= r.avg_abs_delay_sec * 0.5
                          ? formatDelay(r.avg_delay_sec, { mode: r.mode })
                          : `${formatDuration(r.avg_abs_delay_sec)} off`}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {noneNotablyBad && (
        <p className="border border-at-border bg-at-surface px-4 py-3 text-sm text-at-muted">
          No routes were notably off-schedule during these hours.
        </p>
      )}
    </main>
  );
}
