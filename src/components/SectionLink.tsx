// src/components/SectionLink.tsx
// A band heading that links to the page holding the band's full version.

import { ChevronRight } from "@/components/icons";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * Render a band's heading as a link with a trailing chevron, the same affordance
 * as a rank board's heading. The heading sits on `.at-band`'s ink rule, which is
 * what separates one band of the page from the next now that the containers
 * inside them have no boxes of their own. Controls that filter only this band
 * (the rankings' Running box) sit on its right, wrapping under it on a phone.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.href - Where the heading leads.
 * @param props.children - Controls for this band alone (optional).
 * @returns The heading row.
 */
export function SectionLink({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="at-band flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-ultra tracking-zero text-at-ink sm:text-2xl">
        <Link href={href} className="inline-flex items-center gap-1.5 hover:opacity-80">
          {title}
          <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
        </Link>
      </h2>
      {children}
    </div>
  );
}
