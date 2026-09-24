// src/app/routes/loading.tsx
// Loading skeleton for the Routes page.

import {
  Bone,
  ChipBone,
  DayNavSkeleton,
  KpiStripSkeleton,
  TitleBone,
} from "@/components/SkeletonParts";
import type { JSX } from "react";

/** Route cards drawn on the list placeholder. */
const CARDS = 6;

/**
 * Mirrors one RouteExplorer filter row: the uppercase `text-xs` label (16px)
 * beside, or on a phone above, a wrapping run of chips.
 * @param root0 - Props.
 * @param root0.chips - Width classes, one per chip.
 * @returns The row placeholder.
 */
function FilterRowSkeleton({ chips }: { chips: string[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="w-20 shrink-0">
        <Bone className="h-4 w-14" />
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((w, i) => (
          <ChipBone key={i} className={w} />
        ))}
      </div>
    </div>
  );
}

/**
 * Routes page loading skeleton: the title and Day/Week/Month controls, the KPI
 * strip, the filter panel (search box, five chip rows, the sort row) and the
 * first route cards, each built to the real component's padding, gaps and line
 * heights.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TitleBone className="w-32" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-13" />
            <ChipBone className="w-16" />
            <ChipBone className="w-18" />
          </div>
          <DayNavSkeleton />
        </div>
      </header>

      <div className="space-y-6">
        <KpiStripSkeleton />

        <div className="space-y-3 border border-at-border bg-at-surface p-4">
          {/* Search box: py-2 text-sm inside a 1px border, 38px */}
          <Bone className="h-9.5 rounded-none" />
          <FilterRowSkeleton chips={["w-24", "w-36", "w-28"]} />
          <FilterRowSkeleton chips={["w-11", "w-12", "w-15", "w-15"]} />
          <FilterRowSkeleton
            chips={["w-11", "w-19", "w-26", "w-15", "w-15", "w-17", "w-44", "w-36"]}
          />
          <FilterRowSkeleton chips={["w-24", "w-13", "w-15"]} />
          {/* Only: enough data, had cancellations, include school buses, running now */}
          <FilterRowSkeleton chips={["w-40", "w-36", "w-40", "w-28"]} />
          <div className="flex flex-wrap items-center gap-2 border-t border-at-border pt-3">
            {/* Sort label and the select (35px as rendered), then the direction chip */}
            <Bone className="h-4 w-14" />
            <Bone className="h-8.75 w-32 rounded-none" />
            <ChipBone className="w-28" />
            <Bone className="ml-auto h-5 w-20" />
          </div>
        </div>

        <div className="space-y-2">
          {Array.from({ length: CARDS }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 border border-at-border bg-at-surface p-4 md:flex-row md:items-center md:gap-6"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Bone className="mt-0.5 h-6 w-6 shrink-0 rounded-full" />
                <div className="min-w-0">
                  {/* Route number: text-lg leading-tight, 22.5px, laid out at 23 */}
                  <Bone className="h-5.75 w-14" />
                  {/* Area tags: mt-1, text-xs with py-0.5, 20px */}
                  <div className="mt-1 flex gap-1">
                    <Bone className="h-5 w-16 rounded-full" />
                    <Bone className="h-5 w-12 rounded-full" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 md:w-md md:shrink-0">
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j}>
                    <Bone className="h-4 w-16" />
                    <Bone className="h-5 w-14" />
                  </div>
                ))}
              </div>
              {/* More details: at-btn py-2 text-sm inside a 1px border, 38px */}
              <Bone className="h-9.5 shrink-0 rounded-full md:w-34" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
