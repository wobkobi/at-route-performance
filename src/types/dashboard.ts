// src/types/dashboard.ts

/** Fleet-wide totals for a window. */
export interface FleetSummary {
  events: number;
  on_time_pct: number | null;
  avg_delay_sec: number | null;
  route_count: number;
}

/** Per-mode aggregate for a window. */
export interface ModeStat {
  mode: "BUS" | "TRAIN" | "FERRY";
  events: number;
  on_time_pct: number | null;
  avg_delay_sec: number | null;
}
