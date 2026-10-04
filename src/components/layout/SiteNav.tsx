"use client";
// src/components/layout/SiteNav.tsx
// Primary site navigation links, highlighting the current section.

import { cn } from "@/lib/cn";
import { isNavActive, NAV_GROUPS, navHref } from "@/lib/page/site-nav";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type JSX } from "react";

/**
 * The nav links, in their groups. Each carries the current day, window and mode
 * filter (see lib/page/site-nav.ts), so moving between sections keeps the period
 * being looked at.
 * @param props - Component props.
 * @param props.params - The current query params, or empty before they are read.
 * @returns The links.
 */
function NavLinks({ params }: { params: URLSearchParams }): JSX.Element {
  const pathname = usePathname();
  return (
    <>
      {NAV_GROUPS.map((group, i) => (
        // From lg up the tabs always make one row, and a rule divides the groups.
        // Below that they can wrap, and a rule would start a line wherever a
        // group wrapped, so the groups are parted by space alone. On a phone the
        // groups dissolve into one wrapped run of tabs: two rows rather than a
        // row per group.
        <div
          key={group.map((s) => s.href).join(" ")}
          className={cn(
            "contents sm:flex sm:flex-wrap sm:items-center sm:gap-1",
            i > 0 && "lg:border-l lg:border-at-border lg:pl-3",
          )}
        >
          {group.map((s) => {
            const active = isNavActive(s, pathname);
            // The tab for the page you are already on is not a link: following it
            // would rebuild the URL from the carried params alone and drop the
            // page's own state, which on Routes is the whole explorer (search,
            // area, sort, late or early). A section tab from one of its sub-pages stays a
            // link, since /route/20 > /routes is a real navigation.
            // px-2 below sm keeps each group to one row on a 360px phone.
            const className = cn(
              "inline-flex tap-h shrink-0 items-center px-2 py-1 text-xs font-semibold transition-colors sm:px-3 sm:text-sm",
              active ? "bg-at-shore text-white" : "text-at-ink hover:bg-at-shore-pale",
            );
            return pathname === s.href ? (
              <span key={s.href} aria-current="page" className={className}>
                {s.label}
              </span>
            ) : (
              // A lit section tab here is the parent of the current page, not the
              // page itself, so it is marked as the current section rather than page.
              <Link
                key={s.href}
                href={navHref(s, params)}
                aria-current={active ? "true" : undefined}
                className={className}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

/**
 * Nav links reading the live query params.
 * @returns The links.
 */
function NavLinksWithParams(): JSX.Element {
  const searchParams = useSearchParams();
  return <NavLinks params={new URLSearchParams(searchParams.toString())} />;
}

/**
 * Primary site navigation links, highlighting the current section.
 * @returns The nav element.
 */
export function SiteNav(): JSX.Element {
  return (
    // Wrapped rather than scrolled: a tab past the edge of a scroll strip is one
    // a reader never finds.
    <nav
      aria-label="Main"
      className="flex min-w-0 flex-wrap items-center gap-0.5 sm:gap-x-4 sm:gap-y-1 lg:gap-x-3"
    >
      {/* Reading the query suspends a statically rendered page; plain links stand in. */}
      <Suspense fallback={<NavLinks params={new URLSearchParams()} />}>
        <NavLinksWithParams />
      </Suspense>
    </nav>
  );
}
