// src/lib/rankings.ts
import type { RouteSort } from "@/components/RouteTable";
import type { TopRouteRow } from "@/types/api";
import type { FleetSummary } from "@/types/dashboard";

/**
 * Aggregate per-route rows into fleet-wide totals (event-weighted), so the KPI
 * strip reflects exactly the rows on screen - turning school buses off (or
 * filtering by mode) drops their events from the totals too.
 * @param rows - The filtered per-route rows.
 * @returns Totals: events, distinct routes, weighted average delay and on-time %.
 */
export function summariseRows(rows: TopRouteRow[]): FleetSummary {
  let events = 0;
  let delayWeighted = 0;
  let absWeighted = 0;
  let onTimeCount = 0;
  let earlyCount = 0;
  let lateCount = 0;
  for (const r of rows) {
    events += r.events;
    delayWeighted += (r.avg_delay_sec ?? 0) * r.events;
    absWeighted += (r.avg_abs_delay_sec ?? 0) * r.events;
    onTimeCount += ((r.on_time_pct ?? 0) / 100) * r.events;
    earlyCount += ((r.early_pct ?? 0) / 100) * r.events;
    lateCount += ((r.late_pct ?? 0) / 100) * r.events;
  }
  if (events === 0) {
    return {
      events: 0,
      route_count: rows.length,
      avg_delay_sec: null,
      avg_abs_delay_sec: null,
      on_time_pct: null,
      early_pct: null,
      late_pct: null,
    };
  }
  // Event-weighted; seconds to one decimal, band shares to one-decimal percent.
  return {
    events,
    route_count: rows.length,
    avg_delay_sec: Math.round((delayWeighted / events) * 10) / 10,
    avg_abs_delay_sec: Math.round((absWeighted / events) * 10) / 10,
    on_time_pct: Math.round((onTimeCount / events) * 1000) / 10,
    early_pct: Math.round((earlyCount / events) * 1000) / 10,
    late_pct: Math.round((lateCount / events) * 1000) / 10,
  };
}

/** The three leaderboards derived from a window's per-route rows. */
export interface Boards {
  /** Most behind schedule first (highest positive average delay). */
  latest: TopRouteRow[];
  /** Most ahead of schedule first (most-negative average delay). */
  earliest: TopRouteRow[];
  /** Highest on-time percentage first. */
  reliable: TopRouteRow[];
}

/** Options for {@link deriveBoards}. */
export interface DeriveBoardsOptions {
  /** Minimum events for a route to qualify for any board. */
  minEvents: number;
  /** Max rows per board (default 10). */
  size?: number;
}

/**
 * Build the earliest/latest/most-reliable boards from per-route rows.
 * Routes below the event threshold, or missing the relevant metric, are excluded.
 * @param rows - Per-route aggregated rows for the window.
 * @param options - Event threshold and board size.
 * @returns The three sorted, sliced boards.
 */
export function deriveBoards(rows: TopRouteRow[], options: DeriveBoardsOptions): Boards {
  const size = options.size ?? 10;
  const eligible = rows.filter((r) => r.events >= options.minEvents);

  const byDelay = eligible.filter((r) => r.avg_delay_sec !== null);
  const byPct = eligible.filter((r) => r.on_time_pct !== null);

  const latest = [...byDelay]
    .sort((a, b) => (b.avg_delay_sec as number) - (a.avg_delay_sec as number))
    .slice(0, size);
  const earliest = [...byDelay]
    .sort((a, b) => (a.avg_delay_sec as number) - (b.avg_delay_sec as number))
    .slice(0, size);
  const reliable = [...byPct]
    .sort((a, b) => {
      const pctDiff = (b.on_time_pct as number) - (a.on_time_pct as number);
      if (pctDiff !== 0) return pctDiff;
      // Tiebreak by average absolute deviation - lower is more reliable.
      return (a.avg_abs_delay_sec ?? 0) - (b.avg_abs_delay_sec ?? 0);
    })
    .slice(0, size);

  return { latest, earliest, reliable };
}

