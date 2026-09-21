// src/app/stop/[id]/loading.tsx
// Loading skeleton for the stop detail page.

import {
  DayNavSkeleton,
  MapSectionSkeleton,
  RankBoardSkeleton,
  StatCellsSkeleton,
  StopScheduleSkeleton,
  TitleBone,
} from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Stop page loading skeleton: the "Stop" label over the name beside the day
 * stepper, the stats strip, the map card, the worst-routes board (a stop is
 * served by a handful of routes, so two rows) and the departures table.
 * @returns Skeleton layout matching the stop page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Bone className="h-4 w-10" />
          <TitleBone className="w-40" />
        </div>
        <DayNavSkeleton />
      </header>

      <StatCellsSkeleton />
      <MapSectionSkeleton mapClass="h-100" />
      <RankBoardSkeleton colourKey rows={2} />
      <StopScheduleSkeleton />
    </main>
  );
}
