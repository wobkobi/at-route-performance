// src/components/SectionLink.tsx
// A section heading that links to the page holding the section's full version.

import { ChevronRight } from "@/components/icons";
import Link from "next/link";
import type { JSX } from "react";

/**
 * Render a section heading as a link with a trailing chevron, the same affordance
 * as a rank board's heading. The heading sits on `.at-band`'s ink rule, which is
 * what separates one band of the page from the next now that the containers
 * inside them have no boxes of their own.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.href - Where the heading leads.
 * @returns The heading element.
 */
export function SectionLink({ title, href }: { title: string; href: string }): JSX.Element {
  return (
    <h2 className="at-band text-xl font-ultra tracking-zero text-at-ink sm:text-2xl">
      <Link href={href} className="inline-flex items-center gap-1.5 hover:opacity-80">
        {title}
        <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
      </Link>
    </h2>
  );
}
