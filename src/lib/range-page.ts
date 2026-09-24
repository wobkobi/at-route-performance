// src/lib/range-page.ts
// Day / Week / Month window handling for the Overview, Routes and Cancellations
// pages: parse `?window`, resolve the range and its stepper, and the query a route
// link carries so the route opens on the same window. Week and month anchor to the
// latest day with data (see rankings-page.ts).
import { DATA_START_DAY } from "@/lib/data-start";
import {
  resolveMonthNav,
  resolveRequestedDay,
  resolveRequestedMonth,
  resolveWeekNav,
} from "@/lib/page-nav";
import { resolveRange } from "@/lib/rankings-page";
import { type DateRange, nzServiceDayString, parseYmd, shiftMonth, shiftWeek } from "@/lib/time";
import { buildHref } from "@/lib/utils";

/** The window a range page shows. */
export type RangeWindow = "day" | "week" | "month";

/**
 * The `?day` / `?period` each window tab carries, so switching windows lands
 * near the date being read instead of resetting to the present. A null means
 * the tab's own default: today for the day, the rolling week, the current month.
 */
export interface RangeTabPeriods {
  /** The `?day` the Day tab carries, or null for today. */
  day: string | null;
  /** The `?period` the Week tab carries, or null for the rolling week. */
  week: string | null;
  /** The `?period` the Month tab carries, or null for the current month. */
  month: string | null;
}

/** The stepper state {@link RangeNav} consumers render: a day stepper or a period stepper. */
export type RangeNav =
  | {
      window: "day";
      /** The shown service date (`YYYY-MM-DD`). */
      serviceDate: string;
      /** Whether the shown day is the current service day. */
      isToday: boolean;
      /** Whether the next day is today and has not opened yet. */
      nextPending: boolean;
      /** Whether an earlier day has data. */
      hasPrev: boolean;
      /** Whether a later day can be shown (false on today, and while today is pending). */
      hasNext: boolean;
      /** Whether the next day is today, so its link drops `?day`. */
      nextIsToday: boolean;
      /** Whether the shown day is the archive's first. */
      atFloor: boolean;
      /** What each window tab carries across. */
      tabs: RangeTabPeriods;
    }
  | {
      window: "week" | "month";
      /** The period label ("Last 7 days", "September 2026"). */
      label: string;
      /** Previous-period link, or null at the earliest data. */
      prevHref: string | null;
      /** Next-period link, or null at the present. */
      nextHref: string | null;
      /** Whether the period starts before the archive floor, so the label says so. */
      partial: boolean;
      /** What each window tab carries across. */
      tabs: RangeTabPeriods;
    };

/**
 * Parse `?window`, defaulting to the day view.
 * @param raw - The raw query value.
 * @returns The window.
 */
export function parseRangeWindow(raw: string | undefined): RangeWindow {
  return raw === "week" || raw === "month" ? raw : "day";
}

/**
 * Whether an earlier day is reachable: past the archive floor and past the live
 * earliest day. The `earliestDay` parameter stays because it is what keeps the
 * helper honest after 2036, when retention starts pruning the floor forward. A
 * null earliest day falls back to the floor rather than hiding the chevron, so
 * a failed lookup costs one dead link instead of the whole stepper.
 * @param serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param earliestDay - The earliest service day with data, or null when unknown.
 * @returns True when a previous-day link should be offered.
 */
export function hasEarlierDay(serviceDate: string, earliestDay: Date | null): boolean {
  const live = earliestDay ? nzServiceDayString(earliestDay) : DATA_START_DAY;
  return serviceDate > (live > DATA_START_DAY ? live : DATA_START_DAY);
}

/**
 * The day stepper for a shown service date, bounded by the earliest day with
 * data and today. Before today opens there is no next day from yesterday: the
 * bare URL would fall back to yesterday again.
 * @param shown - The shown day (see `resolveShownDay`).
 * @param shown.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param shown.nextPending - Whether the next day is today and not yet open.
 * @param earliestDay - The earliest service day with data, or null when unknown.
 * @param today - Today's service date (injectable for tests).
 * @returns The day stepper state.
 */
