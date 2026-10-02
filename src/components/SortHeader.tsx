// src/components/SortHeader.tsx
// Column heading that sorts its table by that column when pressed.

import { SortArrow } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { SortDir } from "@/lib/page/table-sort";
import Link from "next/link";
import type { JSX } from "react";

/**
 * A column heading. With an `href` it links to the table sorted by this column
 * (the sorted column's link flips its direction) and reports the sort through
 * `aria-sort`; without one it is a plain heading styled to match.
 * @param props - Props.
 * @param props.href - The page sorted by this column, or undefined for a plain heading.
 * @param props.dir - The direction when this is the sorted column, else null.
 * @param props.align - Text alignment; numeric columns are right-aligned.
 * @param props.className - Extra classes, usually padding and responsive visibility.
 * @param props.children - The heading text.
 * @returns The header cell.
 */
export function SortHeader({
  href,
  dir = null,
  align = "right",
  className,
  children,
}: {
  href?: string;
  dir?: SortDir | null;
  align?: "left" | "right";
  className?: string;
  children: string;
}): JSX.Element {
  return (
    <th
      scope="col"
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
      className={cn(
        "p-3 font-semibold whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
        dir && "text-at-ink",
        className,
      )}
    >
      {href ? (
        // scroll={false}: a re-sort keeps the reader where the table is.
        <Link
          href={href}
          scroll={false}
          className={cn(
            "inline-flex items-center gap-1 hover:text-at-ink hover:underline",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <SortArrow dir={dir} />
        </Link>
      ) : (
        children
      )}
    </th>
  );
}
