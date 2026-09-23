"use client";
// src/components/SiteNav.tsx
// Primary site navigation links, highlighting the current section.

import { cn } from "@/lib/cn";
import { isNavActive, NAV_SECTIONS, navHref } from "@/lib/site-nav";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type JSX } from "react";

/**
 * The nav links. Each carries the current day, window and mode filter (see
 * lib/site-nav.ts), so moving between sections keeps the period being looked at.
 * @param props - Component props.
 * @param props.params - The current query params, or empty before they are read.
 * @returns The links.
 */
function NavLinks({ params }: { params: URLSearchParams }): JSX.Element {
  const pathname = usePathname();
  return (
    <>
      {NAV_SECTIONS.map((s) => {
        const active = isNavActive(s, pathname);
        // The tab for the page you are already on is not a link: following it
        // would rebuild the URL from the carried params alone and drop the
        // page's own state, which on Routes is the whole explorer (search,
        // area, sort, lean). A section tab from one of its sub-pages stays a
        // link, since /route/20 > /routes is a real navigation.
        const className = cn(
          "shrink-0 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 sm:text-sm",
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
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
      {/* Reading the query suspends a statically rendered page; plain links stand in. */}
      <Suspense fallback={<NavLinks params={new URLSearchParams()} />}>
        <NavLinksWithParams />
      </Suspense>
    </nav>
  );
}
