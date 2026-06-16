// scripts/wipe-db.ts
/**
 * One-time script to wipe existing data from the database.
 *
 * Deletes:
 * - All ArrivalEvent records
 * - All TripDelay records
 * - All Route records (and cascade-deletes related DailyRouteSummary)
 * - All Stop records
 *
 * Preserves:
 * - Nothing (full wipe to start fresh)
 *
 * Usage:
 *   npx tsx scripts/wipe-db.ts
 *
 * CAUTION: This is destructive and cannot be undone.
 * Only run when you're sure you want to delete all data.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Delete all ingestion data (events, delays, summaries, routes, stops).
 * Destructive and irreversible; intended for manual one-off resets.
 * @returns Resolves once the wipe completes.
 */
async function wipeDatabase(): Promise<void> {
  console.log("🚨 DATABASE WIPE STARTING...\n");
  console.log("This will delete ALL data from:");
  console.log("  - ArrivalEvent");
  console.log("  - TripDelay");
  console.log("  - DailyRouteSummary");
  console.log("  - Route");
  console.log("  - Stop");
  console.log("\nWaiting 3 seconds before proceeding...\n");

  // Give user time to Ctrl+C
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    // Count existing records
    console.log("Counting existing records...");
    const counts = {
      arrivalEvents: await prisma.arrivalEvent.count(),
      tripDelays: await prisma.tripDelay.count(),
      dailySummaries: await prisma.dailyRouteSummary.count(),
      routes: await prisma.route.count(),
      stops: await prisma.stop.count(),
    };

    console.log("Current record counts:", counts);
    console.log();

    if (Object.values(counts).every((c) => c === 0)) {
      console.log("✅ Database is already empty. Nothing to delete.");
      return;
    }

    // Delete in correct order to respect foreign keys
    console.log("Deleting records...\n");

    // 1. Delete ArrivalEvents (references Route, Stop)
    if (counts.arrivalEvents > 0) {
      console.log(`Deleting ${counts.arrivalEvents} ArrivalEvents...`);
      const deleted = await prisma.arrivalEvent.deleteMany({});
      console.log(`✓ Deleted ${deleted.count} ArrivalEvents\n`);
    }

    // 2. Delete TripDelays (references Route)
    if (counts.tripDelays > 0) {
      console.log(`Deleting ${counts.tripDelays} TripDelays...`);
      const deleted = await prisma.tripDelay.deleteMany({});
      console.log(`✓ Deleted ${deleted.count} TripDelays\n`);
    }

    // 3. Delete DailyRouteSummaries (references Route)
    if (counts.dailySummaries > 0) {
      console.log(`Deleting ${counts.dailySummaries} DailyRouteSummaries...`);
      const deleted = await prisma.dailyRouteSummary.deleteMany({});
      console.log(`✓ Deleted ${deleted.count} DailyRouteSummaries\n`);
    }

    // 4. Delete Routes (parent of above)
    if (counts.routes > 0) {
      console.log(`Deleting ${counts.routes} Routes...`);
      const deleted = await prisma.route.deleteMany({});
      console.log(`✓ Deleted ${deleted.count} Routes\n`);
    }

    // 5. Delete Stops (parent of ArrivalEvents)
    if (counts.stops > 0) {
      console.log(`Deleting ${counts.stops} Stops...`);
      const deleted = await prisma.stop.deleteMany({});
      console.log(`✓ Deleted ${deleted.count} Stops\n`);
    }

    console.log("✅ DATABASE WIPE COMPLETE\n");
    console.log("Summary:");
    console.log(`  - Deleted ${counts.arrivalEvents} arrival events`);
    console.log(`  - Deleted ${counts.tripDelays} trip delays`);
    console.log(`  - Deleted ${counts.dailySummaries} daily summaries`);
    console.log(`  - Deleted ${counts.routes} routes`);
    console.log(`  - Deleted ${counts.stops} stops`);
    console.log("\nYou can now start fresh ingestion with:");
    console.log("  1. Run static sync: POST /api/ingest/gtfs/sync");
    console.log("  2. Start realtime ingestion: POST /api/ingest/at (every 2 min)");
  } catch (error) {
    console.error("❌ DATABASE WIPE FAILED\n");
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the wipe
wipeDatabase().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
