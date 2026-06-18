import { SiteNav } from "@/components/SiteNav";
import { cn } from "@/lib/cn";
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
          "min-h-screen bg-at-bg font-brand text-at-ink antialiased",
        )}
      >
        <header className="bg-at-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              {/* Shore colourway on the light header; never recolour/distort (guide p13/p14) */}
              <Image
                src="/source/logos/at-logo-shore.png"
                alt="Auckland Transport"
                width={48}
                height={48}
                priority
                className="h-12 w-auto"
              />
              <span className="text-lg font-ultra tracking-zero text-at-shore">
                Route Performance
              </span>
            </Link>
            <SiteNav />
          </div>
          {/* Metro-line accent runs full width beneath the header. */}
          <div className="metro-rule" />
        </header>
        <div className={cn("mx-auto max-w-6xl px-4 py-8")}>{children}</div>
        <footer className="mx-auto max-w-6xl px-4 pt-4 pb-8 text-xs text-at-muted">
          Live performance from Auckland Transport&apos;s GTFS feeds. Times are Auckland local.
        </footer>
      </body>
    </html>
  );
}
