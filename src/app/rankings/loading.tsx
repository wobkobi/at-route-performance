// src/app/rankings/loading.tsx
// Loading skeleton for the rankings page.

import { RankingsBodySkeleton } from "@/components/RankingsBodySkeleton";
import { ChipBone, IconChipBone, TitleBone } from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Rankings page loading skeleton. The header mirrors WindowControls on the
 * rolling week: the Week/Month chips and the previous-period chip beside the
 * `px-1 text-sm` period label.
 * @returns Skeleton layout matching the rankings page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TitleBone className="w-40" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-15" />
            <ChipBone className="w-17" />
          </div>
          <div className="flex items-center gap-1">
            <IconChipBone />
            <div className="px-1">
              <Bone className="h-5 w-20" />
            </div>
          </div>
        </div>
      </header>

      <RankingsBodySkeleton />
    </main>
  );
}
