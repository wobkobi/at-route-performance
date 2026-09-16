// src/lib/restamp.ts
// The one decision the one-off service-day restamp makes that nothing else
// needs: where a stored DailyRouteSummary stamp moves to when the boundary hour
// changes. The per-run decisions it also drives live in lib/run-day.ts, because
// ingest asks the same questions live.
import { nzServiceDayRange, nzServiceDayString } from "@/lib/time";

/**
 * The service-day start instant a stored summary stamp should carry under a new
 * boundary hour. The stamp is read under the hour that wrote it and rewritten
 * under the hour replacing it, so the service date it labels never moves and
 * only the instant does: a 5am stamp and a 4am stamp of the same day are one
 * hour apart, and the pair of hours makes the relabel exactly invertible for a
 * rollback.
 *
 * The caller must select only rows still stamped at `fromHour` (their Auckland
 * local hour), which is what makes a repeated run a no-op: relabelling an
 * already-moved stamp would step it a further day.
 * @param stamped - The stored `date`.
 * @param fromHour - The boundary hour the stamp was written under.
 * @param toHour - The boundary hour the new stamp uses.
 * @returns The new stamp.
 */
export function restampedSummaryDate(stamped: Date, fromHour: number, toHour: number): Date {
  return nzServiceDayRange(nzServiceDayString(stamped, fromHour), toHour).start;
}
