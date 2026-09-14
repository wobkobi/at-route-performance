// src/components/SectionLink.tsx
// A section heading that links to the page holding the section's full version.

import { ChevronRight } from "@/components/icons";
import Link from "next/link";
import type { JSX } from "react";

/**
 * Render a `text-lg` section heading as a link with a trailing chevron, the same
 * affordance as a rank board's heading.
 * @param props - Component props.
 * @param props.title - Heading text.
 * @param props.href - Where the heading leads.
 * @returns The heading element.
 */
export function SectionLink({ title, href }: { title: string; href: string }): JSX.Element {
  return (
    <h2 className="text-lg font-ultra tracking-zero text-at-ink">
      <Link href={href} className="inline-flex items-center gap-1.5 hover:opacity-80">
        {title}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
      </Link>
    </h2>
  );
}
