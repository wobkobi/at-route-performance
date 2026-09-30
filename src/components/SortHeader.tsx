// src/components/SortHeader.tsx
// Column heading that sorts its table by that column when pressed.

import { cn } from "@/lib/cn";
import type { SortDir } from "@/lib/page/table-sort";
import Link from "next/link";
import type { JSX } from "react";

/**
 * A small up or down triangle for the sorted column; a faint down one marks a
 * column that can be sorted but isn't, so the headings read as pressable. The
 * faint one is left off phones, where its width pushes a narrow table's last
 * column out of view.
 * @param props - Props.
 * @param props.dir - The column's direction, or null when it isn't the sorted one.
 * @returns The arrow SVG.
 */
function SortArrow({ dir }: { dir: SortDir | null }): JSX.Element {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden
      className={cn(
        "h-2 w-2 shrink-0",
        dir === null && "hidden opacity-30 sm:block",
        dir === "asc" && "rotate-180",
      )}
    >
      <path d="M1 3h8L5 8z" />
    </svg>
  );
}

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
