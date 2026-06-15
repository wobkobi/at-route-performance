// src/lib/rankings.ts
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

/** Default minimum events for board eligibility. */
export const MIN_BOARD_EVENTS = 10;
