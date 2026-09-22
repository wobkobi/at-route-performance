// src/lib/page-nav.ts
// Pure day and week navigation helpers shared across the shame and
// route pages: validate `?day=`/`?period=` params, resolve the active week
// window (a fixed calendar week or the rolling last seven service days), and
// build the prev/next stepper bounded by the earliest day with data and the
// present week. Two subtleties: on a live (today) view, hours that have not
// started yet are dropped so AT's predicted-future slots don't show as phantom
// on-time entries; and the shown-day resolver lazily imports the data layer so
// these helpers stay pure and unit-testable.
import { clampRangeToDataStart, DATA_START_DAY } from "@/lib/data-start";
import { MIN_BOARD_EVENTS } from "@/lib/rankings";
import {
  monthRangeLabel,
  NZ_TZ,
  nzLast7DaysRange,
  nzMonthKey,
  nzMonthRange,
  nzServiceDayRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  SERVICE_START_HOUR,
  shiftMonth,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";

/** Matches an ISO `YYYY-MM-DD` date string, capturing year, month and day. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Matches an ISO `YYYY-MM` month key with a real month number. */
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validate a `?period=` query value as an ISO `YYYY-MM` month key.
 * @param value - The raw query value, if any.
 * @returns The value when it is a valid month key, else null.
 */
export function resolveRequestedMonth(value: string | undefined): string | null {
  return value && ISO_MONTH.test(value) ? value : null;
}

/**
 * Validate a `?day=` / `?period=` query value as an ISO `YYYY-MM-DD` date.
 * Rejects shape-valid but impossible dates (2026-02-31): `Date.UTC` would
 * silently normalise those onto a different day, so the components must
 * round-trip unchanged.
 * @param value - The raw query value, if any.
 * @returns The value when it is a real calendar date, else null.
 */
export function resolveRequestedDay(value: string | undefined): string | null {
  if (!value) return null;
  const [, ys, ms, ds] = ISO_DATE.exec(value) ?? [];
  if (ys === undefined || ms === undefined || ds === undefined) return null;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real ? value : null;
}

/**
 * Drop hours that have not started yet on a live (today) day, so AT realtime
 * predicted-future slots don't show as phantom on-time entries. A no-op for any
 * past day. The service day runs 4am > 4am, so its post-midnight hours (0-3)
 * come chronologically LAST: before the boundary the daytime hours have all
 * happened (the previous calendar evening) plus the post-midnight hours up to
 * now, while from the boundary onward only the hours up to now have.
 * @param hours - The day's hourly rows (each carrying its `hour` of day, 0-23).
 * @param serviceDate - The service date being shown (`YYYY-MM-DD`).
 * @param now - The current instant (injectable for tests).
 * @returns The hours visible right now.
 */
export function filterLiveHours<H extends { hour: number }>(
  hours: H[],
  serviceDate: string,
  now: Date = new Date(),
): H[] {
  if (serviceDate !== nzServiceDayString(now)) return hours;
  const nowHourNZ = parseInt(
    new Intl.DateTimeFormat("en-NZ", {
      hour: "2-digit",
      hour12: false,
      timeZone: NZ_TZ,
    }).format(now),
    10,
  );
  // The constant, not a literal 4, so the next move needs no second sweep.
  return hours.filter((h) =>
    nowHourNZ < SERVICE_START_HOUR
      ? h.hour >= SERVICE_START_HOUR || h.hour <= nowHourNZ
      : h.hour >= SERVICE_START_HOUR && h.hour <= nowHourNZ,
  );
}

/** One hour of a day board: the hour of day and its row, or null when nothing qualified. */
export interface HourSlot<H> {
  hour: number;
  row: H | null;
}

/** The first and last hour of day a set of boards covers, in service order. */
export interface HourSpan {
  first: number;
  last: number;
}

/**
 * Position of an hour of day within the service day: 4am is 0, 3am is 23.
 * @param hour - Hour of day, 0-23.
 * @returns The hour's service-order index.
 */
function serviceOrder(hour: number): number {
  return (hour - SERVICE_START_HOUR + 24) % 24;
}

/**
 * The span of hours covered by any of the given hours, earliest and latest in
 * service order, so 1am counts as later than 11pm.
 * @param hours - Hours of day holding a row on any board.
 * @returns The span, or null when there are no hours.
 */
export function serviceHourSpan(hours: number[]): HourSpan | null {
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => serviceOrder(a) - serviceOrder(b));
  return { first: sorted[0] ?? SERVICE_START_HOUR, last: sorted.at(-1) ?? SERVICE_START_HOUR };
}

/**
 * Every started hour of the span, in service order, each paired with its row or
 * null. The span comes from all three day boards, so the trips, routes and stops
 * boards cover the same hours and a board with a gap says so rather than
 * skipping the hour or ending early.
 * @param rows - The day's hourly rows, at most one per hour.
 * @param serviceDate - The service date being shown (`YYYY-MM-DD`).
 * @param span - The hours to cover; null falls back to the rows' own span.
 * @param now - The current instant (injectable for tests).
 * @returns One slot per started hour of the span, in service order.
 */
