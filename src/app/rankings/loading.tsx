// src/app/rankings/loading.tsx
/**
 * @description Loading skeleton for the rankings page.
 */
import { RankingsBodySkeleton } from "@/components/RankingsBodySkeleton";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Rankings page loading skeleton.
 * @returns Skeleton layout matching the rankings page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-9 w-36" />
        <div className="flex flex-wrap items-center gap-2">
          <Bone className="h-8 w-14 rounded-full" />
          <Bone className="h-8 w-16 rounded-full" />
          <div className="flex items-center gap-2">
            <Bone className="h-8 w-7 rounded-full" />
            <Bone className="h-5 w-28" />
            <Bone className="h-8 w-7 rounded-full" />
          </div>
        </div>
      </header>

      <RankingsBodySkeleton />
    </main>
  );
}
