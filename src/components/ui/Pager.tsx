// src/components/ui/Pager.tsx
// Numbered page links under a server-rendered list.

import { ChipLink } from "@/components/Chip";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { JSX } from "react";

/**
 * Compact page list around the current page: always the first and last page,
 * the current page and its neighbours, with `"…"` gaps for the runs of two or
 * more pages in between (`1 … 5 6 7 … 50`).
 * @param current - The active 1-based page.
 * @param total - Total number of pages.
 * @returns Page numbers interleaved with `"…"` gap markers.
 */
export function pageWindow(current: number, total: number): (number | "…")[] {
  const wanted = [1, total, current, current - 1, current + 1];
  const nums = [...new Set(wanted)].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of nums) {
    // A gap of one page shows that page: "…" would take the same room and hide it.
    if (n - prev === 2) out.push(prev + 1);
    else if (n - prev > 2) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Previous, numbered and next page links. Renders nothing for a single page.
 * @param props - Component props.
 * @param props.page - The active 1-based page.
 * @param props.totalPages - How many pages there are.
 * @param props.hrefOf - The link to a page.
 * @param props.label - Names the list for assistive tech ("Trip pages").
 * @param props.className - Extra classes (spacing).
 * @returns The page links, or null.
 */
export function Pager({
  page,
  totalPages,
  hrefOf,
  label,
  className,
}: {
  page: number;
  totalPages: number;
  hrefOf: (page: number) => string;
  label: string;
  className?: string;
}): JSX.Element | null {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label={label}
      className={cn("flex flex-wrap items-center justify-center gap-1", className)}
    >
      {page > 1 ? (
        <ChipLink href={hrefOf(page - 1)} scroll className="chip-icon" ariaLabel="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </ChipLink>
      ) : (
        <span className="step-slot" />
      )}
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} aria-hidden className="px-1 text-at-muted">
            …
          </span>
        ) : (
          <ChipLink
            key={p}
            href={hrefOf(p)}
            scroll
            active={p === page}
            ariaLabel={`Page ${p}`}
            className="chip-icon tabular-nums"
          >
            {p}
          </ChipLink>
        ),
      )}
      {page < totalPages ? (
        <ChipLink href={hrefOf(page + 1)} scroll className="chip-icon" ariaLabel="Next page">
          <ChevronRight className="h-4 w-4" />
        </ChipLink>
      ) : (
        <span className="step-slot" />
      )}
    </nav>
  );
}
