// src/app/(home)/loading.tsx
// Loading skeleton for the home page.

import {
  BoardFiltersSkeleton,
  ChipBone,
  DayNavSkeleton,
  FeatureCardPairSkeleton,
  KpiStripSkeleton,
  RankBoardSkeleton,
  TitleBone,
} from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Home page loading skeleton - shown by Next.js during navigation while the
 * async page.tsx resolves. Drawn for the day view, the default; the week and
 * month views share its blocks. Built from the box-for-box skeleton parts, so each
 * block matches the page's own size and nothing shifts when it arrives.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TitleBone className="w-80" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-13" />
            <ChipBone className="w-16" />
            <ChipBone className="w-18" />
          </div>
          <DayNavSkeleton />
        </div>
      </header>

      <KpiStripSkeleton verdict />

      {/* "Shame of the day" heading: text-lg, 28px */}
      <Bone className="h-7 w-44" />
      <FeatureCardPairSkeleton />

      <BoardFiltersSkeleton />

      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton colourKey />
        <RankBoardSkeleton />
      </div>
    </main>
  );
}
