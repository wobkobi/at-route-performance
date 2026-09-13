// src/app/shame/loading.tsx
// Loading skeleton for the shame dashboard.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Shame dashboard loading skeleton. Mirrors the dashboard's `ShameHeader`
 * (title + subtitle, Trips/Routes/Stops tabs, day stepper, no week toggle),
 * the three-card grid and the cancelled-routes board so there is no layout
 * shift.
 * @returns Skeleton layout matching the shame dashboard structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header: title + subtitle, tabs, day stepper (no week toggle) */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Bone className="h-9 w-56" />
          <Bone className="mt-0.5 h-4 w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Trips/Routes/Stops tabs */}
          <div className="flex items-center gap-1">
            <Bone className="h-8 w-14 rounded-full" />
            <Bone className="h-8 w-16 rounded-full" />
            <Bone className="h-8 w-14 rounded-full" />
          </div>
          {/* Day stepper */}
          <div className="flex items-center gap-2">
            <Bone className="h-8 w-7 rounded-full" />
            <Bone className="h-5 w-28" />
            <Bone className="h-8 w-7 rounded-full" />
          </div>
        </div>
      </header>

      {/* Worst trip / route / stop cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Bone className="h-48" />
        <Bone className="h-48" />
        <Bone className="h-48" />
      </div>

      {/* Most cancelled board: header bar + five rows */}
      <div className="border border-at-border bg-at-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-at-border px-4 py-3">
          <Bone className="h-5 w-32" />
          <Bone className="h-4 w-20" />
        </div>
        <ul>
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className={i > 0 ? "border-t border-at-border px-4 py-3" : "px-4 py-3"}>
              <Bone className="h-4 w-40" />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
