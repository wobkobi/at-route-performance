import { DataFreshness } from "@/components/DataFreshness";
import { SiteNav } from "@/components/SiteNav";
import { cn } from "@/lib/cn";
import { getDataFreshness } from "@/lib/ingest-run";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { JSX } from "react";
import { gothamNarrow } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auckland Transport Route Performance",
  description: "Auckland Transport route and stop performance analytics.",
};

/**
 * Root layout: AT-branded header + page container.
 * @param props - The page content to render.
 * @param props.children - The nested page elements.
 * @returns The root HTML layout.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<JSX.Element> {
  // Footer freshness: last successful realtime ingest (falls back to the freshest
  // recorded arrival until the first run is logged). Null only when there is no data.
  const freshness = await getDataFreshness();

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
        {/* Sticky white masthead with a hairline border, like at.govt.nz. */}
        <header className="sticky top-0 z-40 border-b border-at-border bg-at-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 min-[1440px]:max-w-[80vw]">
            <Link href="/" className="flex items-center gap-3">
              {/* Shore colourway on the light header; never recolour/distort (guide p13/p14) */}
              <Image
                src="/source/logos/at-logo-shore.png"
                alt="Auckland Transport"
                width={48}
                height={48}
                priority
                className="h-11 w-auto"
              />
              <span className="text-lg font-ultra tracking-zero text-at-ink">
                Transport Tracker
              </span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 min-[1440px]:max-w-[80vw]">
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
              <ul className="space-y-2">
                <li>
                  <Link href="/" className="text-white/90 hover:text-at-safety">
                    Today
                  </Link>
                </li>
                <li>
                  <Link href="/rankings" className="text-white/90 hover:text-at-safety">
                    Rankings
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="space-y-3 text-sm">
              <h2 className="text-xs font-semibold tracking-zero text-white/50 uppercase">About</h2>
              <p className="max-w-xs text-white/70">
                An independent project, not affiliated with Auckland Transport.
              </p>
              {freshness ? (
                <DataFreshness
                  lastUpdatedIso={freshness.lastUpdated.toISOString()}
                  nextUpdateIso={freshness.nextUpdate.toISOString()}
                />
              ) : (
                <p className="text-xs text-white/50">Awaiting first data.</p>
              )}
            </div>
          </div>
          <div className="border-t border-white/10">
            <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/50 min-[1440px]:max-w-[80vw]">
              Data &copy; Auckland Transport, used under the GTFS open-data feeds.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
