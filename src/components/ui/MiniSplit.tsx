import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** The three shares a split bar draws, as percentages. */
export interface SplitShares {
  on_time_pct: number | null;
  late_pct?: number | null;
  early_pct?: number | null;
}

/**
 * A thin on time, late and early bar, in the colours every split on the site
 * uses, for a row or a column too tight for the full {@link SplitShares} figures.
 * Decorative: the shares it draws are always printed beside it.
 * @param props - Component props.
 * @param props.shares - The shares.
 * @param props.className - Extra classes, such as its top margin.
 * @returns The bar, or nothing when any share is unknown.
 */
export function MiniSplit({
  shares,
  className,
}: {
  shares: SplitShares | null;
  className?: string;
}): JSX.Element | null {
  if (shares?.on_time_pct == null || shares.late_pct == null || shares.early_pct == null) {
    return null;
  }
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden bg-at-bg", className)} aria-hidden>
      <div className="bg-at-ontime" style={{ width: `${shares.on_time_pct}%` }} />
      <div className="bg-at-late" style={{ width: `${shares.late_pct}%` }} />
      <div className="bg-at-early" style={{ width: `${shares.early_pct}%` }} />
    </div>
  );
}
