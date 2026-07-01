// scripts/smoke-test.ts
/**
 * @file smoke-test.ts
 * @description Optionally builds the Next.js app, starts the standalone server,
 * then visits every public page with Puppeteer to collect console errors, failed
 * responses, and navigation timing. App Router pages are auto-discovered; the
 * dynamic route/stop pages (which need a live id) are added explicitly, with a
 * real stop id discovered from the home page at runtime.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts              # build > start > test
 *   npx tsx scripts/smoke-test.ts --skip-build # start > test (reuse existing .next)
 *   npx tsx scripts/smoke-test.ts --port=3001
 *
 * Exit codes:
 *   0  all pages loaded without errors
 *   1  one or more pages had console errors or failed to load
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";

/* ------------------------------------------------------------------ types */

interface PageResult {
  path: string;
  name: string;
  status: "pass" | "fail" | "error";
  ttfbMs: number | null;
  fcpMs: number | null;
  loadMs: number | null;
  errors: string[];
}

interface PageSpec {
  path: string;
  name: string;
  /** Console error / response-URL substrings to ignore for this page. */
  ignoreErrors?: string[];
}

/* --------------------------------------------------------------- constants */

/**
 * Friendly names for auto-discovered static pages, keyed by URL path. Anything
 * not listed uses the auto-generated Title-Cased name.
 */
const PAGE_OVERRIDES: Record<string, { name?: string; ignoreErrors?: string[] }> = {
  "/": { name: "Home" },
  "/rankings": { name: "Rankings" },
  "/shame": { name: "Shame of the Day" },
};

/**
 * Explicit dynamic-route samples. Auto-discovery skips `[id]` segments (no id to
 * fabricate), so the route page is exercised here with real ids; a stop id is
 * discovered from the home page at runtime and appended in {@link dynamicPages}.
 */
const DYNAMIC_SAMPLES: ReadonlyArray<PageSpec> = [
  { path: "/route/NX1", name: "Route NX1" },
  { path: "/route/65", name: "Route 65" },
  { path: "/route/NX1?dir=0", name: "Route NX1 (one direction)" },
];

/** Discovered URL paths to skip (internal-only or un-testable surfaces). */
const SKIP_PATHS: ReadonlySet<string> = new Set([]);

/** App router page files - first match wins per directory. */
const PAGE_FILE_NAMES: ReadonlyArray<string> = ["page.tsx", "page.ts", "page.jsx", "page.js"];

/** Root of the App Router tree. */
const APP_DIR = path.join("src", "app");

/**
 * Warn (but don't fail) when TTFB exceeds this. Set above the normal ~3-4s
 * server-render of these DB-aggregation pages so the marker flags a real
 * regression rather than lighting up on every page.
 */
const TTFB_WARN_MS = 5_000;

/**
 * Fail when TTFB exceeds this - a true hang. Set well above the cold-cache render
 * time of the heaviest pages (the rankings page runs week/month aggregations the
 * first time it's hit), so slow-but-working pages warn rather than fail.
 */
const TTFB_FAIL_MS = 45_000;

/** Per-page navigation timeout (heavy pages render slowly on a cold cache). */
const NAV_TIMEOUT_MS = 60_000;

/** Resource URL substrings expected to 404 locally (Vercel-only, missing favicon). */
const IGNORE_404_URLS = ["/_vercel/insights/", "/_vercel/speed-insights/", "/favicon.ico"];

/**
 * Console substrings ignored everywhere. The browser echoes every failed
 * resource as a generic console error; the response handler already owns those
 * (with the real URL + ignore list), so the echo would just double-count.
 */
const IGNORE_CONSOLE = ["Failed to load resource"];

/* ---------------------------------------------------------------- helpers */

/**
 * Title-cases the final segments of a route for the default display name.
 * @param route - Discovered URL path (e.g. "/rankings").
 * @returns Friendly name (e.g. "Rankings", or "Home" for "/").
 */
