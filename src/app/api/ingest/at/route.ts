import { fetchATTripUpdates } from "@/lib/at";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * Ingest Auckland Transport GTFS-RT trip updates and persist arrival events.
 * Derives `scheduledAt = actualAt - delay`. Skips entities without `time` or `delay`.
 * @returns JSON body `{ inserted: number }`.
 */
export async function POST(): Promise<NextResponse> {
  const feed = await fetchATTripUpdates();
  const rows: Prisma.ArrivalEventCreateManyInput[] = [];

  for (const e of feed.entity) {
    const tu = e.trip_update;
    if (!tu) continue;
    for (const stu of tu.stop_time_update ?? []) {
      const a = stu.arrival ?? stu.departure;
      if (!a?.time || a.delay === undefined) continue; // need both to reconstruct schedule
      const actualAt = new Date(a.time * 1000);
      const scheduledAt = new Date((a.time - a.delay) * 1000);
      rows.push({
        routeId: tu.trip.route_id,
        stopId: stu.stop_id,
        tripId: tu.trip.trip_id,
        scheduledAt,
        actualAt,
        deviationSec: a.delay,
        vehicleId: undefined,
        source: "AT_GTFSRT",
      });
    }
  }

  if (rows.length) {
    await prisma.arrivalEvent.createMany({ data: rows, skipDuplicates: true });
  }
  return NextResponse.json({ inserted: rows.length });
}
