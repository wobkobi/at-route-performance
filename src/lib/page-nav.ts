// src/lib/page-nav.ts
/**
 * @description Pure day and week navigation helpers shared across the shame and
 * route pages: validate `?day=`/`?period=` params, resolve the active week
 * window (a fixed calendar week or the rolling last seven service days), and
 * build the prev/next stepper bounded by the earliest day with data and the
 * present week. Two subtleties: on a live (today) view, hours that have not
 * started yet are dropped so AT's predicted-future slots don't show as phantom
 * on-time entries; and the empty-day fallback lazily imports the data layer so
 * these helpers stay pure and unit-testable.
 */
import {
  nzLast7DaysRange,
  nzServiceDayString,
  nzWeekRange,
  nzWeekStart,
  shiftWeek,
  weekRangeLabel,
  type DateRange,
} from "@/lib/time";

/** Matches an ISO `YYYY-MM-DD` date string. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a `?day=` / `?period=` query value as an ISO `YYYY-MM-DD` date.
 * Rejects shape-valid but impossible dates (2026-02-31): `Date.UTC` would
 * silently normalise those onto a different day, so the components must
 * round-trip unchanged.
 * @param value - The raw query value, if any.
 * @returns The value when it is a real calendar date, else null.
 */
export function resolveRequestedDay(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real ? value : null;
}

/**
 * Drop hours that have not started yet on a live (today) day, so AT realtime
 * predicted-future slots don't show as phantom on-time entries. A no-op for any
 * past day. The service day runs 5am > 5am, so its post-midnight hours (0-4)
 * come chronologically LAST: pre-5am the daytime hours 5-23 have all happened
 * (the previous calendar evening) plus the post-midnight hours up to now, while
 * from 5am onward only hours 5..now have.
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
      timeZone: "Pacific/Auckland",
    }).format(now),
    10,
  );
  return hours.filter((h) =>
    nowHourNZ < 5 ? h.hour >= 5 || h.hour <= nowHourNZ : h.hour >= 5 && h.hour <= nowHourNZ,
  );
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
  return { fixedWeekRange, activeWeekRange: fixedWeekRange ?? nzLast7DaysRange(now) };
}

/** The prev/next week-stepper links and the period label for a week view. */
export interface WeekNav {
  /** Human label for the active period ("Last 7 days" or "DD/MM to DD/MM"). */
  periodLabel: string;
  /** Previous-week link, or null at the earliest data. */
  prevHref: string | null;
  /** Next-week link, or null when already at the present week. */
  nextHref: string | null;
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
  const thisWeekStart = nzWeekStart(now);
  const prevWeek = shiftWeek(periodParam ?? thisWeekStart, -7);
  const earliestWeekStart = earliestDay ? nzWeekStart(earliestDay) : null;
  const prevHref = !earliestWeekStart || prevWeek >= earliestWeekStart ? makeHref(prevWeek) : null;
  let nextHref: string | null = null;
  if (periodParam) {
    const nextWeek = shiftWeek(periodParam, 7);
    nextHref = nextWeek >= thisWeekStart ? makeHref(null) : makeHref(nextWeek);
  }
  return { periodLabel, prevHref, nextHref };
}

/**
 * The fallback service day for an empty day view: when no specific day was
 * requested and the current day has no data yet, the most recent service day
 * with data; otherwise null (the caller keeps its current day). Lets a page
 * decide to recompute its range and refetch with its own data function.
 * @param requestedDay - The validated `?day=`, or null when none was given.
 * @param isEmpty - Whether the data already fetched has nothing to show.
 * @param minEvents - Minimum events for a day to qualify as "has data".
 * @returns The fallback day (noon within it), or null for no fallback.
 */
export async function maybeFallbackDay(
  requestedDay: string | null,
  isEmpty: boolean,
  minEvents: number,
): Promise<Date | null> {
  if (requestedDay || !isEmpty) return null;
  // Lazy import keeps the data/DB layer out of this module's pure helpers (and
  // their unit tests); it only loads when the fallback actually runs at runtime.
  const { getMostRecentDataDay } = await import("@/lib/data");
  return getMostRecentDataDay(minEvents);
}
