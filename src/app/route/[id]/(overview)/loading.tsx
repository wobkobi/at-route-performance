// src/app/route/[id]/(overview)/loading.tsx
// Loading skeleton for the route detail page.

import {
  Bone,
  ChipBone,
  DayNavSkeleton,
  LineDiagramSkeleton,
  MapSectionSkeleton,
  StatCellsSkeleton,
  TitleBone,
  TripBoardSkeleton,
} from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Route page loading skeleton. It mirrors the day view; the week view shares it
 * because a loading file cannot read `?window` to pick a layout. Most routes run
 * both ways, so the direction chips are drawn, wrapping onto their own lines on
 * a phone the way the long headsign chips do.
 * @returns Skeleton layout matching the route day page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Bone className="h-6 w-6 shrink-0 rounded-full" />
            <TitleBone className="w-14" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <ChipBone className="w-11" />
              <ChipBone className="w-14" />
            </div>
            <DayNavSkeleton />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Bone className="h-4 w-16" />
          <ChipBone className="w-14" />
          <ChipBone className="w-72 max-w-full" />
          <ChipBone className="w-72 max-w-full" />
        </div>
      </header>

      <StatCellsSkeleton />

      {/* The board and map share a row from lg, so both stretch to the map card's height */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TripBoardSkeleton />
        <MapSectionSkeleton mapClass="h-125" />
      </div>

      <LineDiagramSkeleton />

      {/* Collapsed "Stops" details: px-4 py-3 around a 24px summary line */}
      <div className="border border-at-border bg-at-surface px-4 py-3">
        <Bone className="h-6 w-16" />
      </div>
    </main>
  );
}
