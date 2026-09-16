// src/lib/run-day.ts
// The service date one run belongs to. Every reading of a run must carry one
// day, even when the run crosses the boundary hour, so the day is derived once
// per run at ingest and stamped on every row. Pure: no database, no clock.
import type { Trip } from "@/lib/at";
import {
  nzServiceDayRange,
  nzServiceDayString,
  parseYmd,
  RUN_TAIL_HOURS,
  SERVICE_START_HOUR,
  shiftWeek,
} from "@/lib/time";
import { gtfsTimeSeconds, tripIdStartSeconds } from "@/lib/trip-id";

/** AT's GTFS `start_date`, `YYYYMMDD`. */
const START_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** Milliseconds in an hour, for the straddler fold's tail. */
const HOUR_MS = 3_600_000;

/**
 * AT's own `start_date` as a service date, accepted only when it is eight
 * digits and a real calendar date: `Date.UTC` would silently normalise
 * "20260931" onto 1 October.
 * @param startDate - The trip descriptor's `start_date`.
 * @returns The date as `YYYY-MM-DD`, or null when absent or malformed.
 */
export function parseStartDate(startDate: string | undefined): string | null {
  const m = startDate ? START_DATE_RE.exec(startDate) : null;
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  const { y, mo, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? ymd : null;
}

/**
 * The NZ service date a run belongs to. AT's own `start_date` wins: when AT
 * reuses a trip id against a later block it still dates that block itself, so
 * the readings file under the day AT is reporting rather than the day the
 * schedule times suggest. Without it, fall back to the service day of the run's
 * earliest scheduled stop, which agrees with `start_date` in every shape AT
 * writes - a `24:00:00` run resolves to the previous calendar date because its
 * first stop falls before the boundary hour.
 * @param trip - The GTFS-RT trip descriptor.
 * @param runStart - The earliest `scheduledAt` among the run's stop rows.
 * @returns The service date as `YYYY-MM-DD`.
 */
export function runServiceDate(trip: Trip, runStart: Date): string {
  return parseStartDate(trip.start_date) ?? nzServiceDayString(runStart);
}

/**
 * Last-resort service date for a row with no run to group it with. The trip
 * id's third segment is the run's scheduled start in seconds past the GTFS
 * reference, so `floor(sec / 86400)` is how many calendar days that start sits
 * past its service date; {@link tripIdStartSeconds} caps at 48 h, so the offset
 * is only ever 0 or 1. Only the migrations need this: ingest always has the
 * run's own rows.
 * @param tripId - AT GTFS trip id.
 * @param at - An instant inside the run.
 * @returns The service date as `YYYY-MM-DD`, or null when the id has another shape.
 */
export function tripIdServiceDate(tripId: string, at: Date): string | null {
  const sec = tripIdStartSeconds(tripId);
  if (sec === null) return null;
  // Start hour 0 gives the plain Auckland calendar date of the instant.
  return shiftWeek(nzServiceDayString(at, 0), -Math.floor(sec / 86_400));
}

/** One stored row, for the straddler fold. */
export interface RunRowDate {
  id: string;
  tripId: string;
  scheduledAt: Date;
  /** The date the plain per-row rule gave it. */
  serviceDate: string;
}

/**
 * Fold a run's readings onto the date of its earliest reading, so a run that
 * crosses the boundary hour carries one day. Rows further than `tailHours` from
 * the run's own minimum keep their own date: a reused trip id must not drag a
 * whole day's readings onto one date. On clean data that guard never fires - no
 * run in the whole of 15 September spanned more than 104 minutes across 15,364
 * runs - which is exactly why the caller should log loudly when it does.
 * @param rows - Every stored row of one or more runs, in any order.
 * @param tailHours - How far past a run's first reading still belongs to it.
 * @returns Row id to corrected service date, for the rows that need changing.
 */
export function foldRunDates(
  rows: readonly RunRowDate[],
  tailHours: number = RUN_TAIL_HOURS,
): Map<string, string> {
  const byTrip = new Map<string, RunRowDate[]>();
  for (const row of rows) {
    const list = byTrip.get(row.tripId);
    if (list) list.push(row);
    else byTrip.set(row.tripId, [row]);
  }
  const out = new Map<string, string>();
  for (const list of byTrip.values()) {
    const first = list.reduce((a, b) => (a.scheduledAt <= b.scheduledAt ? a : b));
    const tailEnd = first.scheduledAt.getTime() + tailHours * HOUR_MS;
    for (const row of list) {
      if (row.serviceDate === first.serviceDate) continue;
      if (row.scheduledAt.getTime() > tailEnd) continue;
      out.set(row.id, first.serviceDate);
    }
  }
  return out;
}

/**
 * How long after its own departure a cancellation flag can still be raised
 * against that run. The two directions need different tolerances, because AT
 * flags a run well before it leaves and sometimes hours after it should have:
 * across the stored flags a genuine late flag trails its departure by at most
 * 6h45m, the longest lead on a run later the same day is 12h40m, and the
 * earliest flags for the next day's run trail by 12h50m. Ten hours separates
 * those two populations with over an hour of clear air on either side. A
 * symmetric half-day window does not separate them at all: the leads run
 * unbroken from 11h to 12h40m, so a twelve-hour cut falls inside a cluster and
 * files every run above it a day early.
 */
const MAX_FLAG_LAG_MS = 10 * HOUR_MS;

/** A whole day: the width of the window {@link MAX_FLAG_LAG_MS} anchors. */
const DAY_MS = 24 * HOUR_MS;

/** A cancelled run, as ingest sees it live and as the restamp reads it back. */
export interface CancelledRun {
  tripId: string;
  /** GTFS-RT `start_time` (`HH:MM:SS`), null when ingest captured none. */
  startTime: string | null;
  /** GTFS-RT `start_date` (`YYYYMMDD`), when the feed sends one. */
  startDate?: string | undefined;
  /** When ingest first saw the flag. */
  detectedAt: Date;
}

/**
 * The instant a GTFS start time falls at within a service day, resolved against
 * an explicit boundary hour. `serviceDayClockInstant` reads the live
 * `SERVICE_START_HOUR`; this needs whichever hour the caller is working in,
 * including a migration rolling back to 5.
 * @param dayStart - The service day's start instant under `startHour`.
 * @param seconds - Seconds since the GTFS reference.
 * @param startHour - The boundary hour `dayStart` was built with.
 * @returns The UTC instant of that schedule time.
 */
function clockInstant(dayStart: Date, seconds: number, startHour: number): Date {
  const startSec = startHour * 3600;
  const offset = seconds < startSec ? seconds + 86_400 : seconds;
  return new Date(dayStart.getTime() + (offset - startSec) * 1000);
}

/**
 * The service date a cancelled run belongs to. A cancellation carries no stop
 * times, so there are no rows to take a run start from: the anchor is when the
 * flag was seen. AT raises a flag anywhere from half a day before a run to
 * several hours after it should have left, so the service day in progress at
 * detection is only the first guess; the captured start time (or the start
 * seconds in the trip id) then moves the run to the neighbouring day whenever
 * the gap to that day's departure places it there.
 *
 * Deliberately blind to any service date already stored against the run: that
 * stamp is the boundary-hour label of `detectedAt` and so says nothing new,
 * while reading it would make a second pass of the restamp disagree with the
 * first.
 * @param flag - The cancelled run.
 * @param startHour - The boundary hour the answer is expressed in.
 * @returns The service date as `YYYY-MM-DD`.
 */
export function cancelledServiceDate(
  flag: CancelledRun,
  startHour: number = SERVICE_START_HOUR,
): string {
  const declared = parseStartDate(flag.startDate);
  if (declared !== null) return declared;
  const day = nzServiceDayString(flag.detectedAt, startHour);
  const sec = gtfsTimeSeconds(flag.startTime) ?? tripIdStartSeconds(flag.tripId);
  if (sec === null) return day;
  const departure = clockInstant(nzServiceDayRange(day, startHour).start, sec, startHour);
  const ahead = departure.getTime() - flag.detectedAt.getTime();
  // The two edges sit a day apart, so exactly one service day can hold the run:
  // a departure further past than the lag allowance is the next day's run, and
  // one beyond the lead that allowance leaves over is the previous day's.
  if (ahead < -MAX_FLAG_LAG_MS) return shiftWeek(day, 1);
  if (ahead >= DAY_MS - MAX_FLAG_LAG_MS) return shiftWeek(day, -1);
  return day;
}
