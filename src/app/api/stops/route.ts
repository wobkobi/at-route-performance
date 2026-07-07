// src/app/api/stops/route.ts
// Read-only stop directory. Stops are written by the GTFS ingest routes only.
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * List all stops ordered by name.
 * @returns JSON array of stops.
 */
export async function GET(): Promise<NextResponse> {
  const s = await prisma.stop.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(s);
}
