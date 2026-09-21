// src/components/RankingsBodySkeleton.tsx
// Pulse-placeholder skeleton for the week or month home's rankings band body,
// the Suspense fallback under the "Route rankings" heading while the batch streams.

import { RankBoardSkeleton } from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Skeleton for the two rank boards and the refresh note under them.
 * @returns The body placeholder.
 */
export function RankingsBodySkeleton(): JSX.Element {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton colourKey />
        <RankBoardSkeleton />
      </div>

      {/* Refresh note: one text-xs line */}
      <Bone className="h-4 w-full max-w-md" />
    </>
  );
}
