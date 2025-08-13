import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Summarize a route’s performance over a time window.
 * Defaults to the last 7 days. On-time = |deviationSec| ≤ thresholdSec.
 * @param _ Incoming request (unused).
 * @param ctx Route context.
 * @param ctx.params Route parameters.
 * @param ctx.params.id Route ID to summarize.
 * @returns JSON `{ summary, byStop }`.
 */
export async function GET(
  _: Request,
  ctx: { params: { id: string } }
): Promise<NextResponse> {
  const id = ctx.params.id;
  const url = new URL(_.url);
  const f = url.searchParams.get("from");
  const t = url.searchParams.get("to");
  const thresholdSec = Number(url.searchParams.get("thresholdSec") ?? "300");
  const start = f ? new Date(f) : new Date(Date.now() - 7 * 864e5);
  const end = t ? new Date(t) : new Date();

  const rows = await prisma.$queryRaw<
    Array<{
      events: number;
      avg_delay_sec: number | null;
      on_time_pct: number | null;
    }>
  >`
    SELECT COUNT(*)::int as events,
           AVG(ae.deviation_sec)::float as avg_delay_sec,
           100.0 * AVG( CASE WHEN ABS(ae.deviation_sec) <= ${thresholdSec} THEN 1 ELSE 0 END )::float as on_time_pct
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
    SELECT s.id as stop_id, s.name, COUNT(*)::int as events, AVG(ae.deviation_sec)::float as avg_delay_sec
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
