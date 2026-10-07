// src/lib/data/revalidate.ts
// Every Data Cache TTL, in seconds, named by the role it plays where it has one
// and by its length where it does not. A leaf module (it imports only time
// constants), so feed and cron code can read it without pulling in the data layer.

import type { RangeWindow } from "@/lib/page/range";
import { SEC_PER_DAY, SEC_PER_HOUR } from "@/lib/time/service-day";

/**
 * Realtime ingest cadence (cron-job.org posts to /api/ingest/at every ~2
 * minutes). The footer projects its "next update" time from it, and a cache of
 * the live feed holds for one cycle, since the feed only moves when a run lands.
 */
export const INGEST_INTERVAL_SEC = 120;

/**
 * TTL for a window that can still change - anything touching the live service
 * day. One ingest cycle: the readings only move when a run lands, so a shorter
 * hold re-runs the aggregation over figures that have not changed. The entry is
 * refreshed in the background once it expires, so a reader sees figures at most
 * this far behind the latest run.
 */
export const TODAY_REVALIDATE = INGEST_INTERVAL_SEC;

/** Five minutes, for lookups that change at most a few times a day. */
export const FIVE_MINUTE_REVALIDATE = 300;

/**
 * TTL for a live day's heavier reads (a stop's day, the share cards): longer
 * than one ingest cycle, since they re-run a whole day's scan.
 */
export const LIVE_DAY_REVALIDATE = FIVE_MINUTE_REVALIDATE;

/** Ten minutes. */
export const TEN_MINUTE_REVALIDATE = 600;

/** One hour, for reference data that changes on the daily sync but is cheap to re-read. */
export const HOUR_REVALIDATE = SEC_PER_HOUR;

/** TTL for a week or month window still under way: an hour, since a day's share of it is small. */
export const PERIOD_REVALIDATE = HOUR_REVALIDATE;

/** Six hours. */
export const SIX_HOUR_REVALIDATE = 6 * SEC_PER_HOUR;

/** One day, for data that only changes on the daily GTFS sync. */
export const DAY_REVALIDATE = SEC_PER_DAY;

/**
 * TTL for a window that ended over an hour ago but has no nightly summary yet.
 * Trips still running at the 4am boundary have landed by then, so nothing moves
 * its figures until the summary starts its `final` entry.
 */
export const ENDED_REVALIDATE = 30 * 60;

/** TTL for a completed, classified service day's aggregation: it no longer changes. */
export const COMPLETED_DAY_REVALIDATE = 7 * SEC_PER_DAY;

/**
 * The TTL a page's reads take for its window: one ingest cycle on a day view
 * (today moves with every run), an hour on a week or month.
 * @param window - The page's window.
 * @returns The TTL, in seconds.
 */
export function revalidateFor(window: RangeWindow): number {
  return window === "day" ? TODAY_REVALIDATE : PERIOD_REVALIDATE;
}
