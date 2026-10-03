import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { LIST_PAGE_SIZE } from "@/lib/page/filter-params";
import Link from "next/link";
import type { JSX } from "react";

/** Props for {@link ShowMore}: a link for a server-rendered list, a click for a client one. */
export type ShowMoreProps = {
  /** How many rows are still hidden. */
  remaining: number;
  /** Extra classes for the centring wrapper (spacing). */
  className?: string;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

/**
 * The "Show 30 more of 112" button under a long list, or "Show 13 more" once
 * one more step shows the rest. Every list grows by the
 * same {@link LIST_PAGE_SIZE}, so the count always reads the same way.
 * @param props - Component props.
 * @param props.remaining - Rows still hidden.
 * @param props.className - Wrapper classes.
 * @param props.href - The list with more rows shown, for a server-rendered list.
 * @param props.onClick - Show more rows, for a client list.
 * @returns The button, centred.
 */
export function ShowMore({ remaining, className, href, onClick }: ShowMoreProps): JSX.Element {
  const label =
    remaining > LIST_PAGE_SIZE
      ? `Show ${LIST_PAGE_SIZE} more of ${formatCount(remaining)}`
      : `Show ${formatCount(remaining)} more`;
  return (
    <div className={cn("flex justify-center", className)}>
      {href !== undefined ? (
        // scroll={false}: the reader stays at the bottom of the list they grew.
        <Link href={href} scroll={false} className="chip chip-off">
          {label}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className="chip chip-off">
          {label}
        </button>
      )}
    </div>
  );
}
