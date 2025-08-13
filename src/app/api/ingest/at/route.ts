import { fetchATTripUpdates } from "@/lib/at";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/** Debug counters returned by the ingest endpoint. */
interface IngestDebug {
  /** Total entities in the feed. */
  seen: number;
  /** Entities that contained a trip_update. */
  withTU: number;
  /** Count of processed stop_time_update entries. */
  withSTU: number;
  /** stop_time_update entries that had a timestamp. */
  withTime: number;
  /** stop_time_update entries that had an explicit delay. */
  withDelay: number;
  /** Whether zero-delay fallback insertion was enabled. */
  loose: boolean;
}

/**
 * Ingest AT GTFS-RT trip updates.
 * Inserts rows with explicit delay; `loose=1` inserts zero-delay rows.
 * @param req Incoming request. Query: `debug` to include counters, `loose=1` to allow zero delay.
 * @returns JSON `{ inserted, tried, debug?, sample? }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.AT_API_KEY) {
    return NextResponse.json({ error: "AT_API_KEY missing" }, { status: 400 });
  }

  const url = new URL(req.url);
  const loose = url.searchParams.get("loose") === "1";
  const wantDebug = url.searchParams.has("debug");

  try {
    const feed = await fetchATTripUpdates();

    let seen = 0;
    let withTU = 0;
    let withSTU = 0;
    let withTime = 0;
    let withDelay = 0;

    const rows: Prisma.ArrivalEventCreateManyInput[] = [];

    for (const e of feed.entity ?? []) {
      seen++;
      const tu = e.trip_update;
      if (!tu) continue;
      withTU++;

      for (const stu of tu.stop_time_update ?? []) {
        withSTU++;
        const a = stu.arrival ?? stu.departure;
        if (!a?.time) continue;
        withTime++;

        const hasDelay = !(a.delay === undefined || a.delay === null);
        if (hasDelay) withDelay++;
        if (!hasDelay && !loose) continue;

        const delay = hasDelay ? a.delay! : 0;
        const actualAt = new Date(a.time * 1000);
        const scheduledAt = new Date((a.time - delay) * 1000);

        rows.push({
          routeId: tu.trip.route_id,
          stopId: stu.stop_id,
          tripId: tu.trip.trip_id,
          scheduledAt,
          actualAt,
          deviationSec: delay,
          source: hasDelay ? "AT_GTFSRT" : "AT_GTFSRT_NO_DELAY",
        });
      }
    }

    const result = rows.length
      ? await prisma.arrivalEvent.createMany({
          data: rows,
          skipDuplicates: true,
        })
      : { count: 0 };

    const body: {
      inserted: number;
      tried: number;
      debug?: IngestDebug;
      sample?: Prisma.ArrivalEventCreateManyInput | null;
    } = {
      inserted: result.count,
      tried: rows.length,
    };

    if (wantDebug) {
      body.debug = { seen, withTU, withSTU, withTime, withDelay, loose };
      body.sample = rows[0] ?? null;
    }

    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    );
  }
}
