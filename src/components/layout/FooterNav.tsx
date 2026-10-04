"use client";
// src/components/layout/FooterNav.tsx
// The footer's Explore list. Carries the reader's day, window and mode the same
// way the top bar does (see lib/page/site-nav.ts), so following one from an
// archived day stays on that day rather than jumping to the present.

import { navHref, SITE_PAGES } from "@/lib/page/site-nav";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type JSX } from "react";

/**
 * The list items, given the params to carry.
 * @param props - Component props.
 * @param props.params - The current query params, or empty before they are read.
 * @returns The list items.
 */
function FooterLinks({ params }: { params: URLSearchParams }): JSX.Element {
  return (
    <>
      {SITE_PAGES.map((p) => (
        <li key={p.href}>
          <Link href={navHref(p, params)} className="text-white/90 hover:text-at-safety">
            {p.label}
          </Link>
        </li>
      ))}
    </>
  );
}

/**
 * The list items reading the live query params.
 * @returns The list items.
 */
function FooterLinksWithParams(): JSX.Element {
  const searchParams = useSearchParams();
  return <FooterLinks params={new URLSearchParams(searchParams.toString())} />;
}

/**
 * The footer's Explore list, each link keeping the day being read.
 * @returns The list element.
 */
export function FooterNav(): JSX.Element {
  return (
    // Two columns filled top to bottom: six rows put the top bar's first two
    // groups on the left and its third (the worst-of boards, cancellations and
    // compare) on the right, and keep the list half the height on a phone.
    <ul className="grid grid-flow-col grid-rows-6 gap-x-6 gap-y-2">
      {/* Reading the query suspends a statically rendered page; plain links stand in. */}
      <Suspense fallback={<FooterLinks params={new URLSearchParams()} />}>
        <FooterLinksWithParams />
      </Suspense>
    </ul>
  );
}
