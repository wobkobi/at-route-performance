// src/app/shame/stop/page.tsx
import { DayNav } from "@/components/DayNav";
import { cn } from "@/lib/cn";
import {
  getEarliestDataDay,
  getMostRecentDataDay,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
} from "@/lib/data";
import { dropTodayParam } from "@/lib/day-url";
import { formatDuration } from "@/lib/format";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import {
  nzHourLabel,
  nzLast7DaysRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
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
 * Build a stop-shame-page URL preserving the active mode/school filter params.
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
  return `/shame/stop${qs ? `?${qs}` : ""}`;
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
    | "BUS"
    | "TRAIN"
    | "FERRY"
    | null;
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

    return (
      <main className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
              Worst Stop of the Week
            </h1>
            <p className="mt-0.5 text-sm text-at-muted">The most off-schedule stop of each day</p>
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
            No stop data recorded for this week.
          </p>
        ) : (
          <div className="border border-at-border bg-at-surface">
            <ul>
              {shame.days.map((s, i) => (
                <DayStopRow key={s.date} stop={s} isWorst={s.stop_id === worstId} index={i} />
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
  const worstId = shame.worst?.stop_id ?? null;

  const ITEMS_PER_COL = 10;
  const col1 = shame.hours.slice(0, ITEMS_PER_COL);
  const col2 = shame.hours.slice(ITEMS_PER_COL, ITEMS_PER_COL * 2);

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-ultra tracking-zero text-at-late sm:text-3xl">
            Worst Stop of the Day
          </h1>
          <p className="mt-0.5 text-sm text-at-muted">The most off-schedule stop of each hour</p>
        </div>
        <div className="flex items-center gap-3">
          <a href={buildHref({ window: "week" }, filter)} className="chip chip-off text-sm">
            Week
          </a>
          <DayNav
            basePath="/shame/stop"
            serviceDate={serviceDate}
            preservedParams={preserved}
            hasPrev={hasPrevDay}
            hasNext={hasNextDay}
          />
        </div>
      </header>

      {shame.hours.length === 0 ? (
        <p className="border border-at-border bg-at-surface p-4 text-at-muted">
          No stop data recorded for this day.
        </p>
      ) : (
        <div className="border border-at-border bg-at-surface">
          <div className="grid grid-cols-1 md:grid-cols-2">
            <ul>
              {col1.map((s, i) => (
                <HourStopRow
                  key={`${s.hour}-${s.stop_id}`}
                  stop={s}
                  isWorst={s.stop_id === worstId}
                  index={i}
                />
              ))}
            </ul>
            {col2.length > 0 && (
              <ul className="border-t border-at-border md:border-t-0 md:border-l">
                {col2.map((s, i) => (
                  <HourStopRow
                    key={`${s.hour}-${s.stop_id}`}
                    stop={s}
                    isWorst={s.stop_id === worstId}
                    index={i}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
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
 * @returns The list item element.
 */
function HourStopRow({
  stop: s,
  isWorst,
  index,
}: {
  stop: ShameStop;
  isWorst: boolean;
  index: number;
}): JSX.Element {
  return (
    <li>
      <a
        href={`/stop/${encodeURIComponent(s.stop_id)}`}
        className={cn(
          "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
          index > 0 && "border-t border-at-border",
          isWorst && "bg-at-late/5",
        )}
      >
        <span className="w-12 shrink-0 text-sm font-semibold text-at-muted tabular-nums">
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
        </span>
        <span className="shrink-0 font-semibold text-at-late tabular-nums">
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
 * @returns The list item element.
 */
function DayStopRow({
  stop: s,
  isWorst,
  index,
}: {
  stop: ShameDayStop;
  isWorst: boolean;
  index: number;
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
          "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale",
          index > 0 && "border-t border-at-border",
          isWorst && "bg-at-late/5",
        )}
      >
        <span className="w-16 shrink-0 text-sm font-semibold text-at-muted tabular-nums">
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
        </span>
        <span className="shrink-0 font-semibold text-at-late tabular-nums">
          {formatDuration(s.avg_abs_delay_sec)} off
        </span>
      </a>
    </li>
  );
}
