// src/components/RankingsBodySkeleton.tsx
/**
 * @description Pulse-placeholder skeleton for the rankings page body (KPI strip
 * to route table), shared by the rankings loading page and the in-page Suspense
 * fallback while the ranking batch streams.
 */
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Skeleton for a single rank-board card.
 * @returns The card placeholder.
 */
function RankBoardSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 border border-at-border p-4">
      <Bone className="mb-3 h-6 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Bone key={i} className="h-10" />
      ))}
    </div>
  );
}

/**
 * Skeleton for everything below the rankings header: KPI strip, shame cards,
 * filters, rank boards and the route table.
 * @returns The body placeholder.
 */
export function RankingsBodySkeleton(): JSX.Element {
  return (
    <>
      {/* Fleet KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20" />
        ))}
      </div>

      {/* Shame heading */}
      <Bone className="h-7 w-48" />

      {/* 2-col shame cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Bone className="h-32" />
        <Bone className="h-32" />
      </div>

      {/* Mode + school filter row */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-8 w-16 rounded-full" />
        ))}
      </div>

      {/* Delay filter */}
      <div className="flex justify-end">
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* 2-col rank boards */}
      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton />
        <RankBoardSkeleton />
      </div>

      {/* Explanatory paragraph above the route table */}
      <div className="space-y-1.5">
        <Bone className="h-3.5 w-full max-w-xl" />
        <Bone className="h-3.5 w-full max-w-md" />
      </div>

      {/* Route table */}
      <div className="border border-at-border">
        <Bone className="h-10 rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Bone key={i} className="mt-px h-12 rounded-none" />
        ))}
      </div>
    </>
  );
}