/** Delay direction filter: late only, early only, or null for both. */
export type DelayDirection = "late" | "early" | null;

/** Options for {@link deriveOffSchedule}. */
export interface OffScheduleOptions {
  /** Minimum events for a route to qualify. */
  minEvents: number;
  /** Max rows (default 10). */
  size?: number;
  /** Restrict to late-only or early-only routes; null keeps both. */
  direction?: DelayDirection;
}

/**
 * Rank routes by the size of their average deviation, worst first - so the
 * biggest delays show regardless of direction (early and late mix). The on-time
 * window only drives each row's colour, not the order. Optionally restrict to
 * late-only or early-only routes; each row keeps its signed average so the
 * direction stays visible.
 * @param rows - Per-route aggregated rows for the window.
 * @param options - Event threshold, board size, and optional direction filter.
 * @returns The sorted, sliced board.
 */
export function deriveOffSchedule(rows: TopRouteRow[], options: OffScheduleOptions): TopRouteRow[] {
  const size = options.size ?? 10;
  let eligible = rows.filter((r) => r.events >= options.minEvents && r.avg_delay_sec !== null);
  if (options.direction === "late") {
    eligible = eligible.filter((r) => (r.avg_delay_sec as number) > 0);
  } else if (options.direction === "early") {
    eligible = eligible.filter((r) => (r.avg_delay_sec as number) < 0);
  }
  // avg_abs_delay_sec is the average of |delay| per trip, which captures routes
  // that are unreliable in both directions (e.g. sometimes very early, sometimes
  // very late) even when their signed average is near zero.
  return [...eligible]
    .sort((a, b) => {
      const scoreA = a.avg_abs_delay_sec ?? Math.abs(a.avg_delay_sec as number);
      const scoreB = b.avg_abs_delay_sec ?? Math.abs(b.avg_delay_sec as number);
      return scoreB - scoreA;
    })
    .slice(0, size);
}

/** Default minimum events for board eligibility. */
export const MIN_BOARD_EVENTS = 10;

/**
 * Lower board-eligibility threshold used when a single mode is filtered. Ferries
 * (and other low-frequency services) run few times a day, so the default
 * `MIN_BOARD_EVENTS` would empty their boards; a focused mode view shows them.
 */
export const MIN_MODE_EVENTS = 3;

/**
 * Compare two same-type boards and compute how many positions each route moved
 * since the previous period. A positive delta means the route climbed (rank number
 * decreased); negative means it fell. Null marks a new entry absent from the
 * previous board.
 * @param current - Ordered current-period rows (index 0 = rank 1).
 * @param previous - Ordered previous-period rows.
 * @returns Map of route_id to position delta, or null for new entries.
 */
export function computeRankDelta(
  current: TopRouteRow[],
  previous: TopRouteRow[],
): Map<string, number | null> {
  const prevRank = new Map<string, number>();
  previous.forEach((r, i) => prevRank.set(r.route_id, i + 1));
  const out = new Map<string, number | null>();
  current.forEach((r, i) => {
    const prev = prevRank.get(r.route_id);
    out.set(r.route_id, prev == null ? null : prev - (i + 1));
  });
  return out;
}

/**
 * Sort rows for the full table by the requested column (stable copy).
 * @param rows - Rows to sort.
 * @param sort - Column to sort by.
 * @returns A new sorted array.
 */
export function sortRows(rows: TopRouteRow[], sort: RouteSort): TopRouteRow[] {
  const copy = [...rows];
  switch (sort) {
    case "events":
      return copy.sort((a, b) => b.events - a.events);
    case "avg_delay":
      return copy.sort((a, b) => (b.avg_delay_sec ?? 0) - (a.avg_delay_sec ?? 0));
    case "on_time":
      return copy.sort((a, b) => (b.on_time_pct ?? -1) - (a.on_time_pct ?? -1));
    case "route":
    default:
      return copy.sort((a, b) =>
        (a.short_name ?? a.route_id).localeCompare(b.short_name ?? b.route_id),
      );
  }
}
