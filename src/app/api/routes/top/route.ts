// src/app/api/routes/top/route.ts
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

const MS_IN_WEEK = 604_800_000;

/**
 * Compute the UTC start and end dates for an ISO week string.
 * Falls back to the current week if no or invalid input is provided.
 * @param [iso] ISO week like `2025-W32`.
 * @returns Start (Mon 00:00 UTC) and end (next Mon 00:00 UTC).
 */
function isoWeekRange(iso?: string): { start: Date; end: Date } {
  const now = new Date();
  let year = now.getUTCFullYear();
  let week: number | undefined;
  const m = iso?.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) {
    year = parseInt(m[1], 10);
    week = parseInt(m[2], 10);
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);

  if (!week) {
    const diff = Date.now() - week1Mon.getTime();
    week = Math.floor(diff / MS_IN_WEEK) + 1;
  }
  const start = new Date(week1Mon);
  start.setUTCDate(week1Mon.getUTCDate() + 7 * (week - 1));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

/**
 * Get the top routes for a given ISO week, ranked by on-time rate or average delay.
 * @param req Incoming request used to read query parameters.
 * @returns JSON array of ranked route stats.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;
  const iso = sp.get("week") || undefined;
  const limit = Number(sp.get("limit") ?? "10");
  const metric =
    sp.get("metric") === "avg_delay" ? "avg_delay" : "on_time_rate";
  const thresholdSec = Number(sp.get("thresholdSec") ?? "300");
  const mode = (sp.get("mode") ?? null) as null | "BUS" | "TRAIN" | "FERRY";
  const { start, end } = isoWeekRange(iso);

  interface Row {
    route_id: string;
    short_name: string | null;
    long_name: string;
    mode: string;
    events: number; // cast to int in SQL
    avg_delay_sec: number | null;
    avg_abs_delay_sec: number | null;
    on_time_pct: number | null;
  }

  const rows: Row[] =
    metric === "avg_delay"
      ? await prisma.$queryRaw<Row[]>`
          WITH stats AS (
            SELECT r.id AS route_id,
                   r."shortName" AS short_name,
                   r."longName" AS long_name,
                   r.mode::text AS mode,
                   COUNT(*)::int AS events,
                   AVG(ae."deviationSec")::float AS avg_delay_sec,
                   AVG(ABS(ae."deviationSec"))::float AS avg_abs_delay_sec,
                   100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec} THEN 1 ELSE 0 END)::float AS on_time_pct
            FROM "ArrivalEvent" ae
            JOIN "Route" r ON r.id = ae."routeId"
            WHERE ae."scheduledAt" >= ${start} AND ae."scheduledAt" < ${end}
              AND (${mode}::text IS NULL OR r.mode::text = ${mode})
            GROUP BY r.id, r."shortName", r."longName", r.mode
          )
          SELECT * FROM stats
          ORDER BY avg_delay_sec DESC
          LIMIT ${limit};
        `
      : await prisma.$queryRaw<Row[]>`
          WITH stats AS (
            SELECT r.id AS route_id,
                   r."shortName" AS short_name,
                   r."longName" AS long_name,
                   r.mode::text AS mode,
                   COUNT(*)::int AS events,
                   AVG(ae."deviationSec")::float AS avg_delay_sec,
                   AVG(ABS(ae."deviationSec"))::float AS avg_abs_delay_sec,
                   100.0 * AVG(CASE WHEN ABS(ae."deviationSec") <= ${thresholdSec} THEN 1 ELSE 0 END)::float AS on_time_pct
            FROM "ArrivalEvent" ae
            JOIN "Route" r ON r.id = ae."routeId"
            WHERE ae."scheduledAt" >= ${start} AND ae."scheduledAt" < ${end}
              AND (${mode}::text IS NULL OR r.mode::text = ${mode})
            GROUP BY r.id, r."shortName", r."longName", r.mode
          )
          SELECT * FROM stats
          ORDER BY on_time_pct DESC
          LIMIT ${limit};
        `;

  return NextResponse.json(rows);
}
