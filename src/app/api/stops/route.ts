// src/app/api/stops/route.ts
// Read-only stop directory. Stops are written by the GTFS ingest routes only.
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/** Rows per page. The full directory is ~6,800 stops. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * List stops ordered by name, paginated.
 *
 * Paginated rather than dumping the collection: this is a public endpoint on a
 * self-hosted database, and an unbounded full-table read is both the slowest
 * query on the site and the cheapest way to hammer it.
 * @param req - Incoming request; `?limit` (default 200, max 1000) and `?offset`.
 * @returns JSON `{ stops, limit, offset, total }`.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(sp.get("limit") ?? "", 10) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number.parseInt(sp.get("offset") ?? "", 10) || 0);

  const [stops, total] = await Promise.all([
    prisma.stop.findMany({
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
      select: { id: true, name: true, code: true, lat: true, lon: true },
    }),
    prisma.stop.count(),
  ]);

  return NextResponse.json(
    { stops, limit, offset, total },
    // The stop directory only changes on the daily GTFS sync.
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" } },
  );
}
