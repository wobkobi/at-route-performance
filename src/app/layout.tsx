// src/app/layout.tsx
// Root layout - AT-branded masthead, page container, and footer wrapping every route.

import { DevHostRedirect } from "@/components/DevHostRedirect";
import { FooterFreshness } from "@/components/FooterFreshness";
import { FooterNav } from "@/components/FooterNav";
import { SiteNav } from "@/components/SiteNav";
import { cn } from "@/lib/cn";
import { DATA_START_LABEL } from "@/lib/data-start";
import { productionOrigin } from "@/lib/site-url";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { JSX } from "react";
import { Suspense } from "react";
import { gothamNarrow } from "./fonts";
import "./globals.css";

// The production origin, so card and page URLs in metadata resolve absolute.
// Null locally, where Next falls back to localhost; a preview deployment's own
// URL still wins for its cards.
const productionBase = productionOrigin();

export const metadata: Metadata = {
  metadataBase: productionBase ? new URL(productionBase) : undefined,
  title: "Auckland Transport Route Performance",
  description: "Auckland Transport route and stop performance analytics.",
};

// All pages query the database; skip static generation so CI builds succeed
// without DATABASE_URL and production renders always use live data.
export const dynamic = "force-dynamic";

/**
 * Root layout: AT-branded header + page container.
 * @param props - The page content to render.
 * @param props.children - The nested page elements.
 * @returns The root HTML layout.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <html lang="en">
      <body
        // Browser extensions (e.g. Grammarly) inject data-* attributes onto
        // <body> before hydration; suppress the resulting attribute mismatch.
        suppressHydrationWarning
        className={cn(
          gothamNarrow.variable,
          "flex min-h-screen flex-col bg-at-bg font-brand text-at-ink antialiased",
        )}
      >
        {process.env.NODE_ENV === "development" && <DevHostRedirect />}
        <a
          href="#main"
          className="sr-only z-50 bg-at-surface px-4 py-2 text-at-shore focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {/* Sticky white masthead with a hairline border, like at.govt.nz. */}
        <header className="sticky top-0 z-40 border-b border-at-border bg-at-surface">
          {/* Five tabs need more width than a 390px phone leaves beside the logo,
              so the nav takes a row of its own until there is room to share one. */}
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 min-[1440px]:max-w-[80vw] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Link href="/" className="flex shrink-0 items-center gap-3">
              {/* Shore colourway on the light header; never recolour/distort (guide p13/p14) */}
              <Image
                src="/source/logos/at-logo-shore.png"
                alt="Auckland Transport"
                width={48}
                height={48}
                priority
                className="h-11 w-auto"
              />
              {/* The nav needs the width on a phone, where the logo stands alone. */}
              <span className="hidden text-lg font-ultra tracking-zero text-at-ink sm:inline">
                Transport Tracker
              </span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <div
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 min-[1440px]:max-w-[80vw]"
        >
          {children}
        </div>
        {/* Dark Ocean footer with link columns + a legal sub-bar, like at.govt.nz. */}
        <footer className="bg-at-ocean text-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 min-[1440px]:max-w-[80vw] sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Image
                  src="/source/logos/at-logo-white.png"
                  alt="Auckland Transport"
                  width={40}
                  height={40}
                  priority
                  className="h-9 w-auto"
                />
                <span className="font-ultra tracking-zero">Route Performance</span>
              </div>
              <p className="max-w-xs text-sm text-white/70">
                Live performance from Auckland Transport&apos;s GTFS feeds. Times are Auckland
                local.
              </p>
            </div>
            <nav className="space-y-3 text-sm">
              <h2 className="text-xs font-semibold tracking-zero text-white/50 uppercase">
                Explore
              </h2>
              <FooterNav />
            </nav>
            <div className="space-y-3 text-sm">
              <h2 className="text-xs font-semibold tracking-zero text-white/50 uppercase">About</h2>
              <p className="max-w-xs text-white/70">
                An independent project, not affiliated with Auckland Transport.
              </p>
              <p className="text-xs text-white/50">Records start {DATA_START_LABEL}.</p>
              <Suspense fallback={<p className="text-xs text-white/50">Loading…</p>}>
                <FooterFreshness />
              </Suspense>
            </div>
          </div>
          <div className="border-t border-white/10">
            <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/50 min-[1440px]:max-w-[80vw]">
              Data &copy; Auckland Transport, used under the GTFS open-data feeds.
            </div>
          </div>
        </footer>
        {/* Both scripts are served from /_vercel/ on a Vercel deployment only, so
            anywhere else (local builds, the CI smoke) they would 404 as text/plain.
            Same-origin, so neither needs the CSP in next.config.ts opened up. */}
        {process.env.VERCEL && (
          <>
            <SpeedInsights />
            <Analytics />
          </>
        )}
      </body>
    </html>
  );
}
