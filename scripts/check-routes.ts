/**
 * Visual audit script — fetch every route page from the local dev server, parse
 * the SSR'd SVG for duplicate/overlapping nodes and empty diagrams, then
 * screenshot any routes that look suspicious using Chrome headless.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-routes.ts
 * Dev server must be running at http://localhost:3000.
 */
import { routeSlug } from "@/lib/route-slug";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";

const BASE = "http://localhost:3000";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOTS_DIR = "scripts/route-shots";

void (async () => {
  const prisma = new PrismaClient();

  // Unique slugs across all modes.
  const routes = await prisma.route.findMany({
    select: { id: true, shortName: true, mode: true },
  });
  await prisma.$disconnect();

  const slugs = [...new Set(routes.map((r) => routeSlug(r.id)))];
  console.log(`\nChecking ${slugs.length} routes against ${BASE} …\n`);

  if (!existsSync(SHOTS_DIR)) mkdirSync(SHOTS_DIR, { recursive: true });

  const errors: string[] = [];
  const flagged: { slug: string; reason: string }[] = [];

  let done = 0;
  for (const slug of slugs) {
    let html = "";
    try {
      const res = await fetch(`${BASE}/route/${encodeURIComponent(slug)}`);
      html = await res.text();
      if (!res.ok) {
        errors.push(`${slug}: HTTP ${res.status}`);
        done++;
        continue;
      }
    } catch (e) {
      errors.push(`${slug}: fetch failed — ${e}`);
      done++;
      continue;
    }

    // Extract the strip's SVG blocks (data-strip) - RouteStrip draws one per column, in
    // both its one-column and two-column copies. Checking per SVG prevents false
    // positives from the two copies placing the same stop at the same coordinate.
    const svgBlocks = [...html.matchAll(/<svg\s[^>]*data-strip[^>]*>([\s\S]*?)<\/svg>/g)].map(
      (m) => m[0],
    );

    if (svgBlocks.length === 0) {
      flagged.push({ slug, reason: "no diagram circles" });
      done++;
      continue;
    }

    // Within each SVG, check for stop rings sharing the same rounded cx+cy - a true
    // duplicate stop in that column. The dashed alert rings circle a stop's own ring,
    // so they are left out.
    let totalDupes = 0;
    for (const svg of svgBlocks) {
      const svgCircles = [
        ...svg.matchAll(/<circle\s[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*>/g),
      ].filter((m) => !m[0].includes("stroke-dasharray"));
      const positions = new Set<string>();
      for (const m of svgCircles) {
        const key = `${Math.round(Number(m[1]))},${Math.round(Number(m[2]))}`;
        if (positions.has(key)) totalDupes++;
        else positions.add(key);
      }
    }
    if (totalDupes > 0) {
      flagged.push({ slug, reason: `${totalDupes} overlapping circle(s)` });
    }

    // Check for the application-error banner.
    if (html.includes("Application error") || html.includes("Unhandled Runtime Error")) {
      flagged.push({ slug, reason: "runtime error in page" });
    }

    done++;
    if (done % 20 === 0) process.stdout.write(`  ${done}/${slugs.length} …\n`);
  }

  console.log(`\nDone. ${errors.length} HTTP errors, ${flagged.length} flagged.\n`);

  if (errors.length) {
    console.log("HTTP errors:");
    for (const e of errors) console.log(" ", e);
    console.log();
  }

  if (flagged.length) {
    console.log("Flagged routes (screenshotting):");
    for (const { slug, reason } of flagged) {
      const out = `${SHOTS_DIR}/${slug.replace(/[^a-z0-9]/gi, "_")}.png`;
      console.log(`  ${slug}: ${reason}  →  ${out}`);
      try {
        execFileSync(
          CHROME,
          [
            "--headless=new",
            "--disable-gpu",
            "--window-size=1400,900",
            `--screenshot=${out}`,
            `${BASE}/route/${encodeURIComponent(slug)}`,
          ],
          { stdio: "ignore", timeout: 20_000 },
        );
      } catch {
        console.log(`    (screenshot failed)`);
      }
    }
  } else {
    console.log("No issues found — all routes look clean.");
  }
})();
