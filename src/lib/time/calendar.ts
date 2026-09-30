// src/lib/time/calendar.ts
// Month grids and date picks for the date picker. Every date is a `YYYY-MM-DD`
// service date and every month a `YYYY-MM` key, worked in UTC so no timezone
// or DST shift can move a cell onto the wrong day.

import {
  mondayOf,
  monthOf,
  monthShortName,
  parseYm,
  shiftDays,
  shiftMonth,
} from "@/lib/time/service-day";

/** What the date picker needs to draw and bound its calendar. */
export interface PickerState {
  /** Today's service date, which a day pick drops from the URL. */
  today: string;
  /** The earliest pickable date: the first day with data. */
  minDay: string;
  /** The latest pickable date: today, or the day before while today has not opened. */
  maxDay: string;
  /** First day of the shown window. */
  from: string;
  /** Last day of the shown window, inclusive. */
  to: string;
}

/**
 * A month's calendar rows, Monday first: every week touching the month, the
 * days either side of it included so each row is a whole week.
 * @param ym - The month key.
 * @returns Rows of seven dates.
 */
export function monthWeeks(ym: string): string[][] {
  const first = `${ym}-01`;
  const next = `${shiftMonth(ym, 1)}-01`;
  const rows: string[][] = [];
  for (let monday = mondayOf(first); monday < next; monday = shiftDays(monday, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => shiftDays(monday, i)));
  }
  return rows;
}

/**
 * A month's short name, "Sep".
 * @param ym - The month key.
 * @returns The name.
 */
export function monthShort(ym: string): string {
  return monthShortName(parseYm(ym).mo);
}

/**
 * The `?period` a week pick opens: the picked week's Monday, or none (the
 * rolling last 7 days) when that Monday is today, since a week starting today
 * has nothing in it yet.
 * @param ymd - Any day in the picked week.
 * @param today - Today's service date.
 * @returns The Monday, or null.
 */
export function weekPickPeriod(ymd: string, today: string): string | null {
  const monday = mondayOf(ymd);
  return monday >= today ? null : monday;
}

/**
 * The `?period` a month pick opens: its key, or none for the current month,
 * which is the month view's default.
 * @param ym - The picked month.
 * @param today - Today's service date.
 * @returns The key, or null.
 */
export function monthPickPeriod(ym: string, today: string): string | null {
  return ym >= monthOf(today) ? null : ym;
}
