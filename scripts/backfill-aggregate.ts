// scripts/backfill-aggregate.ts
/**
 * POST to /api/ingest/aggregate for each NZ service day in a range so that
 * DailyRouteSummary is populated for days the cron job missed.
 *
 * Usage:
 *   npx tsx scripts/backfill-aggregate.ts --from=2026-06-22 --to=2026-06-24
 *   npx tsx scripts/backfill-aggregate.ts --days=7   # last 7 completed days
 *   npx tsx scripts/backfill-aggregate.ts --url=https://my-app.vercel.app --days=3
 *
 * CRON_SECRET is read from .env.local (or the environment). The --url flag
 * overrides the default http://localhost:3000.
 */

import fs from "node:fs";

/* ---------------------------------------------------------------- env load */

/**
 * Load `.env.local` into `process.env` so the script can read CRON_SECRET and
 * NEXT_PUBLIC_APP_URL without requiring them to be set in the shell.
 */
function loadEnvLocal(): void {
  if (!fs.existsSync(".env.local")) return;
  for (const raw of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

/* ----------------------------------------------------------------- helpers */

/**
 * Parse `--flag=value` and `--flag` CLI arguments.
 * @returns Parsed flags.
 */
function parseArgs(): { from?: string; to?: string; days?: number; baseUrl: string } {
  const args = process.argv.slice(2);
  let from: string | undefined;
  let to: string | undefined;
  let days: number | undefined;
  let baseUrl = "http://localhost:3000";

  for (const arg of args) {
    if (arg.startsWith("--from=")) from = arg.slice(7);
    else if (arg.startsWith("--to=")) to = arg.slice(5);
    else if (arg.startsWith("--days=")) days = parseInt(arg.slice(7), 10);
    else if (arg.startsWith("--url=")) baseUrl = arg.slice(6);
  }
  return { from, to, days, baseUrl };
}

/**
 * Produce a `YYYY-MM-DD` string in NZ local time for a Date.
 * @param d - The date to format.
 * @returns NZ date string.
 */
function toNzDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/* ------------------------------------------------------------------- main */

/**
 * Iterate over each date in the range and POST to the aggregate endpoint.
 * Dates are NZ service-day labels (the calendar date when the service day starts
 * at 5am). The API endpoint interprets them the same way.
 * @returns Resolves once all days are processed.
 */
async function main(): Promise<void> {
  loadEnvLocal();

  const { from, to, days, baseUrl } = parseArgs();
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("CRON_SECRET not set (checked .env.local and environment)");
    process.exit(1);
  }

  // Build the list of dates to aggregate.
  const dates: string[] = [];

  if (from && to) {
    // Explicit range: iterate day by day from `from` to `to` inclusive.
    const start = new Date(`${from}T00:00:00+12:00`);
    const end = new Date(`${to}T00:00:00+12:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      console.error("Invalid --from or --to date (expected YYYY-MM-DD)");
      process.exit(1);
    }
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(toNzDateStr(d));
    }
  } else {
    // --days=N: last N completed service days (excludes today's ongoing day).
    const n = days ?? 1;
    // The most recently completed service day ended at 5am NZ today, so start
    // from yesterday NZ time and go back N days.
    for (let i = n; i >= 1; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      dates.push(toNzDateStr(d));
    }
  }

  console.log(`Backfilling ${dates.length} day(s) against ${baseUrl}\n`);

  let ok = 0;
  let failed = 0;

  for (const date of dates) {
    process.stdout.write(`  ${date} ... `);
    try {
      const res = await fetch(`${baseUrl}/api/ingest/aggregate?date=${date}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = (await res.json()) as { aggregated?: number; error?: string };
      if (!res.ok) {
        console.log(`FAIL (${res.status}) ${body.error ?? ""}`);
        failed++;
      } else {
        console.log(`ok  (${body.aggregated ?? 0} routes)`);
        ok++;
      }
    } catch (err) {
      console.log(`ERROR ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${ok} succeeded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
