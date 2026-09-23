// src/app/live/loading.tsx
import { LiveFiguresSkeleton, LiveTableSkeleton } from "@/components/LiveSkeleton";
import { Bone, ChipBone, TitleBone } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Live page loading skeleton: header, mode chips, figures, map, then the table.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header>
        <TitleBone className="w-40" />
        {/* Subtitle: mt-0.5 text-sm */}
        <Bone className="mt-0.5 h-5 w-80 max-w-full" />
      </header>
      <div className="flex gap-2">
        <ChipBone className="w-10" />
        <ChipBone className="w-12" />
        <ChipBone className="w-14" />
        <ChipBone className="w-14" />
      </div>
      <LiveFiguresSkeleton />
      <div className="space-y-3">
        <Bone className="h-7 w-40" />
        <Bone className="h-110 w-full sm:h-140" />
        <Bone className="h-4 w-full" />
      </div>
      <div className="space-y-3">
        <Bone className="h-7 w-44" />
        <LiveTableSkeleton />
      </div>
    </main>
  );
}
