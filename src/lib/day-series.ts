// src/lib/day-series.ts
// The per-day series behind the Day by day page: each service day's figures and
// verdict, built the way the day view builds its strip so the two always agree.
import { summariseRows } from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";
import { dayVerdict, type VerdictBand } from "@/lib/verdict";
import type { TopRouteRow } from "@/types/api";
import type { FleetSummary } from "@/types/dashboard";

/** One service day on the chart and in the table. */
export type DaySlot =
  | { kind: "day"; date: string; summary: FleetSummary; verdict: VerdictBand | null }
  /** A day that has happened but recorded no arrivals under the filters. */
  | { kind: "empty"; date: string }
  /** A day of the window still to come. */
  | { kind: "future"; date: string };

/** What the page fetched for one past or current day. */
export interface DayData {
  /** The day's per-route rankings, cancellation penalty already applied. */
  rows: TopRouteRow[];
  /** Trips flagged cancelled that day under the same filters. */
  cancelled: number;
}

/**
 * Build one day's slot. Mirrors the day view: the rows are narrowed by mode and
 * school exactly as its board rows are, and summarised with the same
 * {@link summariseRows}, so a column always reads what `?day=` prints.
 * @param date - Service date (`YYYY-MM-DD`).
 * @param today - Today's service date.
 * @param data - The day's rows and cancelled count; unused for a future day.
 * @param filter - The active filters.
 * @param filter.mode - Restrict to this mode, or null for every mode.
 * @param filter.includeSchool - Whether school services count.
 * @returns The slot.
 */
export function daySlot(
  date: string,
  today: string,
  data: DayData | null,
  filter: { mode: string | null; includeSchool: boolean },
): DaySlot {
  if (date > today) return { kind: "future", date };
  if (!data) return { kind: "empty", date };
  const moded = filter.mode ? data.rows.filter((r) => r.mode === filter.mode) : data.rows;
  const visible = filter.includeSchool
    ? moded
    : moded.filter((r) => !isSchoolBus(r.short_name, r.long_name));
  const summary = { ...summariseRows(visible), cancelled: data.cancelled };
  if (summary.events === 0) return { kind: "empty", date };
  return { kind: "day", date, summary, verdict: dayVerdict(summary.on_time_pct) };
}