export function fillServiceHours<H extends { hour: number }>(
  rows: H[],
  serviceDate: string,
  span: HourSpan | null,
  now: Date = new Date(),
): HourSlot<H>[] {
  const cover = span ?? serviceHourSpan(rows.map((r) => r.hour));
  if (!cover) return [];
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const start = serviceOrder(cover.first);
  const dayHours = Array.from({ length: serviceOrder(cover.last) - start + 1 }, (_, i) => ({
    hour: (SERVICE_START_HOUR + start + i) % 24,
  }));
  return filterLiveHours(dayHours, serviceDate, now).map(({ hour }) => ({
    hour,
    row: byHour.get(hour) ?? null,
  }));
}

/**
 * Resolve the active week window: a fixed calendar week when `?period=` is set,
 * else the rolling last seven service days.
 * @param periodParam - Validated ISO week-start date, or null for the rolling window.
 * @param now - The current instant (injectable for tests).
 * @returns The fixed week range (null when rolling) and the active range to query.
 */
export function resolveActiveWeekRange(
  periodParam: string | null,
  now: Date = new Date(),
): { fixedWeekRange: DateRange | null; activeWeekRange: DateRange } {
  const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
  return {
    fixedWeekRange,
    activeWeekRange: clampRangeToDataStart(fixedWeekRange ?? nzLast7DaysRange(now)),
  };
}

/** The prev/next week-stepper links and the period label for a week view. */
export interface WeekNav {
  /** Human label for the active period ("Last 7 days" or "DD/MM to DD/MM"). */
  periodLabel: string;
  /** Previous-week link, or null at the earliest data. */
  prevHref: string | null;
  /** Next-week link, or null when already at the present week. */
  nextHref: string | null;
  /**
   * Whether the period starts before the archive floor, so the label can say it
   * covers only part of the period it names.
   */
  partial: boolean;
}

/**
 * Compute the week stepper: the period label plus prev/next links, bounded by
 * the earliest day with data on one side and the present week on the other.
 * Pure given `now`; the area-specific URL shape is supplied via `makeHref`.
 * @param root0 - Inputs.
 * @param root0.periodParam - Validated ISO week-start date, or null for the rolling window.
 * @param root0.earliestDay - Earliest service day with data, or null when unknown.
 * @param root0.makeHref - Builds a week link for a period (null = the rolling current week).
 * @param root0.now - The current instant (injectable for tests).
 * @returns The label and the bounded prev/next links.
 */
export function resolveWeekNav({
  periodParam,
  earliestDay,
  makeHref,
  now = new Date(),
}: {
  periodParam: string | null;
  earliestDay: Date | null;
  makeHref: (period: string | null) => string;
  now?: Date;
}): WeekNav {
  const fixedWeekRange = periodParam ? nzWeekRange(periodParam) : null;
  const periodLabel = fixedWeekRange ? weekRangeLabel(fixedWeekRange) : "Last 7 days";
  // Partial is about coverage, not reachability: the bounds below still come
  // from earliestDay, so a caller with an earliest day of its own keeps it.
  const partial =
    (fixedWeekRange ?? nzLast7DaysRange(now)).start < nzServiceDayRange(DATA_START_DAY).start;
  const thisWeekStart = nzWeekStart(now);
  const prevWeek = shiftWeek(periodParam ?? thisWeekStart, -7);
  const earliestWeekStart = earliestDay ? nzWeekStart(earliestDay) : null;
  const prevHref = !earliestWeekStart || prevWeek >= earliestWeekStart ? makeHref(prevWeek) : null;
  let nextHref: string | null = null;
  if (periodParam) {
    const nextWeek = shiftWeek(periodParam, 7);
    nextHref = nextWeek >= thisWeekStart ? makeHref(null) : makeHref(nextWeek);
  }
  return { periodLabel, prevHref, nextHref, partial };
}

/**
 * Compute the month stepper: the period label plus prev/next links, bounded by
 * the earliest month with data on one side and the present month on the other.
 * Mirrors {@link resolveWeekNav} for `window=month` views.
 * @param root0 - Inputs.
 * @param root0.periodParam - Validated `YYYY-MM` month key, or null for the current month.
 * @param root0.earliestDay - Earliest service day with data, or null when unknown.
 * @param root0.makeHref - Builds a month link for a period (null = the current month).
 * @param root0.now - The current instant (injectable for tests).
 * @returns The label and the bounded prev/next links.
 */
