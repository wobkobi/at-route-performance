// src/lib/data.ts
// Barrel over src/lib/data/*.ts: the server-side data-access layer, split by
// concern. Import sites use this path; each module below owns one concern.

export { TODAY_REVALIDATE } from "@/lib/data/cache";
export {
  getCancelledByRoute,
  getCancelledCount,
  getCancelledRoutes,
  getCancelledTrips,
  getNetworkCancelledTrips,
  getTripCancellation,
} from "@/lib/data/cancelled";
export type {
  CancelledRouteRow,
  CancelledTripRow,
  NetworkCancelledTrip,
  TripCancellation,
} from "@/lib/data/cancelled";
export {
  currentDayIsOpen,
  getEarliestDataDay,
  getLatestEventDate,
  getMostRecentDataDay,
} from "@/lib/data/data-days";
export { getGhostRun, getGhostRunFor } from "@/lib/data/ghost-runs";
export type { GhostRunRow } from "@/lib/data/ghost-runs";
export { getDetouredTripIds, getTripDetour } from "@/lib/data/off-route";
export type { TripDetour } from "@/lib/data/off-route";
export { getRankings, getTopRoutes } from "@/lib/data/rankings";
export type { TopRoutesParams } from "@/lib/data/rankings";
export { getRouteRiderWait, getTripRiderWait } from "@/lib/data/rider-wait";
export type { DayRiderWait } from "@/lib/data/rider-wait";
export { getRouteAreas } from "@/lib/data/route-areas";
export { getRouteClosures } from "@/lib/data/route-closures";
export { getRecentStopIds, getRouteDailyStats, getRouteStats } from "@/lib/data/route-stats";
export type { RouteStats, RouteStatsParams } from "@/lib/data/route-stats";
export { getRouteStopSplit } from "@/lib/data/route-stop-split";
export {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getBusiestRouteSlugs,
  getDirectoryRoutes,
  getRouteNames,
  ownRouteIds,
  routeHasTraffic,
  routeIdsForSlug,
} from "@/lib/data/routes";
export type { DirectoryRoute } from "@/lib/data/routes";
export { getShameDayHours } from "@/lib/data/shame-day-hours";
export type { ShameFilter } from "@/lib/data/shame-filter";
export {
  MIN_ROUTE_EVENTS_HOUR,
  cachedWorstRoutesOfDay,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRouteStreak,
  getShameRouteStreaksBatch,
} from "@/lib/data/shame-routes";
export {
  SHAME_MIN_STOPS,
  cachedWorstTripsOfDay,
  getShameOfDay,
  getShameOfWeek,
} from "@/lib/data/shame-trips";
export {
  MIN_STOP_EVENTS_HOUR,
  cachedWorstStopsOfDay,
  findCurrentStationId,
  getStationSiblings,
  getStopStats,
  getWorstStopsOfDay,
  getWorstStopsOfWeek,
} from "@/lib/data/stops";
export {
  getLatestTripDay,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
  getWorstTripsOfDay,
} from "@/lib/data/trips";
export type { ScheduledStop, TripSort, WorstTripsParams } from "@/lib/data/trips";
export { getVehicleRunsOfDay, getVehicleWork, getVehicleWorkByDay } from "@/lib/data/vehicle-rank";
export { getVehicleCounts, getVehicleCountsAllTime } from "@/lib/data/vehicles-seen";
