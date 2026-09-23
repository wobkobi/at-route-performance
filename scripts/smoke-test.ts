// scripts/smoke-test.ts
// Optionally builds the Next.js app, starts the standalone server,
// then visits every public page with Puppeteer to collect console errors, failed
// responses, and navigation timing. App Router pages are auto-discovered; the
// dynamic route/stop pages (which need a live id) are added explicitly, with a
// real stop id discovered from the home page at runtime.
//
// Usage:
//   npx tsx scripts/smoke-test.ts              # build > start > test
//   npx tsx scripts/smoke-test.ts --skip-build # start > test (reuse existing .next)
//   npx tsx scripts/smoke-test.ts --port=3001
//   npx tsx scripts/smoke-test.ts --base-url=http://127.0.0.1:3000   # a server already running
//
// Against a Vercel deployment behind Deployment Protection, set
// VERCEL_AUTOMATION_BYPASS_SECRET (the project's "Protection Bypass for
// Automation" secret). It is sent as the bypass header only to the deployment's
// own origin, never to a third-party host such as the map tiles, and it is also
// stored as a session cookie before any page is measured so that requests the
// browser starts on its own carry it too. The one request that carries no
// cookies, a web manifest, is ignored if it loops through SSO.
//
// Exit codes:
//   0  all pages loaded without errors
//   1  one or more pages had console errors or failed to load

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
  /** Text the rendered page must contain. */
  mustContain?: string[];
  /** Text the rendered page must not contain, beyond {@link FORBIDDEN_TEXT}. */
  mustNotContain?: string[];
  /** The path (with query) the browser must end on; the requested path by default. */
  expectFinalPath?: string;
  /** The status the document itself is expected to answer (a 404 page); under 400 by default. */
  expectStatus?: number;
}

/* --------------------------------------------------------------- constants */

/**
 * Friendly names for auto-discovered static pages, keyed by URL path. Anything
 * not listed uses the auto-generated Title-Cased name.
 */
const PAGE_OVERRIDES: Record<
  string,
  Pick<PageSpec, "name" | "ignoreErrors" | "expectFinalPath">
> = {
  "/": { name: "Home" },
  "/rankings": { name: "Rankings (redirects home)", expectFinalPath: "/?window=week" },
  "/routes": { name: "Routes" },
  "/cancellations": { name: "Cancellations" },
  "/shame": { name: "Shame (redirects to trips)", expectFinalPath: "/shame/trip" },
};

/**
 * Explicit dynamic-route samples. Auto-discovery skips `[id]` segments (no id to
 * fabricate), so the route page is exercised here with real ids; a stop id is
 * discovered from the home page at runtime and appended in {@link dynamicPages}.
 */
const DYNAMIC_SAMPLES: ReadonlyArray<PageSpec> = [
  { path: "/route/NX1", name: "Route NX1", mustContain: ["Route map"] },
  { path: "/route/65", name: "Route 65" },
  { path: "/route/NX1?dir=0", name: "Route NX1 (one direction)" },
  { path: "/route/NX1?window=week", name: "Route NX1 (week)", mustContain: ["Last 7 days"] },
  { path: "/?window=week", name: "Home (week)", mustContain: ["Last 7 days"] },
  { path: "/?window=month", name: "Home (month)" },
  { path: "/routes?window=week&area=north", name: "Routes (week, North Shore)" },
  { path: "/cancellations?window=week", name: "Cancellations (week)" },
  { path: "/shame/trip?window=week", name: "Shame trips (week)" },
  { path: "/shame/route?window=week", name: "Shame routes (week)" },
  { path: "/shame/stop?window=week", name: "Shame stops (week)" },
  {
    path: "/shame/stop?day=2026-09-01",
    name: "Shame stops (day before the archive)",
    expectFinalPath: "/shame/stop?day=2026-09-11",
  },
  {
    path: "/?day=2026-09-11",
    name: "Home (first day on record)",
    mustContain: [
      "Records start 11 September 2026",
      "first day",
      "This is the first day on record",
    ],
  },
  {
    path: "/?window=month&period=2026-09",
    name: "Home (first month, partial)",
    mustContain: ["September 2026 (from 11 Sep)"],
  },
  {
    path: "/nonexistent",
    name: "404 page",
    expectStatus: 404,
    mustContain: ["Page not found", "All routes"],
  },
];

