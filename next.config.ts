// next.config.ts
import bundleAnalyzer from "@next/bundle-analyzer";
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
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

  images: {
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    // Hold a visited page in the client for one ingest cycle, so stepping back to
    // a day just seen needs no server round trip. Every page is dynamic, and the
    // default of 0 refetched each one on every visit. A live page cannot sit on
    // stale figures for long: the footer's refresh on a new run clears this cache.
    staleTimes: { dynamic: 120 },
  },
} satisfies NextConfig;

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(nextConfig);
