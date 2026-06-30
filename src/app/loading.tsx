// src/app/loading.tsx
/**
 * @description Loading skeleton for the home page.
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
 * Home page loading skeleton - shown by Next.js during navigation while the
 * async page.tsx resolves. Mirrors the page layout so there is no layout shift.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-9 w-56" />
        <Bone className="h-8 w-36" />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20" />
        ))}
      </div>

      {/* Shame section heading */}
      <Bone className="h-7 w-48" />

      {/* 2-col shame card grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Bone className="h-32" />
        <Bone className="h-32" />
      </div>

      {/* Filter row: mode chips (All + up to 3) + school-bus toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-8 w-16 rounded-full" />
        ))}
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* Delay filter (right-aligned) */}
      <div className="flex justify-end">
        <Bone className="h-8 w-24 rounded-full" />
      </div>

      {/* Board grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 border border-at-border p-4">
          <Bone className="mb-3 h-6 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Bone key={i} className="h-10" />
          ))}
        </div>
        <div className="space-y-2 border border-at-border p-4">
          <Bone className="mb-3 h-6 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Bone key={i} className="h-10" />
          ))}
        </div>
      </div>

      {/* Collapsed "All routes" summary bar */}
      <div className="border border-at-border bg-at-surface px-4 py-3">
        <Bone className="h-5 w-24" />
      </div>
    </main>
  );
}
