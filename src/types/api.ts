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

// One run (trip) of a route on a day, for the "worst bus of the day" ranking.
export interface PerTripStat {
  trip_id: string;
  vehicle_id: string | null;
  /** ISO instant of the run's earliest scheduled stop. */
  scheduled_start: string;
  stops: number;
  /** Signed average deviation (negative early, positive late). */
  avg_delay_sec: number | null;
  /** Average absolute deviation; the worst-trip sort key. */
  avg_abs_delay_sec: number | null;
  /** Largest single late deviation on the run. */
  worst_delay_sec: number | null;
}

// One stop on a single trip's scheduled-vs-actual timeline.
export interface TripStop {
  stop_id: string;
  name: string;
  /** ISO instant the vehicle was scheduled at this stop. */
  scheduled_at: string;
  /** Signed deviation in seconds (negative early, positive late). */
  deviation_sec: number;
}

// A single trip's stop-by-stop timeline.
export interface TripTimeline {
  trip_id: string;
  route: { shortName: string | null; longName: string; mode: string } | null;
  vehicle_id: string | null;
  stops: TripStop[];
}

// One distinct stopping pattern of a route in a single direction.
export interface RouteVariant {
  /** Trip headsign (destination), when the schedule reports one. */
  headsign: string | null;
  directionId: number;
  /** How many trips run this exact pattern (drives trunk selection). */
  tripCount: number;
  /** Stop ids in schedule (stop_sequence) order. */
  stopIds: string[];
  /** GTFS shape id for the road geometry, when the schedule reports one. */
  shapeId: string | null;
}

// A route's stopping patterns grouped by direction.
export interface RoutePattern {
  directions: Record<number, { variants: RouteVariant[] }>;
}
