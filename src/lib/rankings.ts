// src/lib/rankings.ts
import type { RouteSort } from "@/components/RouteTable";
import type { TopRouteRow } from "@/types/api";

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
    .sort((a, b) => (b.on_time_pct as number) - (a.on_time_pct as number))
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
 * Rank routes by how far off schedule they ran, worst first (largest absolute
 * average deviation). Optionally restrict to late-only or early-only routes;
 * each row keeps its signed average so the direction stays visible.
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
  return [...eligible]
    .sort((a, b) => Math.abs(b.avg_delay_sec as number) - Math.abs(a.avg_delay_sec as number))
    .slice(0, size);
}

/** Default minimum events for board eligibility. */
export const MIN_BOARD_EVENTS = 10;

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
