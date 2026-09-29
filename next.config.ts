// next.config.ts

import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

// Fonts are bundled locally (next/font/local) and the map is Leaflet + CARTO basemap
// tiles, so the only external origin needed is the CARTO tile CDN (loaded as images).
const cspProd =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "worker-src 'self' blob:; " +
  "manifest-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const cspDev =
  "default-src 'self' blob: data:; " +
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com; " +
  "font-src 'self' data:; " +
  "connect-src 'self' ws: http://localhost:3000 http://127.0.0.1:3000; " +
  "worker-src 'self' blob:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

/**
 * Agents that read a page's HTML once, without running it, so they need the
 * metadata in `<head>` rather than streamed into the body behind the page. The
 * first half is Next's default list (next/dist/shared/lib/router/utils/html-bots.js);
 * the rest are link-preview agents it leaves out, which otherwise find no
 * `og:` tags in the first few hundred kilobytes and post a bare link.
 */
const HTML_LIMITED_BOTS = new RegExp(
  [
    "[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou",
    "bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview",
    "applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot",
    "WhatsApp|SkypeUriPreview|Yeti|googleweblight",
    // Link previews beyond the default: Telegram, Mastodon, Bluesky (Cardyb),
    // Pinterest, Viber, Line, KakaoTalk, Snapchat and the embed services.
    "TelegramBot|Mastodon|Cardyb|Pinterest|Viber|Line/|kakaotalk-scrap|Snap URL Preview",
    "Embedly|Iframely|Google-PageRenderer",
  ].join("|"),
  "i",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  htmlLimitedBots: HTML_LIMITED_BOTS,
  /**
   * Partial prerendering for every route: each page ships a static shell (the
   * masthead, the nav, the footer and its loading skeleton) and streams the
   * figures in behind it. The shell carries no data, so it holds nothing that
   * can go stale and a build needs no database to produce one.
   *
   * The reason it is on: a link prefetch of a prerendered route is deterministic,
   * so it answers from the CDN with `s-maxage` instead of `no-store`. Prefetches
   * were 93% of production requests, and each one was a full render against the
   * database.
   *
   * It also makes Next hold a route you navigate away from in React `<Activity>`
   * rather than unmounting it, so client state survives Back.
   */
  cacheComponents: true,
  // Drop the X-Powered-By: Next.js header so responses don't advertise the framework/version.
  poweredByHeader: false,
  output: "standalone",
  typescript: { ignoreBuildErrors: false },

  /**
   * Keep Prisma's unused runtimes out of every function bundle. The trace takes
   * `@prisma/client/runtime` whole, so each function carried the wasm, edge,
   * browser, binary and react-native engines beside the Node library engine it
   * loads: about 56 MB of a 95 MB trace. Vercel counts every retained
   * deployment's functions against the plan's function storage, so the saving
   * repeats per function per deployment.
   *
   * The key is `"*"`, not the docs' `"/*"`: the shared `next-server` trace is
   * matched against the bare name `next-server`, which `"/*"` misses.
   */
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@prisma/client/runtime/query_engine_bg.*",
      "node_modules/@prisma/client/runtime/query_compiler_bg.*",
      "node_modules/@prisma/client/runtime/wasm-*",
      "node_modules/@prisma/client/runtime/edge*",
      "node_modules/@prisma/client/runtime/binary.*",
      "node_modules/@prisma/client/runtime/react-native.*",
      "node_modules/@prisma/client/runtime/index-browser.*",
      "node_modules/@prisma/client/runtime/*.d.mts",
      "node_modules/.prisma/client/edge.js",
      "node_modules/.prisma/client/wasm*",
      "node_modules/.prisma/client/index-browser.js",
    ],
  },

  // Silence "inferred workspace root" warning + skip Next.js polyfills for modern browsers
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      // All APIs polyfilled here are natively supported by our browserslist targets
      // (Chrome 93+, Firefox 92+, Safari 15.4+, Edge 93+). Replacing with an empty
      // module removes ~14 KiB of flagged-but-never-executed legacy JS from the bundle.
      "next/dist/build/polyfills/polyfill-module": path.resolve(
        __dirname,
        "src/empty-polyfills.js",
      ),
    },
  },

  /**
   * Security headers for every route.
   * Sets clickjacking, MIME-sniffing, referrer, permissions, and CSP
   * (CSP switches between dev and prod variants).
   * @returns Header rules applied to all paths.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: isDev ? cspDev : cspProd },
        ],
      },
      // Cache static assets in /source/ for 30 days (they are not hash-named)
      {
        source: "/source/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },

  /**
   * Route URLs that move, answered before any render. The route page redirects
   * these too, but it streams behind a loading skeleton, and a `redirect()` in a
   * stream arrives as a 200 carrying the whole page plus a one-second meta
   * refresh. Only moves decidable from the URL alone live here; wrong-case slugs
   * and out-of-range days need the database and stay in the page.
   * @returns Redirect rules, first match wins.
   */
  async redirects() {
    return [
      // The City Rail Link's retired train lines (src/lib/route-lineage.ts keeps the same pairs,
      // and a test holds the two together). Every successor has run since 13 September 2026.
      { source: "/route/STH", destination: "/route/S-C", permanent: true },
      { source: "/route/EAST", destination: "/route/E-W", permanent: true },
      { source: "/route/WEST", destination: "/route/E-W", permanent: true },
      { source: "/route/ONE", destination: "/route/O-W", permanent: true },
      // A full route id to its slug, the rule in routeSlug: "NX1-203" > "NX1", "S-C-201" > "S-C".
      // The lazy slug keeps its own dashes and gives up only the trailing "-digits".
      {
        source: "/route/:slug([^/]+?)-:version(\\d+)",
        destination: "/route/:slug",
        permanent: true,
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    // Hold a visited page's streamed figures in the client for one ingest cycle,
    // so stepping back to a day just seen needs no server round trip. This covers
    // the part that streams; a prerendered shell carries its own stale time. The
    // default of 0 refetched every visit. A live page cannot sit on stale figures
    // for long: the footer's refresh on a new run clears this cache.
    staleTimes: { dynamic: 120 },
  },
} satisfies NextConfig;

export default nextConfig;
