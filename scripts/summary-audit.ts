import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 *
 */
async function main() {
  const rows = await prisma.dailyRouteSummary.groupBy({
    by: ["date"],
    _count: { routeId: true },
    orderBy: { date: "asc" },
  });

  console.log("=== DailyRouteSummary route counts per date ===");
  for (const r of rows) {
    const flag = r._count.routeId < 200 ? "  *** LOW ***" : "";
    console.log(`  ${r.date.toISOString().slice(0, 10)}  routes=${r._count.routeId}${flag}`);
  }
  console.log(`\nTotal dates: ${rows.length}`);

  const runs = await prisma.ingestRun.findMany({
    where: { endpoint: "aggregate" },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { startedAt: true, success: true, count: true },
  });

  console.log("\n=== Last 5 aggregate runs ===");
  for (const r of runs) {
    console.log(`  ${r.startedAt.toISOString()}  ok=${r.success}  count=${r.count ?? "null"}`);
  }

  const cleanupCount = await prisma.ingestRun.count({ where: { endpoint: "cleanup" } });
  console.log(`\n=== Cleanup runs ever recorded: ${cleanupCount} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
