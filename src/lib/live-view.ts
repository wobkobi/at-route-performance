// src/lib/live-view.ts
// Whether the window a page's URL names can still change. Pure and free of the
// data layer, so the footer's client-side poller can import it.
import { shiftWeek } from "@/lib/time";

/** A `YYYY-MM` month key: the month view's `?period=`. */
const MONTH_KEY = /^\d{4}-\d{2}$/;

/** A `YYYY-MM-DD` date: the day view's `?day=`, and the week view's `?period=` start. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether the window a page's URL names still includes the live service day,
 * so its figures move when a new ingest run lands. A page with neither param
 * shows the live day or the rolling week, and both include it. Dates compare as
 * plain strings, which orders `YYYY-MM-DD` correctly.
 *
 * A value in a shape this does not recognise counts as live. Refreshing a page
 * that cannot change costs one render; failing to refresh one that can leaves
 * the numbers frozen, which is the fault this exists to fix.
 * @param params - The page's `day` and `period` query values, null when absent.
 * @param params.day - The day view's `?day=`.
 * @param params.period - The week or month view's `?period=`.
 * @param today - The live service date, `YYYY-MM-DD`.
 * @returns True when the view includes the live day.
 */
export function viewIncludesToday(
  { day, period }: { day: string | null; period: string | null },
  today: string,
): boolean {
  if (day && DATE_KEY.test(day)) return day === today;
  if (period && MONTH_KEY.test(period)) return today.startsWith(`${period}-`);
  if (period && DATE_KEY.test(period)) return period <= today && today < shiftWeek(period, 7);
  return true;
}
