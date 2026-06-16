// Top routes row returned by /api/routes/top
export interface TopRouteRow {
  route_id: string;
  short_name: string | null;
  long_name: string;
  mode: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number | null;
  on_time_pct: number | null;
}

// Summary object returned by /api/routes/[id]/stats
export interface RouteSummary {
  events: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

// stop row returned by /api/routes/[id]/stats
export interface RouteByStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  events: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}
