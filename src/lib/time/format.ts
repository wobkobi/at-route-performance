// src/lib/time/format.ts
// Every Intl date formatter the site uses, built once at module scope: making
// an Intl formatter costs far more than calling one, and several of these run
// once per row. A leaf module (it imports only the timezone name), so
// service-day.ts and the components can both take from it.
import { NZ_TZ } from "@/lib/time/nz-tz";

/**
 * Auckland wall-clock parts, 24-hour, for working out the UTC offset. `en-US`
 * because its parts are plain numbers; some engines print midnight as "24".
 */
export const NZ_WALL_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Auckland calendar date and hour as parts, zero-padded. */
export const NZ_DATE_HOUR_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

/** Auckland calendar date as `YYYY-MM-DD`: `en-CA` prints ISO order. */
export const NZ_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Auckland hour of day, 24-hour, as parts. */
export const NZ_HOUR_PARTS = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  hour: "2-digit",
  hour12: false,
});

/** Short weekday of a calendar date held at UTC midnight. */
export const UTC_WEEKDAY = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short" });

/** Auckland clock time, "7:24 am". */
const NZ_CLOCK = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** Auckland day, month and clock time, "12 Sep, 8:45 pm". */
const NZ_DAY_CLOCK = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "2 minutes ago", "in 1 hour", "now". */
/** Short units ("2 min ago"), as the footer's stalled line words its minutes. */
const RELATIVE = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto", style: "short" });

/**
 * Auckland-local clock time of an instant, "7:24 am".
 * @param at - The instant, as an ISO string or a Date.
 * @returns The 12-hour clock time.
 */
export function nzClockTime(at: string | Date): string {
  return NZ_CLOCK.format(typeof at === "string" ? new Date(at) : at);
}

/**
 * An instant as its clock time, adding the day and month when it is not today,
 * so an alert running for weeks does not read as tonight.
 * @param at - The instant.
 * @param withDate - Whether to name the day and month too.
 * @returns "8:45 pm" or "12 Sep, 8:45 pm".
 */
export function nzClockWithDate(at: Date, withDate: boolean): string {
  return (withDate ? NZ_DAY_CLOCK : NZ_CLOCK).format(at);
}

/**
 * A GTFS departure time ("HH:MM:SS") as a 12-hour clock time, spelt exactly as
 * {@link nzClockTime} spells an instant, since the trip line prints the two side
 * by side. GTFS writes a post-midnight run past 24 hours ("25:30:00"), which
 * wraps onto the next day's clock ("1:30 am").
 * @param hms - GTFS time string, or null.
 * @returns The time like "9:05 am", or null when absent or unparseable.
 */
export function formatGtfsTime(hms: string | null): string | null {
  if (!hms) return null;
  const [h, m] = hms.split(":");
  if (h === undefined || m === undefined) return null;
  const hours = parseInt(h, 10);
  const mins = parseInt(m, 10);
  if (isNaN(hours) || isNaN(mins)) return null;
  const suffix = hours % 24 < 12 ? "am" : "pm";
  return `${hours % 12 || 12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/**
 * How long ago (or until) an instant, in the coarsest unit that fits: "2 min
 * ago", "in 1 hr", "now".
 * @param fromMs - The instant being described, in epoch ms.
 * @param nowMs - The reference "now", in epoch ms.
 * @returns The phrase.
 */
export function formatRelative(fromMs: number, nowMs: number): string {
  const diffSec = Math.round((fromMs - nowMs) / 1000);
  if (Math.abs(diffSec) < 60) return RELATIVE.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return RELATIVE.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return RELATIVE.format(diffHr, "hour");
  return RELATIVE.format(Math.round(diffHr / 24), "day");
}
