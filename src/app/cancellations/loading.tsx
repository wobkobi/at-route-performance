// src/app/cancellations/loading.tsx
// Loading skeleton for the Cancellations page.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import {
  CancelledBoardSkeleton,
  ChipBone,
  DayNavSkeleton,
  KpiStripSkeleton,
  TitleBone,
} from "@/components/SkeletonParts";
import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** Trip rows drawn on the list placeholder. */
const TRIPS = 12;

/**
 * Cancellations page loading skeleton on the day view: the title and window
 * controls, the mode and school-bus chips, the KPI strip (laid out as the fleet
 * strip), then the Most cancelled board over its Routes link beside the trip
 * list, whose rows are a `py-2.5 text-sm` line split by rules.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TitleBone className="w-56" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-13" />
            <ChipBone className="w-16" />
            <ChipBone className="w-18" />
          </div>
          <DayNavSkeleton />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <ChipBone className="w-11" />
          <ChipBone className="w-12" />
          <ChipBone className="w-15" />
        </div>
        <ChipBone className="w-27" />
      </div>

      <KpiStripSkeleton />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <CancelledBoardSkeleton rows={15} />
          {/* The Routes link: one text-sm line */}
          <Bone className="h-5 w-56" />
        </div>
        <div className="min-w-0 border border-at-border bg-at-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Bone className="h-6 w-32" />
            <div className="flex flex-wrap gap-1">
              <ChipBone className="w-15" />
              <ChipBone className="w-26" />
              <ChipBone className="w-24" />
              <ChipBone className="w-26" />
            </div>
          </div>
          <div>
            {Array.from({ length: TRIPS }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "-mx-4 flex items-center gap-3 px-4 py-2.5",
                  i > 0 && "border-t border-at-border",
                )}
              >
                <div className="flex h-5 w-16 shrink-0 items-center">
                  <Bone className="h-4 w-14" />
                </div>
                <Bone className="h-5 w-5 shrink-0 rounded-full" />
                <div className="flex h-5 min-w-0 flex-1 items-center">
                  <Bone className="h-4 w-48 max-w-full" />
                </div>
                <Bone className="h-5 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
