// src/components/RankingsBodySkeleton.tsx
// Pulse-placeholder skeleton for the week or month home's rankings band body,
// the Suspense fallback under the "Route rankings" heading while the batch streams.

import { Bone, RankBoardSkeleton } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Skeleton for the two rank boards and the refresh note under them.
 * @returns The body placeholder.
 */
export function RankingsBodySkeleton(): JSX.Element {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Both boards rank against the period before, so their rows reserve the
            movement badge - every period but the archive's first, which has none
            to compare and draws the narrow rank column instead. */}
        <RankBoardSkeleton colourKey deltas />
        <RankBoardSkeleton deltas />
      </div>

      {/* Refresh note: one text-xs line */}
      <Bone className="h-4 w-full max-w-md" />
    </>
  );
}
