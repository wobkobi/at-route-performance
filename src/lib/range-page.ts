// src/lib/range-page.ts
// Day / Week / Month window handling for the Routes and Cancellations pages:
// parse `?window`, resolve the range and its stepper, and the query a route link
// carries so the route opens on the same window. Week and month anchor to the
// latest day with data, as the rankings page does (see rankings-page.ts).
import {
  resolveMonthNav,
  resolveRequestedDay,
  resolveRequestedMonth,
  resolveWeekNav,
} from "@/lib/page-nav";
import { resolveRange } from "@/lib/rankings-page";
import { type DateRange, nzServiceDayString, shiftWeek } from "@/lib/time";
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
    }
  | {
      window: "week" | "month";
      /** The period label ("Last 7 days", "September 2026"). */
      label: string;
      /** Previous-period link, or null at the earliest data. */
      prevHref: string | null;
      /** Next-period link, or null at the present. */
      nextHref: string | null;
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
): RangeNav {
  return {
    window: "day",
    serviceDate,
    hasPrev: earliestDay ? serviceDate > nzServiceDayString(earliestDay) : false,
    hasNext: serviceDate < today,
    nextIsToday: shiftWeek(serviceDate, 1) === today,
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
  const { prevHref, nextHref } =
    window === "week"
      ? resolveWeekNav({ periodParam: period, earliestDay, makeHref, now: anchor })
      : resolveMonthNav({ periodParam: period, earliestDay, makeHref, now: anchor });
  return { range, period, nav: { window, label, prevHref, nextHref } };
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
