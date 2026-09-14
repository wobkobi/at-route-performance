// src/components/RankingsBodySkeleton.tsx
// Pulse-placeholder skeleton for the rankings page body (KPI strip
// to the refresh note), shared by the rankings loading page and the in-page Suspense
// fallback while the ranking batch streams.

import {
  BoardFiltersSkeleton,
  FeatureCardPairSkeleton,
  KpiStripSkeleton,
  RankBoardSkeleton,
} from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Skeleton for everything below the rankings header: KPI strip, shame cards,
 * filters, rank boards and the refresh note.
 * @returns The body placeholder.
 */
export function RankingsBodySkeleton(): JSX.Element {
  return (
    <>
      <KpiStripSkeleton />

      {/* "Shame of the week" heading: text-lg, 28px */}
      <Bone className="h-7 w-48" />
      <FeatureCardPairSkeleton />

      <BoardFiltersSkeleton />

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton caption />
        <RankBoardSkeleton />
      </div>

      {/* Refresh note: one text-xs line */}
      <Bone className="h-4 w-full max-w-md" />
    </>
  );
}
