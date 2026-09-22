// src/app/api/ingest/at/route.ts
// Cron-only POST that pulls AT's GTFS-RT trip updates and writes
// stop-level arrival events, with a trip-level delay fallback when a trip only
// carries an aggregate delay. Every reading is stored as reported - separating a
// real delay from AT's trip_id block reuse needs the whole run, which only the
// nightly pass has (see deviation.ts), and a magnitude cut here would delete the
// worst genuine delays along with the noise. Cancellations are recorded once per
// trip per service day, and the vehicle feed is joined best-effort so a feed
// outage leaves rows unnamed rather than failing. The same vehicle read feeds
// the off-route check (lib/off-route.ts) and the fleet register
// (lib/fleet-store.ts), and the stop closures (lib/stop-closures.ts) are recorded
// last; all three are best-effort.
// Inserts go through ordered:false bulk commands so duplicate polls are skipped
// in one round-trip per batch, making repeated runs idempotent.

import { fetchATTripUpdates } from "@/lib/at";
import { requireCronAuth } from "@/lib/auth";
import { DUPLICATE_KEY, prisma, runCommand, throwOnWriteErrors } from "@/lib/db";
import { type ArrivalWrite, arrivalWriteStages, NO_DELAY_SOURCE } from "@/lib/deviation";
import { recordFleet } from "@/lib/fleet-store";
import { recordIngestRun } from "@/lib/ingest-run";
import { recordOffRouteSightings } from "@/lib/off-route-store";
import { cancelledServiceDate, runServiceDate } from "@/lib/run-day";
import { recordStopClosures } from "@/lib/stop-closure-store";
import { fetchVehicleSnapshot, type VehicleSnapshot } from "@/lib/vehicles";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

type StopRow = Prisma.ArrivalEventCreateManyInput;
type TripRow = Prisma.TripDelayCreateManyInput;

// No maxDuration here: the project default is already 300s, and any
// route-level value splits this route into its own function bundle, each
// carrying its own ~40MB copy of the Prisma engine.

/** Max documents per bulk insert command (well under Mongo's limits). */
const INSERT_BATCH = 1000;

/**
 * A poll already this long skips the closure step rather than run longer. Polls
 * take 8s at the median and 22s at p90, so only the slowest few skip, and each
 * closure row carries its own evidence, so the next poll makes a skip up.
 */
const CLOSURE_STEP_CUTOFF_MS = 60_000;

/**
 * Insert documents into a collection in batches, skipping duplicate-key rows
 * (ordered: false) in a single round-trip per batch - no per-document fallback
 * and no multi-document transaction. A duplicate key is the expected outcome of
 * a repeated poll; any other per-entry error fails the run, since the command
 * itself resolves even when entries were rejected. Each batch goes through the
 * connection-reset retry.
 * @param collection - Target collection name.
 * @param docs - Extended-JSON documents (dates as `{ $date }`).
 * @returns Count actually inserted (duplicates excluded).
 */
async function bulkInsert(collection: string, docs: Record<string, unknown>[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const res = (await runCommand(() =>
      prisma.$runCommandRaw({
        insert: collection,
        documents: docs.slice(i, i + INSERT_BATCH) as never,
        ordered: false,
      }),
    )) as unknown as { n?: number };
    throwOnWriteErrors(res, [DUPLICATE_KEY], `${collection} insert`);
    inserted += res.n ?? 0;
  }
  return inserted;
}

/** One stop visit as the upsert takes it: the key fields, then the values. */
interface ArrivalUpsert {
  tripId: string;
  stopId: string;
  scheduledAt: { $date: string };
  write: ArrivalWrite;
}

/**
 * Upsert arrival events keyed on the stop visit `(tripId, stopId, scheduledAt)`
 * in batches. GTFS-RT re-polls keep revising a stop's predicted arrival, so the
 * latest write wins per visit and converges on the final observation instead of
 * accumulating one row per revision. The write is a pipeline rather than a
 * blanket `$set`, so a second vehicle claiming the visit a cycle away cannot
 * overwrite the real arrival (see `arrivalWriteStages` in lib/deviation.ts).
 * @param docs - The visits to write, keys in extended JSON.
 * @returns Count of rows written (matched or upserted).
 */
