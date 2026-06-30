// src/app/rankings/loading.tsx
/**
 * @description Loading skeleton for the rankings page.
 */
import type { JSX } from "react";

/**
 * Pulse-placeholder skeleton element.
 * @param root0 - Props.
 * @param root0.className - Tailwind size and shape classes.
 * @returns The bone element.
 */
function Bone({ className }: { className: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-at-border ${className}`} />;
}

/**
 * Skeleton for a single rank-board card.
 * @returns The card placeholder.
 */
function RankBoardSkeleton(): JSX.Element {
  return (
    <div className="space-y-2 border border-at-border p-4">
      <Bone className="mb-3 h-6 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Bone key={i} className="h-10" />
      ))}
    </div>
  );
}

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

      {/* Fleet KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20" />
        ))}
      </div>

      {/* Shame heading */}
      <Bone className="h-7 w-48" />

      {/* 2-col shame cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Bone className="h-32" />
        <Bone className="h-32" />
      </div>

      {/* Mode + school filter row */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-8 w-16 rounded-full" />
        ))}
      </div>

      {/* Delay filter */}
      <div className="flex justify-end">
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* 2-col rank boards */}
      <div className="grid gap-4 md:grid-cols-2">
        <RankBoardSkeleton />
        <RankBoardSkeleton />
      </div>

      {/* Explanatory paragraph above the route table */}
      <div className="space-y-1.5">
        <Bone className="h-3.5 w-full max-w-xl" />
        <Bone className="h-3.5 w-full max-w-md" />
      </div>

      {/* Route table */}
      <div className="border border-at-border">
        <Bone className="h-10 rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Bone key={i} className="mt-px h-12 rounded-none" />
        ))}
      </div>
    </main>
  );
}
