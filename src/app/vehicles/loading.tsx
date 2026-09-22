// src/app/vehicles/loading.tsx
// Loading skeleton for the hardest-worked vehicles page, drawn for the day view.

import { ChipBone, TitleBone } from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Vehicles page loading skeleton: the header, the filter and rank-by chips,
 * then the table's header row and a page of rows.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TitleBone className="w-80" />
          {/* Subtitle: mt-0.5 text-sm */}
          <Bone className="mt-0.5 h-5 w-64" />
        </div>
        <div className="flex gap-2">
          <ChipBone className="w-12" />
          <ChipBone className="w-14" />
          <ChipBone className="w-16" />
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <ChipBone className="w-11" />
        <ChipBone className="w-14" />
        <ChipBone className="w-16" />
        <ChipBone className="w-16" />
        <ChipBone className="w-28" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-4 w-14" />
        <ChipBone className="w-32" />
        <ChipBone className="w-14" />
        <ChipBone className="w-20" />
        <ChipBone className="w-36" />
      </div>

      <div className="border border-at-border bg-at-surface">
        {/* Header row: text-xs over p-3 */}
        <div className="border-b border-at-border p-3">
          <Bone className="h-4 w-full" />
        </div>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="border-b border-at-border p-3 last:border-b-0">
            <Bone className="h-5 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
