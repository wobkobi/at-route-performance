// src/app/api/routes/route.ts
// Read-only route directory. Routes are written by the GTFS ingest routes only.
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * List all routes ordered by long name.
 * @returns JSON array of routes.
 */
export async function GET(): Promise<NextResponse> {
  const r = await prisma.route.findMany({ orderBy: { longName: "asc" } });
  return NextResponse.json(r);
}
