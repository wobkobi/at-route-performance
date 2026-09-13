// src/app/(home)/loading.tsx
// Loading skeleton for the home page.

import { RankBoardSkeleton } from "@/components/RankingsBodySkeleton";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Home page loading skeleton - shown by Next.js during navigation while the
 * async page.tsx resolves. Mirrors the page layout so there is no layout shift.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-9 w-56" />
        <Bone className="h-8 w-36" />
      </div>

      {/* KPI strip: one bordered box of five cells, as FleetSummary renders it */}
      <div className="border border-at-border bg-at-surface">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-3">
              <Bone className="mb-2 h-3 w-16" />
              <Bone className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Shame section heading */}
      <Bone className="h-7 w-48" />

      {/* 2-col shame card grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Bone className="h-32" />
        <Bone className="h-32" />
      </div>

      {/* Filter row: mode chips (All + up to 3) + school-bus toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-8 w-16 rounded-full" />
        ))}
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* Delay filter (right-aligned) */}
      <div className="flex justify-end">
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* Board grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton />
        <RankBoardSkeleton />
      </div>

      {/* Collapsed "All routes" summary bar */}
      <div className="border border-at-border bg-at-surface px-4 py-3">
        <Bone className="h-5 w-24" />
      </div>
    </main>
  );
}
