// src/app/api/routes/[id]/stats/route.ts
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

const MS_IN_DAY = 86_400_000;

/**
 * Summarize a route’s performance over a time window.
 * Defaults to last 7 days. On-time if |deviationSec| ≤ thresholdSec.
 * @param req - Incoming request used for query params.
 * @param ctx - Route context object.
 * @param ctx.params - Route parameters.
 * @returns JSON payload `{ summary, byStop }`.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const f = url.searchParams.get("from");
  const t = url.searchParams.get("to");
  const thresholdSec = Number(url.searchParams.get("thresholdSec") ?? "300");
  const start = f ? new Date(f) : new Date(Date.now() - 7 * MS_IN_DAY);
  const end = t ? new Date(t) : new Date();

  const rows = await prisma.$queryRaw<
    Array<{
      events: number;
      avg_delay_sec: number | null;
      on_time_pct: number | null;
    }>
  >`
    SELECT COUNT(*)::int AS events,
       AVG(ae."deviationSec")::float AS avg_delay_sec,
       100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec} THEN 1 ELSE 0 END)::float AS on_time_pct
    FROM "ArrivalEvent" ae
    WHERE ae."routeId" = ${id}
      AND ae."scheduledAt" >= ${start} AND ae."scheduledAt" < ${end};

  `;

  const byStop = await prisma.$queryRaw<
    Array<{
      stop_id: string;
      name: string;
      events: number;
      avg_delay_sec: number | null;
    }>
  >`
    SELECT s.id AS stop_id, s.name,
          COUNT(*)::int AS events,
          AVG(ae."deviationSec")::float AS avg_delay_sec
    FROM "ArrivalEvent" ae
    JOIN "Stop" s ON s.id = ae."stopId"
    WHERE ae."routeId" = ${id}
      AND ae."scheduledAt" >= ${start} AND ae."scheduledAt" < ${end}
    GROUP BY s.id, s.name
    ORDER BY events DESC
    LIMIT 50;
  `;

  return NextResponse.json({ summary: rows[0] ?? null, byStop });
}
