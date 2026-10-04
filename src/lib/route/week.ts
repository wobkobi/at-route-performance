// src/lib/route/week.ts
// A route's week figures, folded from its per-day summaries. Shared by the
// route page's week view and its shared-link card, so the two print one number.
import { byEvents, weightedMean } from "@/lib/stats";
import type { RouteDay } from "@/types/api";

/** A route's figures over several days, weighted by each day's arrivals. */
export interface RouteWeekFigures {
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number | null;
  on_time_pct: number | null;
}

/**
 * Event-weighted aggregate of per-day route stats from `DailyRouteSummary`, so
 * a quiet day counts for less than a busy one. A day with no figure is left out
 * of that figure's mean rather than read as zero.
 * @param days - Per-day stats, any order.
 * @returns The weighted figures, or null when there are no days or no events.
 */
export function aggregateWeek(days: RouteDay[]): RouteWeekFigures | null {
  const totalEvents = days.reduce((s, d) => s + d.events, 0);
  if (totalEvents === 0) return null;
  return {
    events: totalEvents,
    avg_delay_sec: weightedMean(days, (d) => d.avg_delay_sec, byEvents),
    avg_abs_delay_sec: weightedMean(days, (d) => d.avg_abs_delay_sec, byEvents),
    on_time_pct: weightedMean(days, (d) => d.on_time_pct, byEvents),
  };
}
