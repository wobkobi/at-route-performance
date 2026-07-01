// src/app/shame/loading.tsx
/**
 * @description Loading skeleton for the shame dashboard.
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
 * Shame dashboard loading skeleton. Mirrors the dashboard's `ShameHeader`
 * (title + subtitle, Trips/Routes/Stops tabs, day stepper, no week toggle)
 * and the three-card grid so there is no layout shift.
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
    </main>
  );
}