function routeToName(route: string): string {
  if (route === "/") return "Home";
  return route
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Walks the App Router tree and turns every `page.{tsx,ts,jsx,js}` into a route.
 * Route groups `(...)` are stripped; dynamic segments `[id]` are skipped (no
 * sample id); {@link SKIP_PATHS} are filtered; API `route.ts` files never match.
 * @returns Discovered static routes, sorted by path.
 */
function discoverPages(): PageSpec[] {
  const pages: PageSpec[] = [];
  const seen = new Set<string>();

  /**
   * Record the route for any directory with a page file, then recurse.
   * @param dir - Absolute filesystem path being inspected.
   * @param segments - URL segments accumulated from the App Router root.
   */
  const walk = (dir: string, segments: string[]): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    const hasPage = entries.some((e) => e.isFile() && PAGE_FILE_NAMES.includes(e.name));
    if (hasPage) {
      const cleanSegments = segments.filter((s) => !s.startsWith("("));
      const hasDynamic = cleanSegments.some((s) => s.includes("[") || s.includes("]"));
      if (!hasDynamic) {
        const route = "/" + cleanSegments.join("/");
        const normalised = route === "/" ? "/" : route.replace(/\/$/, "");
        if (!SKIP_PATHS.has(normalised) && !seen.has(normalised)) {
          seen.add(normalised);
          const override = PAGE_OVERRIDES[normalised] ?? {};
          pages.push({
            path: normalised,
            name: override.name ?? routeToName(normalised),
            ignoreErrors: override.ignoreErrors,
          });
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_")) continue; // Next.js private folders.
      walk(path.join(dir, entry.name), [...segments, entry.name]);
    }
  };

  walk(APP_DIR, []);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Build the dynamic-route sample list: the static {@link DYNAMIC_SAMPLES} plus a
 * real stop page, whose id is read from a `/stop/...` link on the home page.
 * @param baseUrl - The running server's base URL.
 * @returns Dynamic page specs to visit.
 */
async function dynamicPages(baseUrl: string): Promise<PageSpec[]> {
  const pages = [...DYNAMIC_SAMPLES];
  try {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    const m = html.match(/\/stop\/[^"'?\\]+/);
    if (m) pages.push({ path: m[0], name: "Stop detail" });
  } catch {
    // Home unreachable here is reported by the home page check itself.
  }
  return pages;
}

/**
 * Parses `--flag` and `--flag=value` CLI arguments.
 * @returns Parsed flags.
 */
function parseArgs(): { skipBuild: boolean; port: number } {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let port = 3100;
  for (const arg of args) {
    if (arg === "--skip-build") skipBuild = true;
    else if (arg.startsWith("--port=")) port = parseInt(arg.slice(7), 10);
  }
  return { skipBuild, port };
}

/**
 * Load `.env.local` into `process.env` so the standalone server can reach Mongo
 * (Next loads it automatically in dev, but the spawned production server inherits
 * only what we pass it). Existing env vars win.
 */
function loadEnvLocal(): void {
  const file = ".env.local";
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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

/**
 * Runs `next build` synchronously, streaming output to the terminal.
 */
function runBuild(): void {
  console.log("\n> Building...\n");
  execSync("npm run build", { stdio: "inherit" });
  console.log("\n> Build complete\n");
}

/**
 * Copies static assets and the public folder into the standalone output. Next.js
 * standalone bundles only server JS, so static chunks and public assets must be
 * copied in by hand before the server can serve them.
 */
function copyStandaloneAssets(): void {
  console.log("  Copying static assets into standalone...");
  fs.cpSync(path.join(".next", "static"), path.join(".next", "standalone", ".next", "static"), {
    recursive: true,
    force: true,
  });
  if (fs.existsSync("public")) {
    fs.cpSync("public", path.join(".next", "standalone", "public"), {
      recursive: true,
      force: true,
    });
  }
  console.log("  Assets copied\n");
}

/**
 * Spawns the standalone production server on the given port.
 * @param port - Port to listen on.
 * @returns The spawned child process.
 */
function startServer(port: number): ChildProcess {
  console.log(`> Starting server on port ${port}...`);
  return spawn("node", [path.join(".next", "standalone", "server.js")], {
    stdio: "pipe",
    shell: false,
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
  });
}

/**
 * Polls the server root until it responds or the timeout elapses. The root is
 * the heavy dashboard (seconds of DB aggregation), so each attempt gets a long
 * timeout - a short one would abort before the page ever responds.
 * @param baseUrl - The server's base URL.
 * @param timeoutMs - Maximum total wait time in milliseconds.
 */
async function waitForServer(baseUrl: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(15_000) });
      if (res.status < 500) {
        console.log(`> Server ready at ${baseUrl}\n`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Server did not respond within ${timeoutMs / 1000}s`);
}

/**
 * Visits a page with Puppeteer, collecting timing metrics, console errors,
 * uncaught page errors, and 4xx/5xx responses.
 * @param browser - Puppeteer browser instance.
 * @param baseUrl - Server base URL.
 * @param spec - Page specification.
 * @returns Result for the page.
 */
async function checkPage(browser: Browser, baseUrl: string, spec: PageSpec): Promise<PageResult> {
  const url = `${baseUrl}${spec.path}`;
  const errors: string[] = [];
  /**
   * Whether a message matches one of this page's ignore substrings.
   * @param text - The console message or response URL to test.
   * @returns True when an ignore substring matches.
   */
  const ignored = (text: string): boolean =>
    spec.ignoreErrors?.some((s) => text.includes(s)) ?? false;

  const page = await browser.newPage();
  try {
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const resUrl = response.url();
      if (IGNORE_404_URLS.some((s) => resUrl.includes(s))) return;
      if (ignored(resUrl)) return;
      errors.push(`HTTP ${status}: ${resUrl}`);
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORE_CONSOLE.some((s) => text.includes(s)) || ignored(text)) return;
      errors.push(`[console] ${text}`);
    });
    page.on("pageerror", (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (ignored(text)) return;
      errors.push(`[pageerror] ${text}`);
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });

    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const fcp = performance
        .getEntriesByType("paint")
        .find((e) => e.name === "first-contentful-paint");
      if (!nav) return { ttfb: null, fcp: null, load: null };
      return {
        ttfb: Math.round(nav.responseStart - nav.requestStart),
        fcp: fcp ? Math.round(fcp.startTime) : null,
        load: Math.round(nav.loadEventEnd - nav.requestStart),
      };
    });

    const failed = errors.length > 0 || (timing.ttfb !== null && timing.ttfb > TTFB_FAIL_MS);
    return {
      path: spec.path,
      name: spec.name,
      status: failed ? "fail" : "pass",
      ttfbMs: timing.ttfb,
      fcpMs: timing.fcp,
      loadMs: timing.load,
      errors,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: spec.path,
      name: spec.name,
      status: "error",
      ttfbMs: null,
      fcpMs: null,
      loadMs: null,
      errors: [`Failed to load page: ${message}`],
    };
  } finally {
    await page.close();
  }
}

/**
 * Formats a millisecond value with a warning marker when it exceeds the threshold.
 * @param ms - Value in milliseconds (or null).
 * @returns Formatted string.
 */
function fmtMs(ms: number | null): string {
  if (ms === null) return "  -  ";
  const s = `${ms}ms`.padStart(7);
  return ms > TTFB_WARN_MS ? `${s} !` : s;
}

/**
 * Prints a results table to stdout.
 * @param results - Page results to display.
 */
function printTable(results: PageResult[]): void {
  const col1 = Math.max(...results.map((r) => r.name.length), 4) + 2;
  const header =
    "  Status  " +
    "Name".padEnd(col1) +
    " TTFB".padStart(9) +
    "  FCP".padStart(9) +
    "  Load".padStart(9);
  console.log("\n" + header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const icon = r.status === "pass" ? "ok " : r.status === "fail" ? "FAIL" : " !  ";
    console.log(
      `  ${icon}    ` +
        r.name.padEnd(col1) +
        fmtMs(r.ttfbMs).padStart(9) +
        fmtMs(r.fcpMs).padStart(9) +
        fmtMs(r.loadMs).padStart(9),
    );
    for (const e of r.errors) console.log(`             > ${e}`);
  }
  console.log("-".repeat(header.length));
}

/* ------------------------------------------------------------------ main */

/**
 * Build (optional), start the standalone server, visit every page, and report.
 * @returns Resolves once the process exit code is set and resources are freed.
 */
async function main(): Promise<void> {
  const { skipBuild, port } = parseArgs();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let exitCode = 0;

  try {
    loadEnvLocal();
    if (!skipBuild) runBuild();
    copyStandaloneAssets();

    server = startServer(port);
    server.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) process.stderr.write(`  [server] ${line}\n`);
    });
    await waitForServer(baseUrl);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const pages = [...discoverPages(), ...(await dynamicPages(baseUrl))];
    console.log(`Checking ${pages.length} pages...\n`);

    const results: PageResult[] = [];
    for (const spec of pages) {
      const result = await checkPage(browser, baseUrl, spec);
      results.push(result);
      const icon = result.status === "pass" ? "ok" : "x";
      process.stdout.write(`  ${icon} ${spec.path.padEnd(40)} ${result.ttfbMs ?? "-"}ms TTFB\n`);
    }

    printTable(results);
    const failed = results.filter((r) => r.status !== "pass");
    if (failed.length === 0) {
      console.log(`\n> All ${results.length} pages passed\n`);
    } else {
      console.log(`\n> ${failed.length} page(s) failed\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  } finally {
    await browser?.close();
    if (server?.pid) {
      // On Windows, SIGTERM doesn't reach the child tree; taskkill stops it all so
      // the Prisma DLL is released and the port is freed.
      try {
        execSync(`taskkill //F //T //PID ${server.pid}`, { stdio: "ignore" });
      } catch {
        server.kill("SIGTERM");
      }
    }
  }

  process.exit(exitCode);
}

void main();
