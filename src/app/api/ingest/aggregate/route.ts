// src/app/api/ingest/aggregate/route.ts
// Cron-only POST that rolls completed NZ service days into per-route
// DailyRouteSummary rows (see lib/aggregate.ts). Without `?date=` it covers
// yesterday plus up to two earlier days that have events but no summary, so a
// night the cron missed, or a day whose ghost pass failed, is caught up by the
// next run rather than lost. Each day is its own unit: it succeeds or fails on
// its own, records its own IngestRun row, and a failure does not stop the
// others. The window matches the live dashboard (4am Auckland, half-open).
import {
  aggregateDay,
  CATCH_UP_EXTRA_DAYS,
  catchUpDates,
  dayHasEvents,
  daySummarised,
} from "@/lib/aggregate";
import { requireCronAuth } from "@/lib/auth";
import { recordIngestRun } from "@/lib/ingest-run";
import { resolveRequestedDay } from "@/lib/page-nav";
import { nzServiceDayRange, nzServiceDayString, shiftWeek } from "@/lib/time";
import { after, NextResponse } from "next/server";

// Three days of ghost pass plus rollup can run past the default; the work
// happens after the 202 is sent, inside this budget.
export const maxDuration = 300;

/**
 * Roll each service date up in turn, recording one IngestRun per day. Invoked
 * via `after` so the 202 response is sent first - a day can take longer than
 * the external scheduler's 30s request timeout.
 * @param startTime - Epoch ms when the request arrived.
 * @param dates - Service dates (`YYYY-MM-DD`) to aggregate, oldest first.
 */
async function runAggregate(startTime: number, dates: readonly string[]): Promise<void> {
  for (const serviceDate of dates) {
    const dayStart = Date.now();
    try {
      const { aggregated, ghosts } = await aggregateDay(
        nzServiceDayRange(serviceDate),
        serviceDate,
      );
      console.log("[AGGREGATE] Complete", {
        date: serviceDate,
        aggregated,
        ghost_trips: ghosts.trips,
        ghost_rows: ghosts.flagged,
        ghost_runs: ghosts.hidden,
        duration_ms: Date.now() - dayStart,
      });
      await recordIngestRun({
        endpoint: "aggregate",
        startedAt: new Date(startTime),
        success: true,
        count: aggregated,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("[AGGREGATE] Failed", {
        date: serviceDate,
        error: msg,
        duration_ms: Date.now() - dayStart,
      });
      await recordIngestRun({
        endpoint: "aggregate",
        startedAt: new Date(startTime),
        success: false,
        error: `${serviceDate}: ${msg}`,
      });
    }
  }
}

/**
 * Compute DailyRouteSummary for every route on one or more NZ service days.
 * With `?date=` exactly that day; otherwise the most recently completed day plus
 * any of the two before it that still lack a summary. Validates the date,
 * acknowledges, then aggregates after the response; each day's outcome is
 * recorded in IngestRun and the function logs.
 * @param req - Request with optional `?date=YYYY-MM-DD` query param (treated as
 *   the NZ service date).
 * @returns 202 JSON `{ started, dates }`; 400/401 on bad input.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date");
  // Calendar-valid check, not just shape: an impossible date (2026-02-31)
  // would silently normalise onto a different service day.
  const dateParam = resolveRequestedDay(rawDate ?? undefined);

  if (rawDate && !dateParam) {
    return NextResponse.json(
      { error: "Invalid date. Use a real YYYY-MM-DD calendar date" },
      { status: 400 },
    );
  }

  let dates: string[];
  if (dateParam) {
    dates = [dateParam];
  } else {
    // The most recently completed service day (24 h ago is always done), then
    // the catch-up rule over the two days before it.
    const yesterday = nzServiceDayString(new Date(Date.now() - 86_400_000));
    const candidates = Array.from({ length: CATCH_UP_EXTRA_DAYS }, (_, i) =>
      shiftWeek(yesterday, -(i + 1)),
    );
    const [summarised, withEvents] = await Promise.all([
      Promise.all(candidates.map(daySummarised)),
      Promise.all(candidates.map(dayHasEvents)),
    ]);
    const summarisedByDate = new Map(candidates.map((d, i) => [d, summarised[i] ?? true]));
    const eventsByDate = new Map(candidates.map((d, i) => [d, withEvents[i] ?? false]));
    dates = catchUpDates(
      yesterday,
      (date) => summarisedByDate.get(date) ?? true,
      (date) => eventsByDate.get(date) ?? false,
    );
  }

  after(() => runAggregate(startTime, dates));

  return NextResponse.json({ started: true, dates }, { status: 202 });
}
