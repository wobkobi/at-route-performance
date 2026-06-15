// src/lib/time.ts

/** A UTC half-open window [start, end). */
export interface DateRange {
  start: Date;
  end: Date;
}

const MS_IN_DAY = 86_400_000;

/**
 * Auckland's UTC offset, in minutes, at a given instant (handles NZST/NZDT).
 * @param at - The instant to evaluate.
 * @returns Offset in minutes that, added to UTC, gives Auckland local time.
 */
function nzOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - at.getTime()) / 60000);
}

/**
 * Convert an Auckland-local wall-clock date (midnight) to the UTC instant.
 * @param y - Local full year.
 * @param mo - Local month (1-12).
 * @param d - Local day of month.
 * @returns The UTC Date for that Auckland local midnight.
 */
function nzLocalToUtc(y: number, mo: number, d: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d));
  const offset = nzOffsetMinutes(guess);
  return new Date(Date.UTC(y, mo - 1, d) - offset * 60000);
}

/**
 * The Auckland-local calendar-day window containing an instant.
 * @param at - Any instant within the target day (defaults to now).
 * @returns UTC `{ start, end }` for that local day.
 */
export function nzDayRange(at: Date = new Date()): DateRange {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, mo, d] = dtf.format(at).split("-").map(Number);
  const start = nzLocalToUtc(y, mo, d);
  const end = nzLocalToUtc(y, mo, d + 1);
  return { start, end };
}

/**
 * ISO week label (e.g. `2026-W25`) for an instant, using its Auckland-local date.
 * @param at - The instant to label.
 * @returns ISO week string using the ISO week-numbering year.
 */
export function isoWeekString(at: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, mo, d] = dtf.format(at).split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / MS_IN_DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * The Auckland-local ISO-week window. Defaults to the week containing now.
 * @param iso - ISO week like `2026-W25` (optional).
 * @returns UTC `{ start, end }` spanning that local week (Mon 00:00 local).
 */
export function nzWeekRange(iso?: string): DateRange {
  const m = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  let target: Date;
  if (m) {
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const week1Mon = new Date(jan4);
    week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);
    target = new Date(week1Mon);
    target.setUTCDate(week1Mon.getUTCDate() + 7 * (week - 1));
  } else {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [y, mo, d] = dtf.format(now).split("-").map(Number);
    const today = new Date(Date.UTC(y, mo - 1, d));
    const dayNum = today.getUTCDay() || 7;
    target = new Date(today);
    target.setUTCDate(today.getUTCDate() - (dayNum - 1));
  }
  const start = nzLocalToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
  );
  const end = nzLocalToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate() + 7,
  );
  return { start, end };
}

/**
 * The Auckland-local calendar-month window. Defaults to the current month.
 * @param ym - Month like `2026-06` (optional).
 * @returns UTC `{ start, end }` spanning that local month.
 */
export function nzMonthRange(ym?: string): DateRange {
  let y: number;
  let mo: number;
  const m = ym?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
  } else {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
    });
    [y, mo] = dtf.format(new Date()).split("-").map(Number);
  }
  const start = nzLocalToUtc(y, mo, 1);
  const end = nzLocalToUtc(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1);
  return { start, end };
}
