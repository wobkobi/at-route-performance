// src/app/api/routes/[id]/stats/route.ts
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

const MS_IN_DAY = 86_400_000;

interface SummaryRow {
  events: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

interface StopRow {
  stop_id: string;
  name: string;
  events: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

/**
 * Summarize a route over a window and list top stops.
 * Query: from,to,thresholdSec; sort=events|avg_delay|on_time_rate.
 * @param req HTTP request with query params.
 * @param ctx Route params promise with `{ id }`.
 * @param ctx.params Route parameters.
 * @returns JSON `{ summary, byStop }`.
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
  const sort = (url.searchParams.get("sort") ?? "events") as
    | "events"
    | "avg_delay"
    | "on_time_rate";

  const start = f ? new Date(f) : new Date(Date.now() - 7 * MS_IN_DAY);
  const end = t ? new Date(t) : new Date();

  // Summary (single row)
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      COUNT(*)::int AS events,
      AVG(ae."deviationSec")::float AS avg_delay_sec,
      100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec}
                       THEN 1 ELSE 0 END)::float AS on_time_pct
    FROM "ArrivalEvent" ae
    WHERE ae."routeId" = ${id}
      AND ae."scheduledAt" >= ${start}
      AND ae."scheduledAt" < ${end};
  `;

  // Stops table (ordering chosen via static branches)
  const byStop: StopRow[] =
    sort === "avg_delay"
      ? await prisma.$queryRaw<StopRow[]>`
          WITH stats AS (
            SELECT
              s.id AS stop_id,
              s.name,
              COUNT(*)::int AS events,
              AVG(ae."deviationSec")::float AS avg_delay_sec,
              100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec}
                               THEN 1 ELSE 0 END)::float AS on_time_pct
            FROM "ArrivalEvent" ae
            JOIN "Stop" s ON s.id = ae."stopId"
            WHERE ae."routeId" = ${id}
              AND ae."scheduledAt" >= ${start}
              AND ae."scheduledAt" < ${end}
            GROUP BY s.id, s.name
          )
          SELECT * FROM stats
          ORDER BY avg_delay_sec DESC NULLS LAST, events DESC
          LIMIT 50;
        `
      : sort === "on_time_rate"
        ? await prisma.$queryRaw<StopRow[]>`
          WITH stats AS (
            SELECT
              s.id AS stop_id,
              s.name,
              COUNT(*)::int AS events,
              AVG(ae."deviationSec")::float AS avg_delay_sec,
              100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec}
                               THEN 1 ELSE 0 END)::float AS on_time_pct
            FROM "ArrivalEvent" ae
            JOIN "Stop" s ON s.id = ae."stopId"
            WHERE ae."routeId" = ${id}
              AND ae."scheduledAt" >= ${start}
              AND ae."scheduledAt" < ${end}
            GROUP BY s.id, s.name
          )
          SELECT * FROM stats
          ORDER BY on_time_pct DESC NULLS LAST, events DESC
          LIMIT 50;
        `
        : await prisma.$queryRaw<StopRow[]>`
          WITH stats AS (
            SELECT
              s.id AS stop_id,
              s.name,
              COUNT(*)::int AS events,
              AVG(ae."deviationSec")::float AS avg_delay_sec,
              100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec}
                               THEN 1 ELSE 0 END)::float AS on_time_pct
            FROM "ArrivalEvent" ae
            JOIN "Stop" s ON s.id = ae."stopId"
            WHERE ae."routeId" = ${id}
              AND ae."scheduledAt" >= ${start}
              AND ae."scheduledAt" < ${end}
            GROUP BY s.id, s.name
          )
          SELECT * FROM stats
          ORDER BY events DESC
          LIMIT 50;
        `;

  return NextResponse.json({ summary: rows[0] ?? null, byStop });
}