export function dayRangeNav(
  { serviceDate, nextPending }: { serviceDate: string; nextPending: boolean },
  earliestDay: Date | null,
  today: string = nzServiceDayString(),
): Extract<RangeNav, { window: "day" }> {
  return {
    window: "day",
    serviceDate,
    isToday: serviceDate === today,
    nextPending,
    hasPrev: hasEarlierDay(serviceDate, earliestDay),
    hasNext: serviceDate < today && !nextPending,
    nextIsToday: shiftWeek(serviceDate, 1) === today,
    atFloor: serviceDate === DATA_START_DAY,
    tabs: rangeTabPeriods(serviceDate, today),
  };
}

/**
 * Resolve a week or month window: its range, label and period stepper. Links
 * carry only `window` and `period`; the controls add the page's other params.
 * @param basePath - The page path the stepper links point at.
 * @param window - "week" or "month".
 * @param rawPeriod - The raw `?period` value.
 * @param anchor - The latest day with data (or now).
 * @param earliestDay - The earliest service day with data, or null when unknown.
 * @param today - Today's service date (injectable for tests).
 * @returns The range, the validated period (null for the rolling default) and the stepper.
 */
export function periodRangeNav(
  basePath: string,
  window: "week" | "month",
  rawPeriod: string | undefined,
  anchor: Date,
  earliestDay: Date | null,
  today: string = nzServiceDayString(),
): { range: DateRange; period: string | null; nav: RangeNav } {
  const period =
    window === "month" ? resolveRequestedMonth(rawPeriod) : resolveRequestedDay(rawPeriod);
  const { range, label } = resolveRange(window, period ?? undefined, anchor);
  /**
   * A link to another period of this window.
   * @param p - The period, or null for the rolling default.
   * @returns The href.
   */
  const makeHref = (p: string | null): string =>
    buildHref(basePath, { window, period: p ?? undefined });
  const { prevHref, nextHref, partial } =
    window === "week"
      ? resolveWeekNav({ periodParam: period, earliestDay, makeHref, now: anchor })
      : resolveMonthNav({ periodParam: period, earliestDay, makeHref, now: anchor });
  return {
    range,
    period,
    nav: {
      window,
      label,
      prevHref,
      nextHref,
      partial,
      tabs: rangeTabPeriods(periodAnchorDay(window, period, today), today),
    },
  };
}

/**
 * The week `period` holding a day, for a Week toggle that stays on the day's
 * week: its Monday, or null (the rolling last 7 days) for today.
 * @param serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param today - Today's service date (injectable for tests).
 * @returns The Monday `YYYY-MM-DD`, or null.
 */
export function weekPeriodOf(
  serviceDate: string,
  today: string = nzServiceDayString(),
): string | null {
  if (serviceDate >= today) return null;
  const { y, mo, d } = parseYmd(serviceDate);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return shiftWeek(serviceDate, -((weekday + 6) % 7));
}

/**
 * The month `period` holding a day, for a Month toggle that stays on the day's
 * month: its `YYYY-MM`, or null (the current month) for today. Mirrors
 * {@link weekPeriodOf}.
 * @param serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param today - Today's service date (injectable for tests).
 * @returns The month key `YYYY-MM`, or null.
 */
