// src/app/stop/[id]/loading.tsx
/**
 * @description Loading skeleton for the stop detail page.
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
 * Stop page loading skeleton.
 * @returns Skeleton layout matching the stop page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header: "STOP" label + name + stepper */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Bone className="mb-1 h-3 w-8" />
          <Bone className="h-9 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Bone className="h-8 w-7 rounded-full" />
          <Bone className="h-5 w-28" />
          <Bone className="h-8 w-7 rounded-full" />
        </div>
      </header>

      {/* Stats strip */}
      <section className="border border-at-border bg-at-surface">
        <div className="grid grid-cols-2 divide-x divide-y divide-at-border sm:grid-cols-4">
          <StatCell />
          <StatCell />
          <StatCell />
          <StatCell />
        </div>
      </section>

      {/* Map */}
      <section className="border border-at-border bg-at-surface p-4">
        <Bone className="mb-3 h-6 w-28" />
        <Bone className="h-100" />
      </section>

      {/* Worst routes rank board */}
      <div className="space-y-2 border border-at-border p-4">
        <Bone className="mb-3 h-6 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone key={i} className="h-10" />
        ))}
      </div>

      {/* Schedule (StopSchedule: heading + table, not a bordered card) */}
      <section className="flex flex-col gap-3">
        <Bone className="h-4 w-32" />
        <div className="space-y-2">
          <Bone className="h-5 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Bone key={i} className="h-6 w-full" />
          ))}
        </div>
      </section>
    </main>
  );
}
