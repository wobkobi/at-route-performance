// src/lib/data.ts
// Barrel over src/lib/data/*.ts: the server-side data-access layer, split by
// concern. Import sites use this path; each module below owns one concern.

export {
  getCancelledByRoute,
  getCancelledCount,
  getCancelledRoutes,
  getCancelledTrips,
  getTripCancellation,
} from "@/lib/data/cancelled";
export type { CancelledRouteRow, CancelledTripRow, TripCancellation } from "@/lib/data/cancelled";
export { getEarliestDataDay, getLatestEventDate, getMostRecentDataDay } from "@/lib/data/data-days";
export { getRankings, getTopRoutes } from "@/lib/data/rankings";
export type { TopRoutesParams } from "@/lib/data/rankings";
export { getRouteAreas } from "@/lib/data/route-areas";
export { getRecentStopIds, getRouteDailyStats, getRouteStats } from "@/lib/data/route-stats";
export type { RouteStats, RouteStatsParams } from "@/lib/data/route-stats";
export {
  findCanonicalRouteSlug,
  findSuccessorRouteSlug,
  getDirectoryRoutes,
  getRouteNames,
  ownRouteIds,
  routeHasTraffic,
  routeIdsForSlug,
} from "@/lib/data/routes";
export type { DirectoryRoute } from "@/lib/data/routes";
export type { ShameFilter } from "@/lib/data/shame-filter";
export {
  cachedWorstRoutesOfDay,
  getShameRouteOfDay,
  getShameRouteOfWeek,
  getShameRouteStreak,
  getShameRouteStreaksBatch,
} from "@/lib/data/shame-routes";
export { cachedWorstTripsOfDay, getShameOfDay, getShameOfWeek } from "@/lib/data/shame-trips";
export {
  cachedWorstStopsOfDay,
  findCurrentStationId,
  getStopStats,
  getWorstStops,
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
