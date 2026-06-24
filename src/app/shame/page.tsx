// src/app/shame/page.tsx
import { DayNav } from "@/components/DayNav";
import { ModeIcon } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getShameOfDay,
  getShameOfWeek,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDelay, formatDuration } from "@/lib/format";
import { isOnTime } from "@/lib/on-time";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import { routeSlug } from "@/lib/route-slug";
import {
  nzClockTime,
  nzHourLabel,
  nzLast7DaysRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  type DateRange,
} from "@/lib/time";
import type { ShameTrip } from "@/types/dashboard";
import type { JSX } from "react";

const TODAY_REVALIDATE = 300; // 5 minutes
const WEEK_REVALIDATE = 3600;

/** Query params for the Shame page. */
interface ShameSearchParams {
  day?: string;
  mode?: string;
  school?: string;
  window?: string;
  period?: string;
}

/** Human label for an active mode/school filter, for the page subtitle. */
const MODE_LABEL: Record<string, string> = { BUS: "Buses", TRAIN: "Trains", FERRY: "Ferries" };

/**
 * Shift a `YYYY-MM-DD` date string by `days` calendar days (UTC arithmetic).
 * @param ymd - Source date.
 * @param days - Days to add (negative steps back).
 * @returns The shifted `YYYY-MM-DD`.
 */
function shiftWeek(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Auckland-local day/month and year parts of a UTC instant.
 * @param d - UTC instant.
 * @returns `{ dm: "DD/MM", y: "YYYY" }`.
 */
function dmY(d: Date): { dm: string; y: string } {
  const o: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d)) {
    o[part.type] = part.value;
  }
  return { dm: `${o.day}/${o.month}`, y: o.year };
}

/**
 * Week label as `DD/MM to DD/MM`, adding the year on both sides only when the
 * week straddles New Year.
 * @param range - Half-open week range (`end` is the exclusive next Monday).
 * @returns The range label.
 */
function weekRangeLabel(range: DateRange): string {
  const first = dmY(range.start);
  const last = dmY(new Date(range.end.getTime() - 86_400_000));
  return first.y === last.y
    ? `${first.dm} to ${last.dm}`
    : `${first.dm}/${first.y} to ${last.dm}/${last.y}`;
}

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
 * each service day (week view). Day-focused by default, falling back to the most
 * recent day with data; stepping back through calendar weeks is supported via
 * `?window=week&period=YYYY-MM-DD`.
 * @param root0 - Page props.
 * @param root0.searchParams - Optional query params (`day`, `window`, `period`).
 * @returns Page markup.
 */
