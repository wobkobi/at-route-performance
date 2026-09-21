"use client";
// src/components/FooterNav.tsx
// The footer's Explore list. Carries the reader's day, window and mode the same
// way the top bar does (see lib/site-nav.ts), so following one from an archived
// day stays on that day rather than jumping to the present.

import { carriedHref } from "@/lib/site-nav";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type JSX } from "react";

/** The footer's destinations, in the order they are listed. */
const FOOTER_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/routes", label: "Routes" },
  { href: "/shame", label: "Shame of the day" },
  { href: "/cancellations", label: "Cancellations" },
];

/**
 * The list items, given the params to carry.
 * @param props - Component props.
 * @param props.params - The current query params, or empty before they are read.
 * @returns The list items.
 */
function FooterLinks({ params }: { params: URLSearchParams }): JSX.Element {
  return (
    <>
      {FOOTER_LINKS.map((l) => (
        <li key={l.href}>
          <Link href={carriedHref(l.href, params)} className="text-white/90 hover:text-at-safety">
            {l.label}
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
    <ul className="space-y-2">
      {/* Reading the query suspends a statically rendered page; plain links stand in. */}
      <Suspense fallback={<FooterLinks params={new URLSearchParams()} />}>
        <FooterLinksWithParams />
      </Suspense>
    </ul>
  );
}
