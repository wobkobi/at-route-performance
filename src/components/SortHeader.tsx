// src/components/SortHeader.tsx
// Right-aligned numeric column header for the two boards ranked by a chip row,
// /live and /vehicles.

import { cn } from "@/lib/cn";
import type { JSX } from "react";

/**
 * A right-aligned numeric column header, marked when the board is ranked by it.
 * `aria-sort` is always `descending` because both boards rank worst-first and
 * neither offers an ascending order - a header here reports the ranking rather
 * than offering to change it, since the chips above the table do that.
 * @param root0 - Props.
 * @param root0.active - Whether the board is ranked by this column.
 * @param root0.className - Extra classes, usually responsive visibility.
 * @param root0.children - The header text.
 * @returns The header cell.
 */
export function SortHeader({
  active = false,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: string;
}): JSX.Element {
  return (
    <th
      scope="col"
      aria-sort={active ? "descending" : undefined}
      className={cn(
        "p-3 text-right font-semibold whitespace-nowrap",
        active && "text-at-ink",
        className,
      )}
    >
      {children}
    </th>
  );
}
