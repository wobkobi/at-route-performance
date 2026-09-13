// src/app/route/[id]/(overview)/loading.tsx
// Loading skeleton for the route detail page.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Skeleton for a single stat cell in the stats strip.
 * @returns The stat cell placeholder.
 */
function StatCell(): JSX.Element {
  return (
    <div className="p-4">
      <Bone className="mb-2 h-3 w-20" />
      <Bone className="h-8 w-16" />
    </div>
  );
}

/**
 * Route page loading skeleton. It mirrors the day view; the week view shares it
 * because a loading file cannot read `?window` to pick a layout.
 * @returns Skeleton layout matching the route day page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header: mode icon + route name + view toggle + day nav, then the direction chips */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bone className="h-9 w-9 shrink-0 rounded-full" />
            <div>
              <Bone className="h-9 w-24" />
              <Bone className="mt-0.5 h-4 w-44" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Bone className="h-8 w-12 rounded-full" />
              <Bone className="h-8 w-14 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Bone className="h-8 w-7 rounded-full" />
              <Bone className="h-5 w-28" />
              <Bone className="h-8 w-7 rounded-full" />
            </div>
          </div>
        </div>
        {/* Most routes run both ways, so the direction row is the common case */}
        <div className="flex flex-wrap items-center gap-2">
          <Bone className="h-3 w-16" />
          <Bone className="h-8 w-14 rounded-full" />
          <Bone className="h-8 w-56 max-w-full rounded-full" />
          <Bone className="h-8 w-56 max-w-full rounded-full" />
        </div>
      </header>

      {/* Stats strip */}
      <section className="border border-at-border bg-at-surface">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <StatCell />
          <StatCell />
          <StatCell />
          <StatCell />
        </div>
      </section>

      {/* Worst trips board + map side by side; a ten-row board stands as tall as the h-125 map */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bone className="h-125" />
        <Bone className="h-125" />
      </div>

      {/* Route line diagram */}
      <Bone className="h-64" />

      {/* Collapsible stops summary bar */}
      <Bone className="h-12" />
    </main>
  );
}
