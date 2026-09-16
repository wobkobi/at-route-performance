// src/lib/run-day.ts
// The service date one run belongs to. Every reading of a run must carry one
// day, even when the run crosses the boundary hour, so the day is derived once
// per run at ingest and stamped on every row. Pure: no database, no clock.
import type { Trip } from "@/lib/at";
import { nzServiceDayString, parseYmd, RUN_TAIL_HOURS, shiftWeek } from "@/lib/time";
import { tripIdStartSeconds } from "@/lib/trip-id";

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
