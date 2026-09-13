// scripts/check-data-gaps.ts
// Diagnostic: events per NZ service day and ingest-run stats for the last N
// days, every table bucketed by service date so the rows line up. Run with:
//   npx tsx --env-file=.env.local scripts/check-data-gaps.ts
import { serviceDateExpr } from "@/lib/service-day-expr";
import { PrismaClient } from "@prisma/client";

const DAYS = 35;
const prisma = new PrismaClient();

/** Collect and print event and ingest-run stats to stdout. */
async function main(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const sinceBson = { $date: since.toISOString() };

  // --- Events per NZ service day ------------------------------------------
  const eventsRes = (await prisma.$runCommandRaw({
    aggregate: "ArrivalEvent",
    pipeline: [
      { $match: { scheduledAt: { $gte: sinceBson } } },
      { $group: { _id: serviceDateExpr("$scheduledAt"), n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ],
    cursor: {},
  })) as unknown as { cursor: { firstBatch: { _id: string; n: number }[] } };

  console.log(`\n=== Events per service day (last ${DAYS} days) ===`);
  const dayEvents: Record<string, number> = {};
  for (const row of eventsRes.cursor.firstBatch) {
    dayEvents[row._id] = row.n;
    const bar = "█".repeat(Math.min(50, Math.round(row.n / 2000)));
    console.log(`  ${row._id}  ${String(row.n).padStart(8)}  ${bar}`);
  }

  // --- Successful 'at' ingest runs per service day -------------------------
  const successRes = (await prisma.$runCommandRaw({
    aggregate: "IngestRun",
    pipeline: [
      { $match: { startedAt: { $gte: sinceBson }, endpoint: "at", success: true } },
      {
        $group: {
          _id: serviceDateExpr("$startedAt"),
          runs: { $sum: 1 },
          inserted: { $sum: "$count" },
        },
      },
      { $sort: { _id: 1 } },
    ],
    cursor: {},
  })) as unknown as {
    cursor: { firstBatch: { _id: string; runs: number; inserted: number }[] };
  };

  console.log(`\n=== Successful 'at' ingest runs per service day (last ${DAYS} days) ===`);
  const dayRuns: Record<string, { runs: number; inserted: number }> = {};
  for (const row of successRes.cursor.firstBatch) {
    dayRuns[row._id] = { runs: row.runs, inserted: row.inserted ?? 0 };
    console.log(
      `  ${row._id}  runs=${String(row.runs).padStart(4)}  inserted=${String(row.inserted ?? 0).padStart(8)}`,
    );
  }

  // --- Failed ingest runs per service day ----------------------------------
  const failRes = (await prisma.$runCommandRaw({
    aggregate: "IngestRun",
    pipeline: [
      { $match: { startedAt: { $gte: sinceBson }, success: false } },
      {
        $group: {
          _id: serviceDateExpr("$startedAt"),
          failures: { $sum: 1 },
          endpoints: { $addToSet: "$endpoint" },
          errors: { $addToSet: "$error" },
        },
      },
      { $sort: { _id: 1 } },
    ],
    cursor: {},
  })) as unknown as {
    cursor: {
      firstBatch: {
        _id: string;
        failures: number;
        endpoints: string[];
        errors: (string | null)[];
      }[];
    };
  };

  console.log(`\n=== Failed ingest runs per service day (last ${DAYS} days) ===`);
  if (failRes.cursor.firstBatch.length === 0) {
    console.log("  (none)");
  } else {
    for (const row of failRes.cursor.firstBatch) {
      const errors = row.errors.filter(Boolean).slice(0, 2).join(" | ");
      console.log(
        `  ${row._id}  failures=${row.failures}  endpoints=${row.endpoints.join(",")}  ${errors}`,
      );
    }
  }

  // --- Correlation summary -------------------------------------------------
  console.log("\n=== Low-data days (< 50k events) ===");
  let found = false;
  for (const [date, n] of Object.entries(dayEvents).sort()) {
    if (n < 50_000) {
      const runs = dayRuns[date];
      console.log(
        `  ${date}  events=${n}  runs=${runs?.runs ?? "?"}  inserted=${runs?.inserted ?? "?"}`,
      );
      found = true;
    }
  }
  if (!found) console.log("  (none - all days have >= 50k events)");
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