/**
 * Text that must never appear in a rendered page: a formatter or a template
 * that leaked a raw value. Checked against `document.body.innerText`, so
 * script bundles do not count.
 */
const FORBIDDEN_TEXT: ReadonlyArray<string> = [
  "NaN",
  "undefined",
  'No routes match ""',
  "Invalid Date",
  "[object Object]",
];

/** Public endpoints fetched directly: each must answer 200 with a JSON body. */
const API_CHECKS: ReadonlyArray<{ path: string; nonEmptyArray?: boolean }> = [
  { path: "/api/health" },
  { path: "/api/routes", nonEmptyArray: true },
  { path: "/api/freshness" },
  { path: "/api/routes/top?limit=" },
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
 * time of the heaviest pages (the home page's week and month views run aggregations the
 * first time it's hit), so slow-but-working pages warn rather than fail.
 */
const TTFB_FAIL_MS = 45_000;

/** Per-page navigation timeout (heavy pages render slowly on a cold cache). */
const NAV_TIMEOUT_MS = 60_000;

/** Resource URL substrings expected to 404 locally (Vercel-only, missing favicon). */
const IGNORE_404_URLS = ["/_vercel/insights/", "/_vercel/speed-insights/", "/favicon.ico"];

/**
 * Console-error substrings ignored on every page. Vercel injects its preview
 * toolbar script into preview deployments and the site's CSP blocks it, which
 * Chrome reports as a console error: that is the CSP working, and production
 * never carries the script.
 */
const IGNORE_CONSOLE_GLOBAL = ["vercel.live/"];

/**
 * Chrome echoes every 4xx/5xx sub-resource as a console error starting with
 * this. The response handler already records those with the real URL, so an
 * echo counts only when no response event was seen for its URL. Any other
 * "Failed to load resource" message (a net::ERR_* failure such as a blocked,
 * aborted or unresolved request) never produces a response event and is kept.
 */
const STATUS_ECHO_PREFIX = "Failed to load resource: the server responded with a status of";

/** Timeout for the direct fetches (samples, endpoints), so a hung request cannot stall the run. */
const FETCH_TIMEOUT_MS = 30_000;

/* ---------------------------------------------------------------- helpers */

/**
 * Headers for the direct fetches this script makes to the target: Vercel's
 * protection-bypass header when the secret is set, so a deployment behind SSO
 * answers rather than redirecting to the login. Every direct fetch goes to the
 * target's own origin, so the secret never leaves it. Empty for a local server.
 * @returns The headers.
 */
function requestHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

/**
 * Whether a request URL shares an origin (scheme, host, port) with the target.
 * @param requestUrl - The outgoing request URL.
 * @param origin - The target origin to match.
 * @returns True when the origins match; false for an unparsable URL.
 */
function isSameOrigin(requestUrl: string, origin: string): boolean {
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Store Vercel's Deployment Protection bypass as a session cookie. The
 * per-request header in {@link checkPage} covers the requests the interceptor
 * sees; a request the browser starts on its own (a favicon, a prefetch) can
 * miss interception, and the cookie covers those as long as they carry
 * cookies. Loading the site once with the bypass as query parameters plus
 * `x-vercel-set-bypass-cookie` sets the `_vercel_jwt` cookie for the session.
 * A web manifest is the exception: browsers fetch `<link rel="manifest">`
 * without cookies, so on a protected deployment it bounces between the site and
 * SSO whatever is primed, and the page check ignores that one redirect loop.
 * A no-op without the secret (a local server).
 * @param browser - Puppeteer browser instance.
 * @param baseUrl - The target's base URL.
 */
async function primeBypassCookie(browser: Browser, baseUrl: string): Promise<void> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return;
  const page = await browser.newPage();
  try {
    const query = `x-vercel-protection-bypass=${encodeURIComponent(secret)}&x-vercel-set-bypass-cookie=true`;
    await page.goto(`${baseUrl}/?${query}`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    const primed = (await browser.cookies()).some((c) => c.name === "_vercel_jwt");
    console.log(
      primed
        ? "  Deployment Protection bypass cookie set.\n"
        : "  (no bypass cookie returned; Deployment Protection may be off)\n",
    );
  } finally {
    await page.close();
  }
}

/**
 * Note a dynamic sample that could not be found, so a run that visits fewer
 * pages than usual says so instead of passing quietly with less coverage.
 * @param what - The sample that is missing.
 */
function warnMissingSample(what: string): void {
  console.log(`  (no ${what} found; that page is not visited)`);
}

/**
 * Title-cases the final segments of a route for the default display name.
 * @param route - Discovered URL path (e.g. "/cancellations").
 * @returns Friendly name (e.g. "Cancellations", or "Home" for "/").
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
            expectFinalPath: override.expectFinalPath,
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
 * The first link matching a pattern in a page's HTML, or null when the page is
 * unreachable or has none.
 * @param baseUrl - The running server's base URL.
 * @param path - The page to read.
 * @param pattern - The href pattern to look for.
 * @returns The matched href, or null.
 */
async function firstLink(baseUrl: string, path: string, pattern: RegExp): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return (await res.text()).match(pattern)?.[0] ?? null;
  } catch {
    // An unreachable page is reported by that page's own check.
    return null;
  }
}

/**
 * Build the dynamic-route sample list: the static {@link DYNAMIC_SAMPLES} plus
 * pages whose ids only exist at runtime: a stop from the home page, a run from
 * the NX1 trip board, the first train line in the directory and one of its
 * stations (the `station:` id form that the platform collapse mints, which the
 * page links percent-encoded).
 * @param baseUrl - The running server's base URL.
 * @returns Dynamic page specs to visit.
 */
async function dynamicPages(baseUrl: string): Promise<PageSpec[]> {
  const pages = [...DYNAMIC_SAMPLES];
  const stop = await firstLink(baseUrl, "/", /\/stop\/[^"'?\\]+/);
  if (stop) pages.push({ path: stop, name: "Stop detail" });
  else warnMissingSample("stop link on the home page");
  const trip = await firstLink(baseUrl, "/route/NX1", /\/route\/NX1\/trip\/[^"'?\\]+/);
  if (trip) pages.push({ path: trip, name: "Trip detail", mustContain: ["Back to"] });
  else warnMissingSample("trip link on the NX1 board");
  try {
    const res = await fetch(`${baseUrl}/api/routes`, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const routes = (await res.json()) as { id: string; mode: string }[];
    const train = routes.find((r) => r.mode === "TRAIN");
    if (!train) {
      warnMissingSample("train line in the directory");
      return pages;
    }
    const slug = train.id.replace(/-\d+$/, "");
    pages.push({ path: `/route/${encodeURIComponent(slug)}`, name: `Route ${slug} (train)` });
    const station = await firstLink(
      baseUrl,
      `/route/${encodeURIComponent(slug)}`,
      /\/stop\/station(?::|%3A)[^"'?\\]+/,
    );
    if (station) pages.push({ path: station, name: "Train station" });
    else warnMissingSample(`station link on the ${slug} page`);
  } catch {
    // The directory endpoint is checked on its own below.
    console.log("  (directory unreadable; the train line and station pages are not visited)");
  }
  return pages;
}

/**
 * Fetch each public endpoint and report it like a page: status 200 with a JSON
 * body, and a non-empty array where one is expected.
 * @param baseUrl - The running server's base URL.
 * @returns One result per endpoint.
 */
async function checkApis(baseUrl: string): Promise<PageResult[]> {
  const results: PageResult[] = [];
  for (const check of API_CHECKS) {
    const errors: string[] = [];
    const started = Date.now();
    let ttfbMs: number | null = null;
    try {
      const res = await fetch(`${baseUrl}${check.path}`, {
        headers: requestHeaders(),
        // A protected deployment answers a redirect to SSO; following it would
        // parse the login page and hide the real status behind a JSON error.
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      ttfbMs = Date.now() - started;
      if (res.status !== 200) {
        errors.push(`HTTP ${res.status}`);
      } else {
        const body: unknown = await res.json();
        if (check.nonEmptyArray && !(Array.isArray(body) && body.length > 0)) {
          errors.push("expected a non-empty JSON array");
        }
      }
    } catch (err) {
      errors.push(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push({
      path: check.path,
      name: `API ${check.path}`,
      status: errors.length === 0 ? "pass" : "fail",
      ttfbMs,
      fcpMs: null,
      loadMs: null,
      errors,
    });
  }
  return results;
}

/**
 * Parses the CLI arguments: `--skip-build`, and `--port` and `--base-url` in
 * both `--flag=value` and `--flag value` form. An unknown argument is a hard
 * error rather than an ignored one: a misspelt or mis-quoted `--base-url` would
 * otherwise start a local build when a deployment was meant to be read.
 * @returns Parsed flags.
 */
function parseArgs(): { skipBuild: boolean; port: number; baseUrl: string | null } {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let port = 3100;
  let baseUrl: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (flag !== "--port" && flag !== "--base-url") throw new Error(`Unknown argument: ${arg}`);
    // The value follows "=" or is the next argument.
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "") throw new Error(`${flag} needs a value`);
    if (flag === "--port") {
      // Number() rejects "3001abc", which parseInt would read as 3001.
      port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--port needs a port number, got "${value}"`);
      }
    } else {
      // A bare host would make every readiness probe throw until the wait
      // times out, so require a full http(s) URL up front.
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`--base-url needs a full URL such as https://host, got "${value}"`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`--base-url needs an http or https URL, got "${value}"`);
      }
      baseUrl = value.replace(/\/$/, "");
    }
  }
  return { skipBuild, port, baseUrl };
}

/**
 * Load `.env.local` into `process.env` so the standalone server can reach Mongo
 * (Next loads it automatically in dev, but the spawned production server inherits
 * only what it is passed). Node's own parser handles quoting, comments and
 * multi-line values the way Next does, minus `$` expansion, which the file does
 * not use. Existing env vars win, so CI's environment is never overwritten.
 */
function loadEnvLocal(): void {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: the environment already carries the variables (CI).
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
      const res = await fetch(baseUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: requestHeaders(),
      });
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
    const origin = new URL(baseUrl).origin;
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      // Scope the bypass header to the target's own origin through request
      // interception: a page-wide extra header would also ride to the map tile
      // host and every other third-party request, leaking the secret and
      // forcing a CORS preflight those hosts may reject.
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const overrides = isSameOrigin(req.url(), origin)
          ? { headers: { ...req.headers(), "x-vercel-protection-bypass": bypass } }
          : {};
        // A request already handled elsewhere (redirects can race) rejects; ignore it.
        void req.continue(overrides).catch(() => undefined);
      });
    }

    // URLs that answered 4xx/5xx, so the console echo of the same failure is
    // dropped instead of double-counted; echoes are resolved after navigation,
    // once every response event is in.
    const failedResponseUrls = new Set<string>();
    const statusEchoes: { text: string; locUrl: string }[] = [];

    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const resUrl = response.url();
      failedResponseUrls.add(resUrl);
      // The 404 page is expected to answer 404 for its own document; the status
      // itself is asserted after navigation.
      if (spec.expectStatus === status && response.request().resourceType() === "document") return;
      if (IGNORE_404_URLS.some((s) => resUrl.includes(s))) return;
      if (ignored(resUrl)) return;
      errors.push(`HTTP ${status}: ${resUrl}`);
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const locUrl = msg.location().url ?? "";
      if (IGNORE_CONSOLE_GLOBAL.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (ignored(text) || ignored(locUrl)) return;
      // A web manifest is fetched without cookies and is not reliably
      // intercepted, so on a protected deployment it bounces between the site
      // and SSO until Chrome gives up. Ignored for that file only, on the
      // target's own origin only, and only while the bypass secret is in play.
      if (
        bypass &&
        text.includes("ERR_TOO_MANY_REDIRECTS") &&
        isSameOrigin(locUrl, origin) &&
        new URL(locUrl).pathname.endsWith(".webmanifest")
      ) {
        return;
      }
      if (text.startsWith(STATUS_ECHO_PREFIX)) {
        statusEchoes.push({ text, locUrl });
        return;
      }
      errors.push(locUrl ? `[console] ${text} (${locUrl})` : `[console] ${text}`);
    });
    page.on("pageerror", (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (ignored(text)) return;
      errors.push(`[pageerror] ${text}`);
    });

    const docResponse = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });

    for (const echo of statusEchoes) {
      if (!failedResponseUrls.has(echo.locUrl)) {
        errors.push(
          echo.locUrl ? `[console] ${echo.text} (${echo.locUrl})` : `[console] ${echo.text}`,
        );
      }
    }

    // The 404 page must answer a real 404, not a soft 404 with the right copy.
    const docStatus = docResponse?.status() ?? null;
    if (spec.expectStatus !== undefined && docStatus !== spec.expectStatus) {
      errors.push(`document answered HTTP ${docStatus ?? "none"}, expected ${spec.expectStatus}`);
    }

    // Where the browser ended up: a streamed redirect lands here as a client
    // navigation, which the response status never shows.
    const landed = new URL(page.url());
    const finalPath = `${landed.pathname}${landed.search}`;
    const expectedPath = spec.expectFinalPath ?? spec.path;
    if (finalPath !== expectedPath) errors.push(`landed on ${finalPath}, expected ${expectedPath}`);

    // Rendered text only (no bundles): leaked raw values, required copy, and
    // any section whose heading is all it holds.
    const text = await page.evaluate(() => document.body.innerText);
    for (const bad of [...FORBIDDEN_TEXT, ...(spec.mustNotContain ?? [])]) {
      if (text.includes(bad)) errors.push(`page text contains "${bad}"`);
    }
    for (const needed of spec.mustContain ?? []) {
      if (!text.includes(needed)) errors.push(`page text lacks "${needed}"`);
    }
    const emptySections = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h2"))
        .filter((h) => {
          // A heading labelling a disclosure has its content behind a click, and
          // a collapsed `details` reports no `innerText` past its summary - so
          // read the markup there instead, or every closed section reads empty.
          const summary = h.closest<HTMLElement>("summary");
          if (summary) {
            const details = summary.parentElement;
            return !details || details.textContent?.trim() === h.textContent?.trim();
          }
          // Otherwise the section is the nearest sectioning ancestor, or the
          // parent when the heading sits in none, so a heading wrapped in its own
          // header element still counts the content beside that wrapper.
          const container = h.closest<HTMLElement>("section, article") ?? h.parentElement;
          if (!container) return false;
          return container.innerText.trim() === h.innerText.trim();
        })
        .map((h) => h.innerText.trim()),
    );
    for (const heading of emptySections) errors.push(`section "${heading}" has no content`);

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
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs();
  } catch (err) {
    // A usage error: the message alone, not a stack trace.
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  const { skipBuild, port, baseUrl: liveUrl } = args;
  const baseUrl = liveUrl ?? `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let exitCode = 0;

  try {
    // --base-url points at a server that is already running (a deployment, or
    // a local `next start`), so nothing is built or started here.
    if (!liveUrl) {
      loadEnvLocal();
      if (!skipBuild) runBuild();
      copyStandaloneAssets();

      server = startServer(port);
      // Drain both pipes: an unread stdout fills its buffer and stalls the
      // server, and either stream may carry the error behind a failed render.
      for (const stream of [server.stdout, server.stderr]) {
        stream?.on("data", (chunk: Buffer) => {
          const line = chunk.toString().trim();
          if (line) process.stderr.write(`  [server] ${line}\n`);
        });
      }
    }
    await waitForServer(baseUrl);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    if (liveUrl) await primeBypassCookie(browser, baseUrl);

    const pages = [...discoverPages(), ...(await dynamicPages(baseUrl))];
    console.log(`Checking ${pages.length} pages...\n`);

    const results: PageResult[] = [];
    for (const spec of pages) {
      const result = await checkPage(browser, baseUrl, spec);
      results.push(result);
      const icon = result.status === "pass" ? "ok" : "x";
      process.stdout.write(`  ${icon} ${spec.path.padEnd(40)} ${result.ttfbMs ?? "-"}ms TTFB\n`);
    }
    results.push(...(await checkApis(baseUrl)));

    printTable(results);
    const failed = results.filter((r) => r.status !== "pass");
    if (failed.length === 0) {
      console.log(`\n> All ${results.length} checks passed\n`);
    } else {
      console.log(`\n> ${failed.length} check(s) failed\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  } finally {
    await browser?.close();
    if (server?.pid) {
      // On Windows, SIGTERM doesn't reach the child tree; taskkill stops it all so
      // the Prisma DLL is released and the port is freed. execSync runs through
      // cmd.exe, which takes single-slash switches (the double-slash form is a
      // Git Bash convention and fails here with "Invalid argument/option").
      try {
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch {
        server.kill("SIGTERM");
      }
    }
  }

  process.exit(exitCode);
}

void main();