async function bulkUpsertArrivals(docs: ArrivalUpsert[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const res = (await runCommand(() =>
      prisma.$runCommandRaw({
        update: "ArrivalEvent",
        updates: docs.slice(i, i + INSERT_BATCH).map((doc) => ({
          q: { tripId: doc.tripId, stopId: doc.stopId, scheduledAt: doc.scheduledAt },
          u: arrivalWriteStages(doc.write),
          upsert: true,
        })),
        ordered: false,
      }),
    )) as unknown as { n?: number };
    // Two overlapping polls can race an upsert of the same visit; the loser's
    // duplicate-key error means the row exists, which is the outcome wanted.
    throwOnWriteErrors(res, [DUPLICATE_KEY], "ArrivalEvent upsert");
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
  loose: boolean;
  /** Sampled trips carrying a non-empty `start_date`. Peek only. */
  withStartDate?: number;
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
      const withTrip = (feed.entity ?? []).filter((e) => e.trip_update).slice(0, 5);
      const tu = withTrip[0]?.trip_update ?? null;
      const stuCount = toStuArray(tu?.stop_time_update as unknown[] | undefined).length;
      const hasTripDelay = typeof (tu as { delay?: unknown })?.delay === "number";
      // The trip descriptor is echoed so the per-run service date can be settled
      // before it is relied on: a run's own `start_date` beats deriving the day
      // from schedule times, and whether AT populates the field is unverified.
      const trips = withTrip.map((e) => ({
        trip_id: e.trip_update?.trip.trip_id ?? null,
        start_date: e.trip_update?.trip.start_date ?? null,
        start_time: e.trip_update?.trip.start_time ?? null,
      }));
      const withStartDate = trips.filter(
        (t) => typeof t.start_date === "string" && t.start_date !== "",
      ).length;
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
          loose,
          withStartDate,
        },
        trips,
        sample: null,
      });
    }

    // The tripupdates feed has no vehicle, so join the vehicle-locations feed by
    // trip_id to name each running vehicle. Best-effort: an empty map (off-peak,
    // or the feed failing) just leaves rows without a vehicle, never fails ingest.
    const vehicles = await fetchVehicleSnapshot().catch((): VehicleSnapshot => ({
      byTrip: new Map(),
      carsByTrip: new Map(),
      readings: [],
      fleet: [],
    }));
    const vehicleByTrip = vehicles.byTrip;

    let seen = 0;
    let withTU = 0;
    let withSTU = 0;
    let withTime = 0;
    let withDelay = 0;
    let withTripDelay = 0;

    const stopRows: StopRow[] = [];
    const tripRows: TripRow[] = [];
    const cancelledRows: {
      tripId: string;
      routeId: string;
      serviceDate: string;
      startTime?: string;
    }[] = [];
    // The instant this poll ran, which is what dates a cancellation: a cancelled
    // trip carries no stop times, so there are no rows to take a run start from.
    const pollAt = new Date();

    for (const e of feed.entity ?? []) {
      seen++;
      const tu = e.trip_update;
      if (!tu) continue;
      // schedule_relationship 3 = CANCELED: no valid stop times, so it never
      // becomes an ArrivalEvent. Record it (idempotent on the trip+day unique
      // key) so the route board can flag the cancellation, then skip the rest.
      // The start time is kept so the board can place it in departure order.
      if (tu.trip.schedule_relationship === 3) {
        if (tu.trip.trip_id && tu.trip.route_id) {
          cancelledRows.push({
            tripId: tu.trip.trip_id,
            routeId: tu.trip.route_id,
            serviceDate: cancelledServiceDate({
              tripId: tu.trip.trip_id,
              startTime: tu.trip.start_time ?? null,
              startDate: tu.trip.start_date,
              detectedAt: pollAt,
            }),
            ...(typeof tu.trip.start_time === "string" ? { startTime: tu.trip.start_time } : {}),
          });
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
      const cars = vehicles.carsByTrip.get(tu.trip.trip_id);

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
        const time = a.time;
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
          ...(cars != null ? { cars } : {}),
          source: hasDelay ? "AT_GTFSRT" : NO_DELAY_SOURCE,
        });
      }

      // B) Trip-level fallback: fires when the loop above produced no rows for
      // this trip (either no STUs at all, or every STU lacked arrival.time).
      if (stopRows.length === rowsBefore) {
        const tDelay = (tu as { delay?: unknown }).delay;
        if (typeof tDelay === "number") {
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

      // C) Stamp this trip's rows with the run's own service date: AT's
      // `start_date` when the feed sends one, else the service day of the run's
      // earliest scheduled stop. One day per run, so a run crossing the
      // boundary hour is not split across two days.
      const runRows = stopRows.slice(rowsBefore);
      const firstRow = runRows[0];
      if (firstRow !== undefined) {
        let runStart = new Date(firstRow.scheduledAt);
        for (const r of runRows) {
          const at = new Date(r.scheduledAt);
          if (at < runStart) runStart = at;
        }
        const runDate = runServiceDate(tu.trip, runStart);
        for (const r of runRows) r.serviceDate = runDate;
      }
    }

    // Upsert per stop visit so a revised prediction replaces the earlier row
    // rather than inserting a duplicate alongside it. The key fields stay
    // extended JSON in the query; the value fields become the ArrivalWrite the
    // update pipeline reads.
    const stopCount = await bulkUpsertArrivals(
      stopRows.map((r) => ({
        tripId: r.tripId,
        stopId: r.stopId,
        scheduledAt: { $date: new Date(r.scheduledAt).toISOString() },
        write: {
          routeId: r.routeId,
          actualAtMs: new Date(r.actualAt).getTime(),
          deviationSec: r.deviationSec,
          vehicleId: r.vehicleId ?? undefined,
          cars: r.cars ?? undefined,
          source: r.source ?? undefined,
          serviceDate: r.serviceDate ?? undefined,
        },
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
    // the same cancellation (ordered: false), so this stays one row per trip per
    // run - including the 04:45 run that used to land on two days, because the
    // date now comes from the run rather than from when the poll happened to fire.
    const cancelledCount = await bulkInsert(
      "CancelledTrip",
      cancelledRows.map((r) => ({
        tripId: r.tripId,
        routeId: r.routeId,
        serviceDate: r.serviceDate,
        ...(r.startTime ? { startTime: r.startTime } : {}),
        detectedAt: { $date: new Date().toISOString() },
      })),
    );

    // Off-route readings never fail the poll: the arrival events above are the
    // point of the run, and a missed reading only shortens a detour by one poll.
    const offRouteCount = await recordOffRouteSightings(vehicles.readings, feed).catch(
      (err: unknown) => {
        console.warn("[INGEST] Off-route check failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return 0;
      },
    );

    // The fleet register is best-effort too: a missed write only leaves a label
    // one poll stale.
    const fleetCount = await recordFleet(vehicles.fleet).catch((err: unknown) => {
      console.warn("[INGEST] Fleet register write failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    });

    const closureCount =
      Date.now() - startTime > CLOSURE_STEP_CUTOFF_MS
        ? 0
        : await recordStopClosures(feed).catch((err: unknown) => {
            console.warn("[INGEST] Stop closure step failed", {
              error: err instanceof Error ? err.message : String(err),
            });
            return 0;
          });

    const stopResult = { count: stopCount };
    const tripResult = { count: tripCount };

    const body = {
      inserted: stopResult.count,
      tried: stopRows.length,
      tripInserted: tripResult.count,
      tripTried: tripRows.length,
      cancelledInserted: cancelledCount,
      cancelledTried: cancelledRows.length,
      offRouteInserted: offRouteCount,
      fleetWritten: fleetCount,
      closuresWritten: closureCount,
    } as {
      inserted: number;
      tried: number;
      tripInserted: number;
      tripTried: number;
      cancelledInserted: number;
      cancelledTried: number;
      offRouteInserted: number;
      fleetWritten: number;
      closuresWritten: number;
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
      offRouteInserted: offRouteCount,
      closuresWritten: closureCount,
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
