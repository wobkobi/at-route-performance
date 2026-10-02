// src/app/not-found.tsx
// Global 404 page: a directory of every page, and a way on to the route list.

import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SITE_PAGES } from "@/lib/page/site-nav";
import { viewQuery } from "@/lib/route/explorer";
import { buildHref } from "@/lib/utils";
import Link from "next/link";
import type { JSX } from "react";
import type { IconType } from "react-icons";
import {
  FaBalanceScale,
  FaBan,
  FaBroadcastTower,
  FaBuilding,
  FaBusAlt,
  FaCalendarAlt,
  FaChartBar,
  FaExclamationTriangle,
  FaHome,
  FaMapMarkerAlt,
  FaRoute,
} from "react-icons/fa";

/**
 * An icon for each page in {@link SITE_PAGES}. This is the one page whose whole
 * job is being a way out, so the list itself is the site's, and a page added
 * there fails the typecheck here until it has an icon.
 */
const ICONS: Record<(typeof SITE_PAGES)[number]["href"], IconType> = {
  "/": FaHome,
  "/days": FaCalendarAlt,
  "/routes": FaChartBar,
  "/operators": FaBuilding,
  "/vehicles": FaBusAlt,
  "/live": FaBroadcastTower,
  "/shame/trip": FaExclamationTriangle,
  "/shame/route": FaRoute,
  "/shame/stop": FaMapMarkerAlt,
  "/cancellations": FaBan,
  "/compare": FaBalanceScale,
};

/** Every route, in number order: the Routes page's full list rather than its ranking. */
const ALL_ROUTES_HREF = buildHref("/routes", viewQuery("all"));

/**
 * Global 404 page - rendered by Next.js when `notFound()` is called from any
 * route or stop page, or when a path matches no route segment.
 *
 * It links to the route list rather than listing the routes itself. Next.js
 * sends a layout's not-found tree with every page it renders, so that
 * `notFound()` can show without a round trip, and a list of every route made
 * that tree most of what each page sent.
 * @returns 404 markup.
 */
export default function NotFound(): JSX.Element {
  return (
    <main className="space-y-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-6xl font-ultra tracking-zero text-at-muted">404</p>
        {/* This page answers an unmatched path as well as a notFound() from a
            route or stop, and Next gives it no way to tell which, so it names
            all three rather than asserting the one it cannot know. */}
        <PageHeader
          title="Page not found"
          subtitle="That address does not match a page, a route or a stop. Everything the site has is below."
          className="justify-center"
        />
      </div>

      {/* Page directory */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {SITE_PAGES.map(({ href, label }) => {
          const Icon = ICONS[href];
          return (
            <Link
              key={href}
              href={href}
              className="at-card flex items-center gap-3 p-4 transition-colors hover:bg-at-shore-pale"
            >
              <Icon className="h-5 w-5 shrink-0 text-at-shore" aria-hidden />
              <p className="font-semibold text-at-ink">{label}</p>
            </Link>
          );
        })}
      </div>

      <section className="space-y-3">
        <SectionHeading>All routes</SectionHeading>
        <p className="text-sm text-at-muted">
          Looking for a route?{" "}
          <Link href={ALL_ROUTES_HREF} className="at-link font-semibold">
            Every route
          </Link>{" "}
          is on the Routes page, school buses included.
        </p>
      </section>
    </main>
  );
}
