// src/app/api/ingest/gtfs/stops/route.ts
import { fetchStops, type StopAttr } from "@/lib/at-static";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Ingest GTFS stops from AT v3 into the Stop table.
 * Optional `?date=YYYY-MM-DD` selects service date.
 * @param req Request with optional `date` query param.
 * @returns JSON `{ inserted: number }`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  const stops: StopAttr[] = await fetchStops(date);

  const rows = stops
    .filter(
      (s) =>
        s.stop_id &&
        s.stop_name &&
        Number.isFinite(s.stop_lat) &&
        Number.isFinite(s.stop_lon)
    )
    .map((s) => ({
      id: s.stop_id,
      name: s.stop_name,
      code: s.stop_code ?? null,
      lat: s.stop_lat,
      lon: s.stop_lon,
    }));

  if (rows.length) {
    await prisma.stop.createMany({ data: rows, skipDuplicates: true });
  }
  return NextResponse.json({ inserted: rows.length });
}
