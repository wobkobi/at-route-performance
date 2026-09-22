// src/components/DaysSkeleton.tsx
// Placeholders for the Day by day page, mirroring DayChart and the day table
// box for box so neither jumps when the days arrive.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import { ChipBone, IconChipBone, TitleBone } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Mirrors the page header and filter row: the title, the Week and Month chips
 * with the period stepper, then the four mode chips, the school toggle and the
 * overview link.
 * @returns The header placeholder.
 */
export function DaysHeaderSkeleton(): JSX.Element {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <TitleBone className="w-48" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-16" />
            <ChipBone className="w-18" />
          </div>
          <div className="flex items-center gap-1">
            <IconChipBone />
            <div className="px-1">
              <Bone className="h-5 w-24" />
            </div>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <ChipBone className="w-11" />
          <ChipBone className="w-12" />
          <ChipBone className="w-15" />
          <ChipBone className="w-15" />
        </div>
        <ChipBone className="w-27" />
        <Bone className="ml-auto h-5 w-36" />
      </div>
    </>
  );
}

/**
 * Mirrors the chart, its caption and the table. The chart's plot is `h-48`,
 * `sm:h-64`, under it the labels: two tight `text-xs` lines (16.25px each) on a
 * week, one on a month. Table rows are `p-3 text-sm` plus a 1px rule.
 * @param root0 - Props.
 * @param root0.window - The window, which sets the label height and row count.
 * @returns The body placeholder.
 */
export function DaysBodySkeleton({ window }: { window: "week" | "month" }): JSX.Element {
  const rows = window === "week" ? 7 : 12;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="border border-at-border bg-at-surface p-3 sm:p-4">
          <Bone className="h-48 sm:h-64" />
          <div className={window === "week" ? "mt-1 h-[32.5px]" : "mt-1 h-[16.25px]"} />
        </div>
        {/* The caption: four text-xs lines on a phone, two at sm, one from lg. */}
        <Bone className="h-16 sm:h-8 lg:h-4" />
      </div>
      <div className="border border-at-border bg-at-surface">
        <div className="border-b border-at-border p-3">
          <Bone className="h-4 w-full" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="border-b border-at-border p-3 last:border-b-0">
            <Bone className="h-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
