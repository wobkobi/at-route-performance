// src/app/layout.tsx
// Root layout - AT-branded masthead, page container, and footer wrapping every route.

import { DevHostRedirect } from "@/components/layout/DevHostRedirect";
import { FooterFreshness } from "@/components/layout/FooterFreshness";
import { FooterNav } from "@/components/layout/FooterNav";
import { SiteNav } from "@/components/layout/SiteNav";
import { cn } from "@/lib/cn";
import { SERVICE_DAY_NOTE, SITE_NAME } from "@/lib/copy";
import { productionOrigin } from "@/lib/site-url";
import { DATA_START_LABEL } from "@/lib/time/data-start";
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
  // The template names the site in every child segment's tab, so a page that
  // sets its own title no longer replaces the only mention of where it is.
  // It does not reach a title set in this same segment, which is why the home
  // page sets none and takes the default.
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description:
    "How close Auckland's buses, trains and ferries run to their timetable, measured every day.",
};

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
          "flex min-h-screen flex-col bg-at-surface font-brand text-at-ink antialiased",
        )}
      >
        {process.env.NODE_ENV === "development" && <DevHostRedirect />}
        <a
          href="#main"
          className="sr-only z-50 bg-at-surface px-4 py-2 text-at-shore focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {/* White masthead. The rule under it is the page's heaviest mark, in ink
            rather than the hairline grey every container used to carry. It sticks
            from sm up only: on a phone the logo row and two rows of tabs are a
            fifth of the screen, too much to hold over every page. */}
        <header className="z-40 border-b-2 border-at-ink bg-at-surface sm:sticky sm:top-0">
          {/* Nine tabs need about 900px, so the nav takes a row of its own under
              the logo until the viewport leaves room beside it. */}
          <div className="at-container flex flex-col gap-2 py-2 sm:py-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
            {/* The label is on the link, not the logo: the wordmark beside it is
                hidden on a phone, so an empty alt there would leave the home link
                with no accessible name, and naming the logo "Auckland Transport"
                announced the agency as this site's identity. */}
            <Link
              href="/"
              aria-label={`${SITE_NAME} home`}
              className="flex shrink-0 items-center gap-3"
            >
              {/* Shore colourway on the light header; never recolour/distort (guide p13/p14) */}
              <Image
                src="/source/logos/at-logo-shore.png"
                alt=""
                width={48}
                height={48}
                priority
                className="h-9 w-auto sm:h-11"
              />
              {/* Always shown: the nav has a row of its own until there is room for
                  logo, name and tabs on one. */}
              <span className="text-base font-ultra tracking-zero text-at-ink md:text-lg">
                {SITE_NAME}
              </span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <div id="main" className="at-container flex-1 py-8">
          {children}
        </div>
        {/* Dark Ocean footer with link columns + a legal sub-bar, like at.govt.nz. */}
        <footer className="bg-at-ocean text-white">
          <div className="at-container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {/* Decorative: the wordmark beside it is always visible here. */}
                <Image
                  src="/source/logos/at-logo-white.png"
                  alt=""
                  width={40}
                  height={40}
                  priority
                  className="h-9 w-auto"
                />
                <span className="font-ultra tracking-zero">{SITE_NAME}</span>
              </div>
              <p className="max-w-xs text-sm text-white/70">
                An independent project built from Auckland Transport&apos;s public GTFS feeds, not
                affiliated with Auckland Transport.
              </p>
            </div>
            <nav className="space-y-3 text-sm">
              <h2 className="text-xs font-semibold tracking-zero text-white/50 uppercase">
                Explore
              </h2>
              <FooterNav />
            </nav>
            <div className="space-y-3 text-sm">
              <h2 className="text-xs font-semibold tracking-zero text-white/50 uppercase">
                About the data
              </h2>
              <p className="text-xs text-white/50">
                Records start {DATA_START_LABEL}. All times are Auckland local.
              </p>
              {/* The 4am boundary decides which day a 1am run is counted in, and the
                  day stepper could only say so on hover. */}
              <p className="text-xs text-white/50">{SERVICE_DAY_NOTE}</p>
              <Suspense fallback={<p className="text-xs text-white/50">Loading…</p>}>
                <FooterFreshness />
              </Suspense>
            </div>
          </div>
          <div className="border-t border-white/10">
            <div className="at-container py-4 text-xs text-white/50">
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