export function resolveMonthNav({
  periodParam,
  earliestDay,
  makeHref,
  now = new Date(),
}: {
  periodParam: string | null;
  earliestDay: Date | null;
  makeHref: (period: string | null) => string;
  now?: Date;
}): WeekNav {
  const currentKey = nzMonthKey(now);
  const activeKey = periodParam ?? currentKey;
  const periodLabel = monthRangeLabel(nzMonthRange(activeKey));
  const partial = nzMonthRange(activeKey).start < nzServiceDayRange(DATA_START_DAY).start;
  const prevMonth = shiftMonth(activeKey, -1);
  const earliestKey = earliestDay ? nzMonthKey(earliestDay) : null;
  const prevHref = !earliestKey || prevMonth >= earliestKey ? makeHref(prevMonth) : null;
  let nextHref: string | null = null;
  if (periodParam && periodParam < currentKey) {
    const nextMonth = shiftMonth(periodParam, 1);
    nextHref = nextMonth >= currentKey ? makeHref(null) : makeHref(nextMonth);
  }
  return { periodLabel, prevHref, nextHref, partial };
}

/** Resolved state for a week or month board view: range, label and stepper. */
export interface RangeViewNav extends WeekNav {
  /** Whether the month variant is active. */
  isMonth: boolean;
  /** Copy noun for the period ("week" / "month"). */
  periodNoun: "week" | "month";
  /** Validated period param (week-start date or month key), or null for the rolling default. */
  periodParam: string | null;
  /** The half-open window to query. */
  activeRange: DateRange;
}

/**
 * Resolve everything a week/month board needs from its raw `?period=` value:
 * the validated period, the window to query, and the bounded stepper. Shared by
 * the three shame boards so the view plumbing lives in one place.
 * @param view - The active non-day view.
 * @param rawPeriod - The raw `?period=` query value, if any.
 * @param earliestDay - Earliest service day with data, or null when unknown.
 * @param makeHref - Builds a link for a period (null = the rolling default).
 * @returns The resolved view state.
 */
export function resolveRangeView(
  view: "week" | "month",
  rawPeriod: string | undefined,
  earliestDay: Date | null,
  makeHref: (period: string | null) => string,
): RangeViewNav {
  const isMonth = view === "month";
  const periodParam = isMonth ? resolveRequestedMonth(rawPeriod) : resolveRequestedDay(rawPeriod);
  const activeRange = isMonth
    ? clampRangeToDataStart(nzMonthRange(periodParam ?? undefined))
    : resolveActiveWeekRange(periodParam).activeWeekRange;
  const nav = isMonth
    ? resolveMonthNav({ periodParam, earliestDay, makeHref })
    : resolveWeekNav({ periodParam, earliestDay, makeHref });
  return { isMonth, periodNoun: isMonth ? "month" : "week", periodParam, activeRange, ...nav };
}

/** The service day a day view shows. */
export interface ShownDay {
  /** The shown service date (`YYYY-MM-DD`). */
  serviceDate: string;
  /** Its 4am-to-4am window. */
  range: DateRange;
  /**
   * Whether the next day is the current one and it has not opened yet. Its bare
   * URL would fall back to this same day, so the page offers no next day and
   * says why instead.
   */
  nextPending: boolean;
}

/**
 * The service day a day view shows. An asked-for `?day` is shown as it is.
 * Without one, every page and shared-link card answers the same way: the
 * current service day once it has opened (see `currentDayIsOpen`), otherwise
 * the latest earlier day with enough data for the boards. One network-wide
 * test rather than each page asking whether its own board is empty, so the
 * home page, the shame boards and a quiet stop never disagree about the day in
 * the early morning.
 * @param requestedDay - The validated `?day=`, or null when none was given.
 * @param today - The current service date (injectable for tests).
 * @returns The day, its window, and whether its next day is still pending.
 */
export async function resolveShownDay(
  requestedDay: string | null,
  today: string = nzServiceDayString(),
): Promise<ShownDay> {
  const yesterday = shiftWeek(today, -1);
  // Only the day before today steps onto today, so any other asked-for day
  // skips the open test.
  if (requestedDay && requestedDay !== yesterday) return shownDay(requestedDay, false);
  // Lazy import keeps the data/DB layer out of this module's pure helpers (and
  // their unit tests); it only loads when a page asks at runtime.
  const { currentDayIsOpen, getMostRecentDataDay, TODAY_REVALIDATE } = await import("@/lib/data");
  const open = await currentDayIsOpen(TODAY_REVALIDATE);
  if (requestedDay) return shownDay(requestedDay, !open);
  if (open) return shownDay(today, false);
  // Before today opens: the latest earlier day with enough data. An ingest gap
  // can make that older than yesterday, and then yesterday is still a step on.
  const recent = await getMostRecentDataDay(MIN_BOARD_EVENTS);
  const recentDay = recent ? nzServiceDayString(recent) : null;
  const day = recentDay && recentDay < today ? recentDay : yesterday;
  // The archive's first morning has nothing earlier to stand in.
  if (day < DATA_START_DAY) return shownDay(today, false);
  return shownDay(day, day === yesterday);
}

/**
 * A {@link ShownDay} for a service date.
 * @param serviceDate - The service date (`YYYY-MM-DD`).
 * @param nextPending - Whether its next day is today and not yet open.
 * @returns The shown day.
 */
function shownDay(serviceDate: string, nextPending: boolean): ShownDay {
  return { serviceDate, range: nzServiceDayRange(serviceDate), nextPending };
}
