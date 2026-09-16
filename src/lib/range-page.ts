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
import { type DateRange, nzServiceDayString, parseYmd, shiftWeek } from "@/lib/time";
import { buildHref } from "@/lib/utils";

/** The window a range page shows. */
export type RangeWindow = "day" | "week" | "month";

/** The stepper state {@link RangeNav} consumers render: a day stepper or a period stepper. */
export type RangeNav =
  | {
      window: "day";
      /** The shown service date (`YYYY-MM-DD`). */
      serviceDate: string;
      /** Whether an earlier day has data. */
      hasPrev: boolean;
      /** Whether a later day exists (false on today). */
      hasNext: boolean;
      /** Whether the next day is today, so its link drops `?day`. */
      nextIsToday: boolean;
      /** Whether the shown day is the archive's first. */
      atFloor: boolean;
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
 * data and today.
 * @param serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param earliestDay - The earliest service day with data, or null when unknown.
 * @param today - Today's service date (injectable for tests).
 * @returns The day stepper state.
 */
export function dayRangeNav(
  serviceDate: string,
  earliestDay: Date | null,
  today: string = nzServiceDayString(),
): Extract<RangeNav, { window: "day" }> {
  return {
    window: "day",
    serviceDate,
    hasPrev: hasEarlierDay(serviceDate, earliestDay),
    hasNext: serviceDate < today,
    nextIsToday: shiftWeek(serviceDate, 1) === today,
    atFloor: serviceDate === DATA_START_DAY,
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
 * @returns The range, the validated period (null for the rolling default) and the stepper.
 */
export function periodRangeNav(
  basePath: string,
  window: "week" | "month",
  rawPeriod: string | undefined,
  anchor: Date,
  earliestDay: Date | null,
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
  return { range, period, nav: { window, label, prevHref, nextHref, partial } };
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
 * The home page heading for a window. The stepper beside it names the date, so
 * the heading only says whether the window is the current one.
 * @param nav - The stepper state for the shown window.
 * @param period - The shown week or month, or null for the current one.
 * @returns The heading text.
 */
export function overviewHeading(nav: RangeNav, period: string | null): string {
  if (nav.window === "day")
    return nav.hasNext ? "How bad was it that day?" : "How bad was it today?";
  return `How bad was ${period === null ? "this" : "that"} ${nav.window}?`;
}

/**
 * The query a route link carries so the route page opens on the same window. The
 * route page has a day view and a week view, so a month links to its default.
 * @param window - The window being shown.
 * @param serviceDate - The shown service date, for the day view.
 * @param period - The shown week's period, or null for the rolling week.
 * @param today - Today's service date (injectable for tests).
 * @returns The query string with its `?`, or an empty string.
 */
export function routeLinkQuery(
  window: RangeWindow,
  serviceDate: string | null,
  period: string | null,
  today: string = nzServiceDayString(),
): string {
  if (window === "day") return serviceDate && serviceDate !== today ? `?day=${serviceDate}` : "";
  if (window === "week") return `?window=week${period ? `&period=${period}` : ""}`;
  return "";
}
