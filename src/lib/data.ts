// src/lib/data.ts
// Barrel over src/lib/data/*.ts: the server-side data-access layer, split by
// concern. Import sites use this path; each module below owns one concern.

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
export { getFilterUsage, type FilterUsage } from "@/lib/data/filter-usage";
export { getFilteredCancellations, getFilteredRankings } from "@/lib/data/filtered-rankings";
export type { FilteredCancellations } from "@/lib/data/filtered-rankings";
export { getGhostRun, getGhostRunFor } from "@/lib/data/ghost-runs";
export type { GhostRunRow } from "@/lib/data/ghost-runs";
export { getRecordedLiveTrips } from "@/lib/data/live-stored";
export { getNetworkLines } from "@/lib/data/network-lines";
export { getDetouredTripIds, getTripDetour } from "@/lib/data/off-route";
export type { TripDetour } from "@/lib/data/off-route";
export { getOperatorDirectory, getOperators, type OperatorDirectory } from "@/lib/data/operators";
export { getRankings, getTopRoutes } from "@/lib/data/rankings";
export type { TopRoutesParams } from "@/lib/data/rankings";
export {
  DAY_REVALIDATE,
  INGEST_INTERVAL_SEC,
  LIVE_DAY_REVALIDATE,
  PERIOD_REVALIDATE,
  TODAY_REVALIDATE,
  revalidateFor,
} from "@/lib/data/revalidate";
export { getRouteRiderWait, getTripRiderWait } from "@/lib/data/rider-wait";
export type { DayRiderWait } from "@/lib/data/rider-wait";
export { getRouteGeography } from "@/lib/data/route-areas";
export type { RouteGeography } from "@/lib/data/route-areas";
export { getRouteClosures } from "@/lib/data/route-closures";
export { getRecentStopIds, getRouteDailyStats, getRouteStats } from "@/lib/data/route-stats";
export type { RouteStats, RouteStatsParams } from "@/lib/data/route-stats";
export { getRouteStopSplit } from "@/lib/data/route-stop-split";
export {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getBusiestRouteSlugs,
  getDirectoryRoutes,
  getRouteLabel,
  getRouteModeMap,
  getRouteNames,
  getRouteOperators,
  ownRouteIds,
  routeHasTraffic,
  routeIdsForSlug,
} from "@/lib/data/routes";
export type { DirectoryRoute } from "@/lib/data/routes";
export { getShameDayHours } from "@/lib/data/shame-day-hours";
export type { ShameFilter } from "@/lib/data/shame-filter";
export {
  MIN_ROUTE_EVENTS_HOUR,
  cachedRouteBoardOfDay,
  getRouteBoardInHours,
  getRouteBoardOfDay,
  getRouteBoardOfWeek,
} from "@/lib/data/shame-routes";
export {
  MIN_STOP_EVENTS_HOUR,
  cachedStopBoardOfDay,
  getStopBoardInHours,
  getStopBoardOfDay,
  getStopBoardOfWeek,
} from "@/lib/data/shame-stops";
export { getShameStreaks } from "@/lib/data/shame-streaks";
export type { ShameStreak, StreakBoard } from "@/lib/data/shame-streaks";
export {
  SHAME_MIN_STOPS,
  SHAME_RANKED_LIMIT,
  cachedTripBoardOfDay,
  getTripBoardInHours,
  getTripBoardOfDay,
  getTripBoardOfWeek,
} from "@/lib/data/shame-trips";
export {
  listStops,
  searchStops,
  type StopListing,
  type StopMatch,
  type StopPage,
} from "@/lib/data/stop-search";
export { getStationSiblings, getStopIdentity, getStopStats } from "@/lib/data/stops";
export {
  getLatestTripDay,
  getRouteTripStats,
  getTripHeadsign,
  getTripScheduledStops,
  getTripShape,
  getTripTimeline,
} from "@/lib/data/trips";
export type { RouteTripStatsParams, ScheduledStop, TripSort } from "@/lib/data/trips";
export {
  getVehicleDayMap,
  getVehicleRunsOfDay,
  getVehicleWork,
  getVehicleWorkByDay,
} from "@/lib/data/vehicle-rank";
export { getVehicleCounts, getVehicleCountsAllTime } from "@/lib/data/vehicles-seen";