export default async function ShamePage({
  searchParams,
}: {
  searchParams?: Promise<ShameSearchParams>;
}): Promise<JSX.Element> {
  const sp = (await searchParams) ?? {};
  dropTodayParam("/shame", sp);
  // Mirror the home page's mode/school filters so the worst stays in step.
  const mode = (["BUS", "TRAIN", "FERRY"].includes(sp.mode ?? "") ? sp.mode : null) as
    | "BUS"
    | "TRAIN"
    | "FERRY"
    | null;
  const includeSchool = sp.school === "1";
  const filter = { mode, includeSchool };
  const isWeekView = sp.window === "week";

  const subtitle = mode
    ? MODE_LABEL[mode]
    : includeSchool
      ? "All services"
      : "Buses, trains & ferries";

  // Preserved filter params for navigation links.
  const preserved: Record<string, string> = {};
  if (mode) preserved.mode = mode;
  if (includeSchool) preserved.school = "1";

  if (isWeekView) {
    // Week view: show worst trip per service day for the selected or rolling week.
    const periodParam = sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : null;
    const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
    const activeWeekRange = fixedWeekRange ?? nzLast7DaysRange(new Date());
    const [shame, earliestDay] = await Promise.all([
      getShameOfWeek(activeWeekRange, filter, WEEK_REVALIDATE),
      getEarliestDataDay(1),
    ]);
    const periodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";
    const thisWeekStart = nzWeekStart(new Date());
    const prevWeek = shiftWeek(periodParam ?? thisWeekStart, -7);
    // weekRange is only used for label; `activeWeekRange` drives the query above.
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

    return (
      <main className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
              Shame of the Week
            </h1>
            <p className="mt-0.5 text-sm text-at-muted">
              The most off-schedule run of each day · {subtitle}
            </p>
          </div>
          <div className="flex items-center gap-3">
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
                  <ChevronLeftIcon />
                </a>
              ) : null}
              <span className="px-1 text-sm font-semibold tabular-nums">{periodLabel}</span>
              {nextHref ? (
                <a
                  href={nextHref}
                  aria-label="Next week"
                  className="chip chip-off flex items-center"
                >
                  <ChevronRightIcon />
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {shame.days.length === 0 ? (
          <p className="border border-at-border bg-at-surface p-4 text-at-muted">
            No runs recorded for this week.
          </p>
        ) : (
          <div className="border border-at-border bg-at-surface">
            <ul>
              {shame.days.map((t, i) => {
                const isWorst = t.date === worstKey;
                const name = t.short_name || t.long_name || routeSlug(t.route_id);
                const [, m, d] = (t.date ?? "").split("-");
                const dayLabel = t.date
                  ? new Intl.DateTimeFormat("en-NZ", {
                      timeZone: "Pacific/Auckland",
                      weekday: "short",
                    }).format(new Date(t.date + "T12:00:00Z"))
                  : "";
                const dateLabel = `${d}/${m}`;
                return (
                  <li key={t.date ?? i}>
                    <a
                      href={tripHref(t)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
                        i > 0 && "border-t border-at-border",
                        isWorst && "bg-at-late/5",
                      )}
                    >
                      <span className="w-16 shrink-0 text-sm font-semibold text-at-muted tabular-nums">
                        {dayLabel} {dateLabel}
                      </span>
                      <ModeIcon
                        mode={t.mode}
                        shortName={t.short_name}
                        longName={t.long_name}
                        colour={t.colour}
                        className="h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-at-ink">{name}</span>
                          {t.headsign && (
                            <span className="text-sm text-at-muted">to {t.headsign}</span>
                          )}
                          {isWorst && (
                            <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                              Worst
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-at-muted tabular-nums">
                          {nzClockTime(t.scheduled_start)} · {t.stops} stops
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={`block font-semibold tabular-nums ${
                            isOnTime(t.avg_delay_sec ?? 0, t.mode)
                              ? "text-at-ontime"
                              : (t.avg_delay_sec ?? 0) < 0
                                ? "text-at-early"
                                : "text-at-late"
                          }`}
                        >
                          {Math.round(t.avg_abs_delay_sec) === Math.abs(Math.round(t.avg_delay_sec))
                            ? formatDelay(t.avg_delay_sec, { mode: t.mode })
                            : `${formatDuration(t.avg_abs_delay_sec)} off`}
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

  // Day view (default): worst trip per hour.
  const requestedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  let range: DateRange = nzServiceDayRange(requestedDay ?? new Date());
  let serviceDate = nzServiceDayString(range.start);
  const [initialShame, earliestDay] = await Promise.all([
    getShameOfDay(range, filter, TODAY_REVALIDATE),
    getEarliestDataDay(1),
  ]);
  let shame = initialShame;
  if (!requestedDay && shame.hours.length === 0) {
    const latestDay = await getMostRecentDataDay(MIN_BOARD_EVENTS);
    if (latestDay) {
      range = nzServiceDayRange(latestDay);
      serviceDate = nzServiceDayString(range.start);
      shame = await getShameOfDay(range, filter, TODAY_REVALIDATE);
    }
  }
  const hasNextDay = serviceDate < nzServiceDayString();
  const hasPrevDay = earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false;

  const worstKey = shame.worst ? `${shame.worst.hour}-${shame.worst.trip_id}` : null;
  const ITEMS_PER_COL = 10;
  const col1 = shame.hours.slice(0, ITEMS_PER_COL);
  const col2 = shame.hours.slice(ITEMS_PER_COL, ITEMS_PER_COL * 2);

  /**
   * Render one hour row.
   * @param t - The shame trip.
   * @param i - Index within its column (drives the top border).
   * @returns The list item element.
   */
  function renderRow(t: ShameTrip, i: number): JSX.Element {
    const isWorst = worstKey === `${t.hour}-${t.trip_id}`;
    const name = t.short_name || t.long_name || routeSlug(t.route_id);
    return (
      <li key={`${t.hour}-${t.trip_id}`}>
        <a
          href={tripHref(t)}
          className={cn(
            "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
            i > 0 && "border-t border-at-border",
            isWorst && "bg-at-late/5",
          )}
        >
          <span className="w-12 shrink-0 text-sm font-semibold text-at-muted tabular-nums">
            {nzHourLabel(t.hour)}
          </span>
          <ModeIcon
            mode={t.mode}
            shortName={t.short_name}
            longName={t.long_name}
            colour={t.colour}
            className="h-5 w-5 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-semibold text-at-ink">{name}</span>
              {t.headsign && <span className="text-sm text-at-muted">to {t.headsign}</span>}
              {isWorst && (
                <span className="bg-at-late px-1.5 py-0.5 text-[10px] font-bold tracking-zero text-white uppercase">
                  Worst
                </span>
              )}
            </span>
            <span className="block text-xs text-at-muted tabular-nums">
              {nzClockTime(t.scheduled_start)} · {t.stops} stops
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span
              className={`block font-semibold tabular-nums ${
                isOnTime(t.avg_delay_sec ?? 0, t.mode)
                  ? "text-at-ontime"
                  : (t.avg_delay_sec ?? 0) < 0
                    ? "text-at-early"
                    : "text-at-late"
              }`}
            >
              {Math.round(t.avg_abs_delay_sec) === Math.abs(Math.round(t.avg_delay_sec))
                ? formatDelay(t.avg_delay_sec, { mode: t.mode })
                : `${formatDuration(t.avg_abs_delay_sec)} off`}
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
            Shame of the Day
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">
            The most off-schedule run of each hour · {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href={buildHref({ window: "week" }, filter)} className="chip chip-off text-sm">
            Week
          </a>
          <DayNav
            basePath="/shame"
            serviceDate={serviceDate}
            preservedParams={preserved}
            hasPrev={hasPrevDay}
            hasNext={hasNextDay}
          />
        </div>
      </header>

      {shame.hours.length === 0 ? (
        <p className="border border-at-border bg-at-surface p-4 text-at-muted">
          No runs recorded for this day.
        </p>
      ) : (
        <div className="border border-at-border bg-at-surface">
          <div className="grid grid-cols-1 md:grid-cols-2">
            <ul>{col1.map((t, i) => renderRow(t, i))}</ul>
            {col2.length > 0 && (
              <ul className="border-t border-at-border md:border-t-0 md:border-l">
                {col2.map((t, i) => renderRow(t, i))}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Build a shame-page URL preserving the active mode/school filter params.
 * @param nav - Window and period params to include.
 * @param nav.window - `day`, `week`, or `month`.
 * @param nav.period - ISO week-start date when `window` is `week`.
 * @param filter - Active mode/school filter.
 * @param filter.mode - Route mode string, or null for all modes.
 * @param filter.includeSchool - Whether school services are included.
 * @returns The href.
 */
function buildHref(
  nav: { window?: string; period?: string },
  filter: { mode: string | null; includeSchool: boolean },
): string {
  const p = new URLSearchParams();
  if (nav.window) p.set("window", nav.window);
  if (nav.period) p.set("period", nav.period);
  if (filter.mode) p.set("mode", filter.mode);
  if (filter.includeSchool) p.set("school", "1");
  const qs = p.toString();
  return `/shame${qs ? `?${qs}` : ""}`;
}

/**
 * Inline left-chevron SVG icon.
 * @returns Left-chevron SVG.
 */
function ChevronLeftIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="block h-4 w-4">
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Inline right-chevron SVG icon.
 * @returns Right-chevron SVG.
 */
function ChevronRightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="block h-4 w-4">
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}
