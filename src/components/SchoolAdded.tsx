// src/components/SchoolAdded.tsx
// The small "+N" beside a count showing how much of it the School buses filter
// added, so including school services reads as a change rather than a jump.

import type { JSX } from "react";

/**
 * A "+N" beside a count, for the share of it that school services added.
 * Nothing when they added none, so an unchanged figure carries no mark.
 * @param props - Component props.
 * @param props.n - How much school services added; null or 0 draws nothing.
 * @returns The mark, or null.
 */
export function SchoolAdded({ n }: { n: number | null | undefined }): JSX.Element | null {
  if (!n || n <= 0) return null;
  const text = n.toLocaleString("en-NZ");
  return (
    <span
      className="ml-1.5 align-baseline text-xs font-semibold text-at-muted tabular-nums"
      title={`${text} from school buses`}
    >
      +{text}
      <span className="sr-only"> from school buses</span>
    </span>
  );
}
