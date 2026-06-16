// src/app/api/ingest/aggregate/route.ts
import { requireCronAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

interface DailyStats {
  _id: string; // routeId
  events: number;
  avg_delay_sec: number;
  avg_abs_delay_sec: number;
  on_time_pct: number;
  p50_delay_sec: number;
  p95_delay_sec: number;
}

/**
 * Compute DailyRouteSummary for all routes on a given date (defaults to yesterday).
 * @param req - Request with optional `?date=YYYY-MM-DD` query param.
 * @returns JSON `{ aggregated, date, duration_ms }`, 401/400/500 on failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const startTime = Date.now();

  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    // Parse date (default to yesterday)
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");

    let targetDate: Date;
    if (dateParam) {
      targetDate = new Date(dateParam);
      if (isNaN(targetDate.getTime())) {
        return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
      }
    } else {
      targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() - 1); // Yesterday (UTC)
    }

    // Normalize to UTC midnight
    targetDate.setUTCHours(0, 0, 0, 0);

    const startOfDay = new Date(targetDate);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const thresholdSec = parseInt(process.env.ON_TIME_THRESHOLD_SEC || "300", 10);

    console.log("[AGGREGATE] Starting aggregation", {
      date: targetDate.toISOString().split("T")[0],
      startOfDay: startOfDay.toISOString(),
      endOfDay: endOfDay.toISOString(),
      thresholdSec,
    });

    // MongoDB aggregation pipeline
    const result = (await prisma.$runCommandRaw({
      aggregate: "ArrivalEvent",
      pipeline: [
        {
          $match: {
            scheduledAt: {
              $gte: { $date: startOfDay.toISOString() },
              $lte: { $date: endOfDay.toISOString() },
            },
          },
        },
        {
          $group: {
            _id: "$routeId",
            events: { $sum: 1 },
            avg_delay_sec: { $avg: "$deviationSec" },
            avg_abs_delay_sec: { $avg: { $abs: "$deviationSec" } },
            on_time_count: {
              $sum: {
                $cond: [{ $lte: [{ $abs: "$deviationSec" }, thresholdSec] }, 1, 0],
              },
            },
            delays: { $push: "$deviationSec" },
          },
        },
        {
          $addFields: {
            on_time_pct: {
              $multiply: [{ $divide: ["$on_time_count", "$events"] }, 100],
            },
          },
        },
        {
          $project: {
            _id: 1,
            events: 1,
            avg_delay_sec: 1,
            avg_abs_delay_sec: 1,
            on_time_pct: 1,
            p50_delay_sec: {
              $arrayElemAt: [
                {
                  $percentile: {
                    input: "$delays",
                    p: [0.5],
                    method: "approximate",
                  },
                },
                0,
              ],
            },
            p95_delay_sec: {
              $arrayElemAt: [
                {
                  $percentile: {
                    input: "$delays",
                    p: [0.95],
                    method: "approximate",
                  },
                },
                0,
              ],
            },
          },
        },
      ],
      cursor: {},
    })) as unknown as { cursor: { firstBatch: DailyStats[] } };

    const stats = result.cursor.firstBatch;

    console.log("[AGGREGATE] Pipeline complete", {
      routesFound: stats.length,
      duration_ms: Date.now() - startTime,
    });

    // Upsert each route's daily summary (parallel for performance)
    const upsertPromises = stats.map((stat) =>
      prisma.dailyRouteSummary.upsert({
        where: {
          routeId_date: {
            routeId: stat._id,
            date: targetDate,
          },
        },
        create: {
          routeId: stat._id,
          date: targetDate,
          events: stat.events,
          avgDelaySec: stat.avg_delay_sec,
          avgAbsDelaySec: stat.avg_abs_delay_sec,
          onTimePct: stat.on_time_pct,
          p50DelaySec: stat.p50_delay_sec,
          p95DelaySec: stat.p95_delay_sec,
          thresholdSec,
        },
        update: {
          events: stat.events,
          avgDelaySec: stat.avg_delay_sec,
          avgAbsDelaySec: stat.avg_abs_delay_sec,
          onTimePct: stat.on_time_pct,
          p50DelaySec: stat.p50_delay_sec,
          p95DelaySec: stat.p95_delay_sec,
          thresholdSec,
        },
      }),
    );

    await Promise.all(upsertPromises);
    const upserted = upsertPromises.length;

    const duration = Date.now() - startTime;

    console.log("[AGGREGATE] Complete", {
      timestamp: new Date().toISOString(),
      date: targetDate.toISOString().split("T")[0],
      aggregated: upserted,
      duration_ms: duration,
    });

    return NextResponse.json({
      aggregated: upserted,
      date: targetDate.toISOString().split("T")[0],
      duration_ms: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "Unknown error";

    console.error("[AGGREGATE] Failed", {
      timestamp: new Date().toISOString(),
      error: msg,
      duration_ms: duration,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
