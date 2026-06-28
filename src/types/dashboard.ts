// src/types/dashboard.ts

/** Fleet-wide totals for a window. */
export interface FleetSummary {
  events: number;
  on_time_pct: number | null;
  avg_delay_sec: number | null;
  /** Average absolute deviation (the "off by" magnitude). */
  avg_abs_delay_sec: number | null;
  /** Percent of events ahead of the early tolerance. */
  early_pct: number | null;
  /** Percent of events beyond the late bound. */
  late_pct: number | null;
  route_count: number;
}

/** Per-mode aggregate for a window. */
export interface ModeStat {
  mode: "BUS" | "TRAIN" | "FERRY";
  events: number;
  on_time_pct: number | null;
  avg_delay_sec: number | null;
  route_count: number;
}

/** One run nominated as a day's (or hour's) worst, for the Shame board. */
export interface ShameTrip {
  /** Auckland-local hour (0-23) of the run's first scheduled stop. */
  hour: number;
  /** Auckland-local service date (`YYYY-MM-DD`); present only in week-view entries. */
  date?: string;
  trip_id: string;
  route_id: string;
  short_name: string | null;
  long_name: string;
  mode: string;
  colour?: string | null;
  /** ISO instant of the run's earliest scheduled stop. */
  scheduled_start: string;
  stops: number;
  /** Average absolute deviation - how far off schedule the run ran. */
  avg_abs_delay_sec: number;
  /** Signed average deviation (negative early, positive late). */
  avg_delay_sec: number;
  /** Largest single late deviation on the run. */
  worst_delay_sec: number;
  /** GTFS trip_headsign (destination shown on the vehicle), when available. */
  headsign?: string | null;
}

/** The day's single worst run plus the worst run of each hour. */
export interface ShameOfDay {
  worst: ShameTrip | null;
  /** Worst run per hour with data, ordered earliest hour first. */
  hours: ShameTrip[];
}

/** The week's single worst run plus the worst run of each service day. */
export interface ShameOfWeek {
  worst: ShameTrip | null;
  /** Worst run per service day with data, ordered earliest day first (`date` is set on each). */
  days: ShameTrip[];
}

/** One stop nominated as an hour's worst for the Stop Shame board. */
export interface ShameStop {
  /** Auckland-local hour (0-23) of the window. */
  hour: number;
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  mode: "BUS" | "TRAIN" | "FERRY";
}

/** The day's worst stop per hour, for the Stop Shame day board. */
export interface ShameStopOfDay {
  worst: ShameStop | null;
  /** Worst stop per hour with data, ordered earliest hour first. */
  hours: ShameStop[];
}

/** One stop nominated as a day's worst for the Stop Shame week board. */
export interface ShameDayStop {
  /** Auckland-local service date (`YYYY-MM-DD`). */
  date: string;
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number;
  mode: "BUS" | "TRAIN" | "FERRY";
}

/** The week's worst stop per service day, for the Stop Shame week board. */
export interface ShameStopOfWeek {
  worst: ShameDayStop | null;
  /** Worst stop per service day, ordered earliest day first. */
  days: ShameDayStop[];
}

/**
 * A run of consecutive "bad" service days ending with the current service day,
 * derived from the last 7 days of DailyRouteSummary data. A day is bad when the
 * worst-route average absolute delay exceeds 120 seconds.
 */
export interface ShameStreak {
  /** Consecutive bad days ending with today (0 = no streak). */
  count: number;
  /** Whether max delays trended up, down, or flat across the streak window. */
  trend: "worsening" | "improving" | "stable";
  /** Per-day delay snapshots (up to 7), earliest first. */
  recentDelays: { date: string; avgAbsDelaySec: number | null }[];
}

/** One route nominated as an hour's or day's worst, for the Route Shame board. */
export interface ShameRouteRow {
  /** Auckland-local hour (0-23) of the window; `0` in week-view entries. */
  hour: number;
  /** Auckland-local service date (`YYYY-MM-DD`); present only in week-view entries. */
  date?: string;
  route_id: string;
  short_name: string | null;
  long_name: string;
  mode: string;
  colour?: string | null;
  /** Arrival events observed for this route in the window. */
  events: number;
  /** Average absolute deviation. */
  avg_abs_delay_sec: number;
  /** Signed average deviation (negative early, positive late). */
  avg_delay_sec: number;
}

/** The day's worst route per hour, for the Route Shame day board. */
export interface ShameRouteOfDay {
  worst: ShameRouteRow | null;
  /** Worst route per hour with data, ordered earliest hour first. */
  hours: ShameRouteRow[];
}

/** The week's worst route per service day, for the Route Shame week board. */
export interface ShameRouteOfWeek {
  worst: ShameRouteRow | null;
  /** Worst route per service day with data, ordered earliest day first (`date` is set on each). */
  days: ShameRouteRow[];
}

/** A stop ranked by how far off schedule its services ran, across every route. */
export interface WorstStop {
  /** Canonical stop id (train platforms collapsed to one station id). */
  stop_id: string;
  name: string;
  /** Arrival events observed at the stop in the window. */
  events: number;
  /** Signed average deviation (negative early, positive late), or null. */
  avg_delay_sec: number | null;
  /** Average absolute deviation - the off-schedule magnitude (the sort key). */
  avg_abs_delay_sec: number;
  /** Dominant mode of the routes that call at this stop. */
  mode: "BUS" | "TRAIN" | "FERRY";
}
