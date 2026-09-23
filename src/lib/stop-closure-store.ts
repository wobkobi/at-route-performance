// src/lib/stop-closure-store.ts
// The realtime ingest's closure step: gather this poll's evidence, let
// lib/stop-closures.ts decide what opened, grew and ended, and write the
// StopClosure rows back. Best-effort like the off-route step - the caller
// catches any failure, and each row carries its own evidence, so the next poll
// makes up a failed one.

import type { AtTripUpdates } from "@/lib/at";
import { getServiceAlerts } from "@/lib/at-alerts";
import { prisma } from "@/lib/db";
import { MIN_SIGHTINGS } from "@/lib/off-route";
import {
  alertStints,
  feedMarks,
  LOOKBACK_SEC,
  reconcileClosures,
  type AlertStint,
  type Closure,
  type ClosureKind,
  type ClosureSource,
  type RunTrace,
  type TraceArrival,
} from "@/lib/stop-closures";
import type { StopClosure } from "@prisma/client";

/**
 * How much earlier than the lookback an arrival's `scheduledAt` may sit and
 * still be read: a late run's real time trails its schedule.
 */
const LATE_SLACK_MS = 3_600_000;

/** The arrival fields a run's trace is built from. */
const ARRIVAL_FIELDS = {
  tripId: true,
  routeId: true,
  stopId: true,
  actualAt: true,
  vehicleId: true,
} as const;

/**
 * A stored row as the pure logic takes it. The collection holds only what this
 * module writes, so the two string unions are asserted rather than checked.
 * @param row - The Prisma row.
 * @returns The closure.
 */
function toClosure(row: StopClosure): Closure {
  return {
    ...row,
    kind: row.kind as ClosureKind,
    source: row.source as ClosureSource,
  };
}

/**
 * Record this poll's stop closures and detours.
 * @param feed - This poll's trip updates, for the skipped and timed stop times and each run's direction.
 * @param now - The current instant.
 * @returns How many rows were opened or changed.
 */
export async function recordStopClosures(feed: AtTripUpdates, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LOOKBACK_SEC * 1000);
  const [stored, alerts, sightings] = await Promise.all([
    prisma.stopClosure.findMany({ where: { OR: [{ to: null }, { to: { gte: since } }] } }),
    // A failed alerts feed leaves the alert rows alone rather than ending them all.
    getServiceAlerts()
      .then((a): AlertStint[] | null => alertStints(a, now))
      .catch((): AlertStint[] | null => null),
    prisma.offRouteSighting.findMany({
      where: { seenAt: { gte: since, lte: now } },
      select: { tripId: true, routeId: true, seenAt: true, alert: true },
    }),
  ]);
  const rows = stored.map(toClosure);
  const { skipped, served } = feedMarks(feed, now);

  // Trace the runs read off route often enough to count, and the runs timed at
  // the ends of an open seen detour or the stops of an announced one, which is
  // what clears or disputes them.
  const readingsByTrip = new Map<string, typeof sightings>();
  for (const s of sightings)
    readingsByTrip.set(s.tripId, [...(readingsByTrip.get(s.tripId) ?? []), s]);
  const sighted = [...readingsByTrip]
    .filter(([, list]) => list.length >= MIN_SIGHTINGS)
    .map(([tripId]) => tripId);
  const watchedStops = new Set<string>();
  const watchedRoutes = new Set<string>();
  for (const r of rows) {
    if (r.to !== null || r.routeId === null) continue;
    const stops =
      r.source === "seen"
        ? [r.fromStopId, r.toStopId]
        : r.source === "alert" && r.kind === "detour"
          ? r.stopIds
          : [];
    for (const s of stops) if (s) watchedStops.add(s);
    if (stops.length > 0) watchedRoutes.add(r.routeId);
  }
  const arrivalWindow = {
    scheduledAt: { gte: new Date(since.getTime() - LATE_SLACK_MS) },
    actualAt: { lte: now },
  };
  const [ofSighted, atStops] = await Promise.all([
    sighted.length > 0
      ? prisma.arrivalEvent.findMany({
          where: { tripId: { in: sighted }, ...arrivalWindow },
          select: ARRIVAL_FIELDS,
        })
      : [],
    watchedStops.size > 0
      ? prisma.arrivalEvent.findMany({
          where: {
            stopId: { in: [...watchedStops] },
            routeId: { in: [...watchedRoutes] },
            ...arrivalWindow,
          },
          select: ARRIVAL_FIELDS,
        })
      : [],
  ]);

  const arrivalsByTrip = new Map<
    string,
    { routeId: string; arrivals: Map<string, TraceArrival> }
  >();
  for (const a of [...ofSighted, ...atStops]) {
    const trip = arrivalsByTrip.get(a.tripId) ?? { routeId: a.routeId, arrivals: new Map() };
    trip.arrivals.set(`${a.stopId}|${a.actualAt.getTime()}`, {
      stopId: a.stopId,
      at: a.actualAt,
      vehicle: a.vehicleId != null,
    });
    arrivalsByTrip.set(a.tripId, trip);
  }
  // TripMeta holds each run's direction; the feed's own, for a run it still carries, fills any gap.
  const feedDirection = new Map<string, number>();
  for (const e of feed.entity) {
    const trip = e.trip_update?.trip;
    if (trip?.trip_id && typeof trip.direction_id === "number") {
      feedDirection.set(trip.trip_id, trip.direction_id);
    }
  }
  const metas =
    arrivalsByTrip.size > 0
      ? await prisma.tripMeta.findMany({
          where: { id: { in: [...arrivalsByTrip.keys()] } },
          select: { id: true, directionId: true },
        })
      : [];
  const directionOf = new Map(metas.map((m) => [m.id, m.directionId]));
  const runs: RunTrace[] = [...arrivalsByTrip].map(([tripId, trip]) => ({
    tripId,
    routeId: trip.routeId,
    directionId: directionOf.get(tripId) ?? feedDirection.get(tripId) ?? null,
    arrivals: [...trip.arrivals.values()],
    readings: (readingsByTrip.get(tripId) ?? []).map((s) => ({ at: s.seenAt, alert: s.alert })),
  }));

  const changed = reconcileClosures({ now, rows, alerts, skipped, served, runs });
  // A changed row is written whole: the logic returns every field, not a diff.
  await Promise.all(
    changed.map(({ id, ...data }) =>
      id === null
        ? prisma.stopClosure.create({ data })
        : prisma.stopClosure.update({ where: { id }, data }),
    ),
  );
  return changed.length;
}
