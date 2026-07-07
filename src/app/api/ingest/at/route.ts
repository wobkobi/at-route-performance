// src/app/api/ingest/at/route.ts
/**
 * @description Cron-only POST that pulls AT's GTFS-RT trip updates and writes
 * stop-level arrival events, with a trip-level delay fallback when a trip only
 * carries an aggregate delay. Several safeguards keep the data clean: physically
 * impossible deviations are dropped as feed noise before they reach the DB,
 * cancellations are recorded once per trip per service day, and the vehicle feed
 * is joined best-effort so a feed outage leaves rows unnamed rather than failing.
 * Inserts go through ordered:false bulk commands so duplicate polls are skipped
 * in one round-trip per batch, making repeated runs idempotent.
 */
import { fetchATTripUpdates } from "@/lib/at";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlausibleDeviation } from "@/lib/deviation";
import { recordIngestRun } from "@/lib/ingest-run";
import { nzServiceDayRange } from "@/lib/time";
import { fetchVehicleByTrip } from "@/lib/vehicles";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

type StopRow = Prisma.ArrivalEventCreateManyInput;
type TripRow = Prisma.TripDelayCreateManyInput;

// Realtime feeds carry ~1.6k rows; give the function headroom over the default.
export const maxDuration = 60;

/** Max documents per bulk insert command (well under Mongo's limits). */
const INSERT_BATCH = 1000;

/**
 * Insert documents into a collection in batches, skipping duplicate-key rows
 * (ordered: false) in a single round-trip per batch - no per-document fallback
 * and no multi-document transaction.
 * @param collection - Target collection name.
 * @param docs - Extended-JSON documents (dates as `{ $date }`).
 * @returns Count actually inserted (duplicates excluded).
 */
async function bulkInsert(collection: string, docs: Record<string, unknown>[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const res = (await prisma.$runCommandRaw({
      insert: collection,
      documents: docs.slice(i, i + INSERT_BATCH) as never,
      ordered: false,
    })) as unknown as { n?: number };
    inserted += res.n ?? 0;
  }
  return inserted;
}

/**
 * Upsert arrival events keyed on the stop visit `(tripId, stopId, scheduledAt)`
 * in batches. GTFS-RT re-polls keep revising a stop's predicted arrival, so the
 * latest write wins per visit and converges on the final observation instead of
 * accumulating one row per revision (the old `actualAt` key admitted that).
 * @param docs - Extended-JSON arrival documents (dates as `{ $date }`).
 * @returns Count of rows written (matched or upserted).
 */
async function bulkUpsertArrivals(docs: Record<string, unknown>[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const res = (await prisma.$runCommandRaw({
      update: "ArrivalEvent",
      updates: docs.slice(i, i + INSERT_BATCH).map((doc) => ({
        q: { tripId: doc.tripId, stopId: doc.stopId, scheduledAt: doc.scheduledAt },
        u: { $set: doc },
        upsert: true,
      })) as never,
      ordered: false,
    })) as unknown as { n?: number };
    written += res.n ?? 0;
  }
  return written;
}

interface DebugStats {
  seen: number;
  withTU: number;
  withSTU: number;
  withTime: number;
  withDelay: number;
  withTripDelay: number;
  dropped: number;
  loose: boolean;
}

/**
 * Coerce a GTFS-RT `stop_time_update` value to an array.
 * Handles single-object or array inputs and returns a normalised array.
 * @template T
 * @param v - The raw `stop_time_update` value from the feed.
 * @returns An array form of `stop_time_update` (empty if input is nullish).
 */
function toStuArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Ingest AT GTFS-RT trip updates.
 * Inserts stop-level rows when STU has a timestamp (and delay unless `loose=1`).
 * Falls back to trip-level rows when only `trip_update.delay` exists.
 * Query params:
 * - `debug=1` Include counters and a sample row.
 * - `loose=1` Insert zero-delay rows when delay is missing.
 * - `peek=1`  Return feed shape info without inserting.
 * @param req - Incoming HTTP request containing optional query params.
 * @returns JSON summary or peek payload.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  if (!process.env.AT_API_KEY) {
    return NextResponse.json({ error: "AT_API_KEY missing" }, { status: 400 });
  }

  const url = new URL(req.url);
  const loose = url.searchParams.get("loose") === "1";
  const wantDebug = url.searchParams.has("debug");
  const wantPeek = url.searchParams.get("peek") === "1";

  try {
    const feed = await fetchATTripUpdates();

    if (wantPeek) {
      const tu = feed.entity.find((e) => e.trip_update)?.trip_update ?? null;
      const stuCount = toStuArray(tu?.stop_time_update as unknown[] | undefined).length;
      const hasTripDelay = typeof (tu as { delay?: unknown })?.delay === "number";
      return NextResponse.json({
        inserted: 0,
        tried: 0,
        tripInserted: 0,
        tripTried: 0,
        debug: {
          seen: feed.entity?.length ?? 0,
          withTU: tu ? 1 : 0,
          withSTU: stuCount,
          withTime: 0,
          withDelay: Number(hasTripDelay),
          withTripDelay: Number(hasTripDelay),
          dropped: 0,
          loose,
        } as DebugStats,
        sample: null,
      });
    }

    // The tripupdates feed has no vehicle, so join the vehicle-locations feed by
    // trip_id to name each running vehicle. Best-effort: an empty map (off-peak,
    // or the feed failing) just leaves rows without a vehicle, never fails ingest.
    const vehicleByTrip = await fetchVehicleByTrip().catch(() => new Map<string, string>());

    let seen = 0;
    let withTU = 0;
    let withSTU = 0;
    let withTime = 0;
    let withDelay = 0;
    let withTripDelay = 0;
    let dropped = 0; // rows skipped for an implausible deviation (feed noise)

    const stopRows: StopRow[] = [];
    const tripRows: TripRow[] = [];
    const cancelledRows: { tripId: string; routeId: string }[] = [];
    // Service day a cancellation belongs to (the one in progress when ingest runs).
    const serviceDate = nzServiceDayRange(new Date()).start;

    for (const e of feed.entity ?? []) {
      seen++;
      const tu = e.trip_update;
      if (!tu) continue;
      // schedule_relationship 3 = CANCELED: no valid stop times, so it never
      // becomes an ArrivalEvent. Record it (idempotent on the trip+day unique
      // key) so the route board can flag the cancellation, then skip the rest.
      if (tu.trip.schedule_relationship === 3) {
        if (tu.trip.trip_id && tu.trip.route_id) {
          cancelledRows.push({ tripId: tu.trip.trip_id, routeId: tu.trip.route_id });
        }
        continue;
      }
      withTU++;

      // A) Stop-level rows (handle single-object or array STU).
      const stuList = toStuArray(tu.stop_time_update);
      const rowsBefore = stopRows.length;
      // Tag every stop row with the running vehicle (the trip_update's own vehicle
      // if present, else the locations-feed join) so the trip boards can name it.
      const vehicleId =
        (typeof tu.vehicle?.id === "string" ? tu.vehicle.id : undefined) ??
        vehicleByTrip.get(tu.trip.trip_id);

      for (const stu of stuList) {
        withSTU++;
        const a = stu.arrival ?? stu.departure;
        if (!a?.time) continue;
        withTime++;

        const hasDelay =
          !(a.delay === undefined || a.delay === null) && typeof a.delay === "number";
        if (hasDelay) withDelay++;
        if (!hasDelay && !loose) continue;

        const delay = hasDelay ? (a.delay as number) : 0;
        // Drop physically-impossible deviations (feed noise) before they reach
        // the DB and pollute averages/on-time rates.
        if (hasDelay && !isPlausibleDeviation(delay)) {
          dropped++;
          continue;
        }
        const time = a.time as number;
        const actualAt = new Date(time * 1000);
        const scheduledAt = new Date((time - delay) * 1000);

        stopRows.push({
          routeId: tu.trip.route_id,
          stopId: stu.stop_id,
          tripId: tu.trip.trip_id,
          scheduledAt,
          actualAt,
          deviationSec: delay,
          vehicleId,
          source: hasDelay ? "AT_GTFSRT" : "AT_GTFSRT_NO_DELAY",
        });
      }

      // B) Trip-level fallback: fires when the loop above produced no rows for
      // this trip (either no STUs at all, or every STU lacked arrival.time).
      if (stopRows.length === rowsBefore) {
        const tDelay = (tu as { delay?: unknown }).delay;
        if (typeof tDelay === "number") {
          if (!isPlausibleDeviation(tDelay)) {
            dropped++;
            continue;
          }
          withTripDelay++;
          const ts =
            typeof tu.timestamp === "number" ? tu.timestamp : Math.floor(Date.now() / 1000);
          const veh = (tu as { vehicle?: { id?: unknown } }).vehicle;
          const vehId =
            (veh && typeof veh.id === "string" ? veh.id : undefined) ??
            vehicleByTrip.get(tu.trip.trip_id);

          tripRows.push({
            tripId: tu.trip.trip_id,
            routeId: tu.trip.route_id,
            vehicleId: vehId,
            timestamp: new Date(ts * 1000),
            delaySec: tDelay,
            source: "AT_GTFSRT_TU",
          });
        }
      }
    }

    // Upsert per stop visit so a revised prediction replaces the earlier row
    // rather than inserting a duplicate alongside it.
    const stopCount = await bulkUpsertArrivals(
      stopRows.map((r) => ({
        routeId: r.routeId,
        stopId: r.stopId,
        tripId: r.tripId,
        scheduledAt: { $date: new Date(r.scheduledAt).toISOString() },
        actualAt: { $date: new Date(r.actualAt).toISOString() },
        deviationSec: r.deviationSec,
        ...(r.source ? { source: r.source } : {}),
        ...(r.vehicleId ? { vehicleId: r.vehicleId } : {}),
      })),
    );
    const tripCount = await bulkInsert(
      "TripDelay",
      tripRows.map((r) => ({
        tripId: r.tripId,
        routeId: r.routeId,
        ...(r.vehicleId ? { vehicleId: r.vehicleId } : {}),
        timestamp: { $date: new Date(r.timestamp).toISOString() },
        delaySec: r.delaySec,
        ...(r.source ? { source: r.source } : {}),
      })),
    );

    // Idempotent: the @@unique([tripId, serviceDate]) index drops repeat polls of
    // the same cancellation (ordered: false), so this stays one row per trip per day.
    const cancelledCount = await bulkInsert(
      "CancelledTrip",
      cancelledRows.map((r) => ({
        tripId: r.tripId,
        routeId: r.routeId,
        serviceDate: { $date: serviceDate.toISOString() },
        detectedAt: { $date: new Date().toISOString() },
      })),
    );

    const stopResult = { count: stopCount };
    const tripResult = { count: tripCount };

    const body = {
      inserted: stopResult.count,
      tried: stopRows.length,
      tripInserted: tripResult.count,
      tripTried: tripRows.length,
      cancelledInserted: cancelledCount,
      cancelledTried: cancelledRows.length,
    } as {
      inserted: number;
      tried: number;
      tripInserted: number;
      tripTried: number;
      cancelledInserted: number;
      cancelledTried: number;
      debug?: DebugStats;
      sample?: StopRow | TripRow | null;
    };

    if (wantDebug) {
      body.debug = {
        seen,
        withTU,
        withSTU,
        withTime,
        withDelay,
        withTripDelay,
        dropped,
        loose,
      };
      body.sample = stopRows[0] ?? tripRows[0] ?? null;
    }

    const duration = Date.now() - startTime;

    // LOG for monitoring
    console.log("[INGEST]", {
      timestamp: new Date().toISOString(),
      inserted: stopResult.count,
      tried: stopRows.length,
      tripInserted: tripResult.count,
      tripTried: tripRows.length,
      dropped,
      duration_ms: duration,
      source: "cron",
    });

    await recordIngestRun({
      endpoint: "at",
      startedAt: new Date(startTime),
      success: true,
      count: stopResult.count + tripResult.count,
    });

    return NextResponse.json(body);
  } catch (err) {
    const duration = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : "unknown error";

    console.error("[INGEST] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: duration,
    });

    await recordIngestRun({
      endpoint: "at",
      startedAt: new Date(startTime),
      success: false,
      error: msg,
    });

    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