export function monthPeriodOf(
  serviceDate: string,
  today: string = nzServiceDayString(),
): string | null {
  if (serviceDate >= today) return null;
  const { y, mo } = parseYmd(serviceDate);
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/**
 * The day a week or month view sits on, so its other tabs can stay near it: the
 * period's last day, or today when the period runs past it. A rolling period
 * (no `period` param) already ends at today.
 * @param window - "week" or "month".
 * @param period - The validated period, or null for the rolling default.
 * @param today - Today's service date (injectable for tests).
 * @returns The anchor service date (`YYYY-MM-DD`).
 */
export function periodAnchorDay(
  window: "week" | "month",
  period: string | null,
  today: string = nzServiceDayString(),
): string {
  if (!period) return today;
  // A month key has no day component, so step to the next month's first and
  // back one day rather than carrying a table of month lengths.
  const last =
    window === "week" ? shiftWeek(period, 6) : shiftWeek(`${shiftMonth(period, 1)}-01`, -1);
  return last < today ? last : today;
}

/**
 * What each window tab carries so a tab switch stays on the date being read.
 * @param anchorDay - The service date the current view sits on.
 * @param today - Today's service date (injectable for tests).
 * @returns The per-tab `?day` / `?period` values.
 */
export function rangeTabPeriods(
  anchorDay: string,
  today: string = nzServiceDayString(),
): RangeTabPeriods {
  return {
    day: anchorDay >= today ? null : anchorDay,
    week: weekPeriodOf(anchorDay, today),
    month: monthPeriodOf(anchorDay, today),
  };
}

/**
 * The `?period` a week or month view should show: the one asked for, else the
 * period holding the day being read, which is what that window's own tab carries
 * (see {@link rangeTabPeriods}).
 *
 * The nav and the footer hand a page the reader's `?day` and no period, so a page
 * with no day view of its own would otherwise answer an archived day with the
 * current week.
 * @param window - "week" or "month".
 * @param rawPeriod - The raw `?period` value, if any.
 * @param rawDay - The raw `?day` value, if any.
 * @param today - Today's service date (injectable for tests).
 * @returns The period to resolve, or undefined for the rolling default.
 */
export function periodForCarriedDay(
  window: "week" | "month",
  rawPeriod: string | undefined,
  rawDay: string | undefined,
  today: string = nzServiceDayString(),
): string | undefined {
  if (rawPeriod) return rawPeriod;
  const day = resolveRequestedDay(rawDay);
  return day ? (rangeTabPeriods(day, today)[window] ?? undefined) : undefined;
}

/**
 * The shown window as the words that end "How bad was it ..." or "No shame
 * ...": "today" or "that day", "over the last 7 days" for the rolling week (the
 * week tab's default is seven days back from today, not the calendar week),
 * "that week", "this month" or "that month". The stepper beside it names the
 * date, so the words only say whether the window is the current one.
 * @param nav - The stepper state for the shown window.
 * @param period - The shown week or month, or null for the current one.
 * @returns The phrase.
 */
export function windowPhrase(nav: RangeNav, period: string | null): string {
  if (nav.window === "day") return nav.isToday ? "today" : "that day";
  if (period !== null) return `that ${nav.window}`;
  return nav.window === "week" ? "over the last 7 days" : "this month";
}

/**
 * The shown week or month as the words that follow "in": "the last 7 days" for
 * the rolling week, "that week" for a stepped-back one, "this month", "that
 * month". {@link windowPhrase} says the same thing where the phrase stands on
 * its own ("How bad was it over the last 7 days?").
 * @param window - "week" or "month".
 * @param period - The shown week or month, or null for the current one.
 * @returns The phrase.
 */
export function periodInPhrase(window: "week" | "month", period: string | null): string {
  if (period !== null) return `that ${window}`;
  return window === "week" ? "the last 7 days" : "this month";
}

/**
 * The home page heading for a window (see {@link windowPhrase}).
 * @param nav - The stepper state for the shown window.
 * @param period - The shown week or month, or null for the current one.
 * @returns The heading text.
 */
export function overviewHeading(nav: RangeNav, period: string | null): string {
  return `How bad was it ${windowPhrase(nav, period)}?`;
}

/**
 * The query a route link carries so the route page opens on the window being
 * viewed. The route page has only a day view and a week view, so a month hands
 * off to the week holding its last day - the same week {@link rangeTabPeriods}
 * gives the Month > Week tab, so every surface answers a month the same way.
 * This is the single definition of the shape: the Routes explorer and the rank
 * boards both take their route query from here.
 * @param window - The window being shown.
 * @param serviceDate - The shown service date, for the day view.
 * @param period - The shown week's or month's period, or null for the rolling default.
 * @param today - Today's service date (injectable for tests).
 * @returns The query string with its `?`, or an empty string.
 */
export function routeLinkQuery(
  window: RangeWindow,
  serviceDate: string | null | undefined,
  period: string | null | undefined,
  today: string = nzServiceDayString(),
): string {
  if (window === "day") return serviceDate && serviceDate !== today ? `?day=${serviceDate}` : "";
  const weekPeriod =
    window === "week"
      ? period
      : weekPeriodOf(periodAnchorDay("month", period ?? null, today), today);
  return `?window=week${weekPeriod ? `&period=${weekPeriod}` : ""}`;
}
