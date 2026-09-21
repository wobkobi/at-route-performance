// src/components/RankingsHeader.tsx
// Heading row over the home page's two rank boards, with the controls that
// filter only those boards on the right.

import type { JSX, ReactNode } from "react";

/**
 * Render the "Route rankings" heading with its board-only controls beside it,
 * wrapping under the heading on a phone. Same `text-lg` heading as the shame
 * band's `SectionLink`, so the bands read as one set. Holds no filter logic: the
 * caller passes the chips in.
 * @param props - Component props.
 * @param props.children - Controls that filter the boards below.
 * @returns The heading row.
 */
export function RankingsHeader({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-ultra tracking-zero text-at-ink">Route rankings</h2>
      {children}
    </div>
  );
}
