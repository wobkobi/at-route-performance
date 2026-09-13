// src/components/RankingsBodySkeleton.tsx
// Pulse-placeholder skeleton for the rankings page body (KPI strip
// to route table), shared by the rankings loading page and the in-page Suspense
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
 * filters, rank boards, the refresh note and the start of the route table.
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

      {/* Route table: the search box (38px), then the table head and first rows */}
      <div className="space-y-2">
        <Bone className="h-9.5 rounded-none" />
        <div className="border border-at-border bg-at-surface">
          <Bone className="h-9 rounded-none" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-t border-at-border px-3 py-2.5">
              <Bone className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
