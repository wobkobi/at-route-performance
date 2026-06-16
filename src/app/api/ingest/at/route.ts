// src/app/api/ingest/at/route.ts
import { fetchATTripUpdates } from "@/lib/at";
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

type StopRow = Prisma.ArrivalEventCreateManyInput;
type TripRow = Prisma.TripDelayCreateManyInput;

/**
 * Whether an error is a Prisma/Mongo duplicate-key violation (safe to skip).
 * @param e - The thrown error.
 * @returns True for unique-constraint (P2002) failures.
 */
function isDuplicateKey(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002";
}

interface DebugStats {
  seen: number;
  withTU: number;
  withSTU: number;
  withTime: number;
  withDelay: number;
  withTripDelay: number;
  loose: boolean;
}

/**
 * Coerce a GTFS-RT `stop_time_update` value to an array.
 * Handles single-object or array inputs and returns a normalized array.
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
          loose,
        } as DebugStats,
        sample: null,
      });
    }

    let seen = 0;
    let withTU = 0;
    let withSTU = 0;
    let withTime = 0;
    let withDelay = 0;
    let withTripDelay = 0;

    const stopRows: StopRow[] = [];
    const tripRows: TripRow[] = [];

    for (const e of feed.entity ?? []) {
      seen++;
      const tu = e.trip_update;
      if (!tu) continue;
      withTU++;

      // A) Stop-level rows (handle single-object or array STU).
      const stuList = toStuArray(tu.stop_time_update);

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
          source: hasDelay ? "AT_GTFSRT" : "AT_GTFSRT_NO_DELAY",
        });
      }

      // B) Trip-level fallback (no STU but trip-level delay present).
      if (stuList.length === 0) {
        const tDelay = (tu as { delay?: unknown }).delay;
        if (typeof tDelay === "number") {
          withTripDelay++;
          const ts =
            typeof tu.timestamp === "number" ? tu.timestamp : Math.floor(Date.now() / 1000);
          const veh = (tu as { vehicle?: { id?: unknown } }).vehicle;
          const vehId = veh && typeof veh.id === "string" ? veh.id : undefined;

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

    // MongoDB createMany doesn't support skipDuplicates.
    // Use ordered:false so inserts continue past duplicate-key errors.
    let stopCount = 0;
    if (stopRows.length > 0) {
      try {
        const r = await prisma.arrivalEvent.createMany({ data: stopRows });
        stopCount = r.count;
      } catch {
        // Bulk insert hit a duplicate: fall back to one-by-one, skipping only
        // duplicate-key collisions and rethrowing genuine failures.
        for (const row of stopRows) {
          try {
            await prisma.arrivalEvent.create({ data: row });
            stopCount++;
          } catch (e) {
            if (!isDuplicateKey(e)) throw e;
          }
        }
      }
    }

    let tripCount = 0;
    if (tripRows.length > 0) {
      try {
        const r = await prisma.tripDelay.createMany({ data: tripRows });
        tripCount = r.count;
      } catch {
        for (const row of tripRows) {
          try {
            await prisma.tripDelay.create({ data: row });
            tripCount++;
          } catch (e) {
            if (!isDuplicateKey(e)) throw e;
          }
        }
      }
    }

    const stopResult = { count: stopCount };
    const tripResult = { count: tripCount };

    const body = {
      inserted: stopResult.count,
      tried: stopRows.length,
      tripInserted: tripResult.count,
      tripTried: tripRows.length,
    } as {
      inserted: number;
      tried: number;
      tripInserted: number;
      tripTried: number;
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
      duration_ms: duration,
      source: "cron",
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

    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
