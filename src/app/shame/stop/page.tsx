// src/app/shame/stop/page.tsx
import { DayNav } from "@/components/DayNav";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
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
import type { ShameDayStop, ShameStop } from "@/types/dashboard";
import type { JSX } from "react";

const TODAY_REVALIDATE = 300;
const WEEK_REVALIDATE = 3600;

/** Query params for the Stop Shame page. */
interface StopShameSearchParams {
  day?: string;
  mode?: string;
  school?: string;
  window?: string;
  period?: string;
}

/**
 * Build a shame-page URL preserving the active mode/school filter params.
 * @param nav - Window, period, and day params to include.
 * @param nav.window - `day`, `week`, or `month`.
 * @param nav.period - ISO week-start date when `window` is `week`.
 * @param nav.day - ISO service date for past-day day-view links.
 * @param filter - Active mode/school filter.
 * @param filter.mode - Route mode string, or null for all modes.
 * @param filter.includeSchool - Whether school services are included.
 * @param base - Base path (default `/shame/stop`).
 * @returns The href.
 */
function buildHref(
  nav: { window?: string; period?: string; day?: string },
  filter: { mode: string | null; includeSchool: boolean },
  base = "/shame/stop",
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
  searchParams?: Promise<StopShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  dropTodayParam("/shame/stop", sp);
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as
    "BUS" | "TRAIN" | "FERRY" | null;
  const includeSchool = sp.school === "1";
  const filter = { mode, includeSchool };
  const isWeekView = sp.window === "week";

  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  if (includeSchool) preserved.school = "1";

  if (isWeekView) {
    const periodParam = sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : null;
    const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
    const activeWeekRange = fixedWeekRange ?? nzLast7DaysRange(new Date());
    const [shame, earliestDay] = await Promise.all([
      getWorstStopsOfWeek(activeWeekRange, filter, WEEK_REVALIDATE),
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

    const worstId = shame.worst?.stop_id ?? null;
    const stopDayCounts = new Map<string, number>();
    for (const d of shame.days) {
      stopDayCounts.set(d.stop_id, (stopDayCounts.get(d.stop_id) ?? 0) + 1);
    }
    const weekNav = { window: "week" as const, period: periodParam ?? undefined };

    return (
      <main className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
              Worst Stop of the Week
            </h1>
            <p className="mt-0.5 text-sm text-at-muted">The most off-schedule stop of each day</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <a href={buildHref(weekNav, filter, "/shame/trip")} className="chip chip-off">
                Trips
              </a>
              <a href={buildHref(weekNav, filter, "/shame/route")} className="chip chip-off">
                Routes
              </a>
              <a href={buildHref(weekNav, filter)} className="chip chip-on">
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
            No stop data recorded for this week.
          </p>
        ) : (
          <div className="border border-at-border bg-at-surface">
            <ul>
              {shame.days.map((s, i) => (
                <DayStopRow
                  key={s.date}
                  stop={s}
                  isWorst={s.stop_id === worstId}
                  index={i}
                  weekCount={stopDayCounts.get(s.stop_id) ?? 0}
                />
              ))}
            </ul>
          </div>
        )}
      </main>
    );
  }

  // Day view: worst stop per hour.
  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  const [initialShame, earliestDay] = await Promise.all([
    getWorstStopsOfDay(range, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
  ]);
  let shame = initialShame;
  if (!requestedDay && shame.hours.length === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      shame = await getWorstStopsOfDay(range, filter, TODAY_REVALIDATE);
    }
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;

  // Future-hour filter for today's live view.
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

  const worstVisible = visibleHours.reduce<typeof shame.worst>(
    (w, h) => (w == null || h.avg_abs_delay_sec > w.avg_abs_delay_sec ? h : w),
    null,
  );
  const worstId =
    worstVisible && worstVisible.avg_abs_delay_sec > ON_TIME_LATE_SEC ? worstVisible.stop_id : null;
  const noneNotablyBad = visibleHours.length > 0 && worstId === null;
  const stopHourCounts = new Map<string, number>();
  for (const h of visibleHours) {
    stopHourCounts.set(h.stop_id, (stopHourCounts.get(h.stop_id) ?? 0) + 1);
  }
  const linkDay = serviceDate !== nzServiceDayString() ? serviceDate : undefined;
  const nextDayHref =
    hasNextDay && shiftWeek(serviceDate, 1) === nzServiceDayString()
      ? buildHref({}, filter)
      : undefined;

  const ITEMS_PER_COL = 10;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
            Worst Stop of the Day
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">The most off-schedule stop of each hour</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <a href={buildHref({ day: linkDay }, filter, "/shame/trip")} className="chip chip-off">
              Trips
            </a>
            <a href={buildHref({ day: linkDay }, filter, "/shame/route")} className="chip chip-off">
              Routes
            </a>
            <a href={buildHref({ day: linkDay }, filter)} className="chip chip-on">
              Stops
            </a>
          </div>
          <a href={buildHref({ window: "week" }, filter)} className="chip chip-off text-sm">
            Week
          </a>
          <DayNav
            basePath="/shame/stop"
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
          No stop data recorded for this day.
        </p>
      ) : (
        <div className="border border-at-border bg-at-surface">
          {/* Mobile: sequential single-column list */}
          <ul className="md:hidden">
            {visibleHours.map((s, i) => (
              <HourStopRow
                key={`${s.hour}-${s.stop_id}`}
                stop={s}
                isWorst={s.stop_id === worstId}
                index={i}
                hourCount={stopHourCounts.get(s.stop_id) ?? 0}
              />
            ))}
          </ul>
          {/*
            Desktop: explicit CSS Grid placement so col1[i] and col2[i] share
            the same grid row. The browser equalises their height, keeping the
            horizontal dividers aligned across both columns.
          */}
          <ul className="hidden md:grid md:grid-cols-2">
            {visibleHours.map((s, i) => {
              const isRight = i >= ITEMS_PER_COL;
              const rowIdx = isRight ? i - ITEMS_PER_COL : i;
              const isWorstRow = s.stop_id === worstId;
              const hourCount = stopHourCounts.get(s.stop_id) ?? 0;
              return (
                <li
                  key={`${s.hour}-${s.stop_id}`}
                  className={cn(
                    rowIdx > 0 && "border-t border-at-border",
                    isRight && "border-l border-at-border",
                  )}
                  style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
                >
                  <a
                    href={`/stop/${encodeURIComponent(s.stop_id)}`}
                    className={cn(
                      "flex h-full items-start gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
                      isWorstRow && "bg-at-late/5",
                    )}
                  >
                    <span className="w-12 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
                      {nzHourLabel(s.hour)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-at-ink">{s.name}</span>
                        {isWorstRow && (
                          <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                            Worst
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-at-muted">{s.events} events</span>
                      {hourCount > 1 && (
                        <span className="block text-xs text-at-muted">
                          {s.name} was bad {hourCount === 2 ? "twice" : `${hourCount} times`} today
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {noneNotablyBad && (
        <p className="border border-at-border bg-at-surface px-4 py-3 text-sm text-at-muted">
          No stops were notably off-schedule during these hours.
        </p>
      )}
    </main>
  );
}

/**
 * Single row for the day view (worst stop per hour).
 * @param props - Row props.
 * @param props.stop - The stop entry.
 * @param props.isWorst - Whether this is the day's overall worst stop.
 * @param props.index - Position within its column (drives the border).
 * @param props.hourCount - Number of hours this stop appeared in today's shame list.
 * @returns The list item element.
 */
function HourStopRow({
  stop: s,
  isWorst,
  index,
  hourCount,
}: {
  stop: ShameStop;
  isWorst: boolean;
  index: number;
  hourCount: number;
}): JSX.Element {
  return (
    <li>
      <a
        href={`/stop/${encodeURIComponent(s.stop_id)}`}
        className={cn(
          "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
          index > 0 && "border-t border-at-border",
          isWorst && "bg-at-late/5",
        )}
      >
        <span className="w-12 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {nzHourLabel(s.hour)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{s.name}</span>
            {isWorst && (
              <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                Worst
              </span>
            )}
          </span>
          <span className="block text-xs text-at-muted">{s.events} events</span>
          {hourCount > 1 && (
            <span className="block text-xs text-at-muted">
              {s.name} was bad {hourCount === 2 ? "twice" : `${hourCount} times`} today
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
    </li>
  );
}

/**
 * Single row for the week view (worst stop per service day).
 * @param props - Row props.
 * @param props.stop - The day stop entry.
 * @param props.isWorst - Whether this is the week's overall worst stop.
 * @param props.index - Row index (drives the border).
 * @param props.weekCount - Number of days this stop appeared in this week's shame list.
 * @returns The list item element.
 */
function DayStopRow({
  stop: s,
  isWorst,
  index,
  weekCount,
}: {
  stop: ShameDayStop;
  isWorst: boolean;
  index: number;
  weekCount: number;
}): JSX.Element {
  const [, m, d] = s.date.split("-");
  const dayLabel = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
  }).format(new Date(s.date + "T12:00:00Z"));
  return (
    <li>
      <a
        href={`/stop/${encodeURIComponent(s.stop_id)}?day=${s.date}`}
        className={cn(
          "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
          index > 0 && "border-t border-at-border",
          isWorst && "bg-at-late/5",
        )}
      >
        <span className="w-16 shrink-0 pt-px text-sm font-semibold text-at-muted tabular-nums">
          {dayLabel} {d}/{m}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold text-at-ink">{s.name}</span>
            {isWorst && (
              <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                Worst
              </span>
            )}
          </span>
          <span className="block text-xs text-at-muted">{s.events} events</span>
          {weekCount > 1 && (
            <span className="block text-xs text-at-muted">
              {s.name} was bad {weekCount === 2 ? "twice" : `${weekCount} times`} this week
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
    </li>
  );
}
