// src/app/vehicle/[id]/loading.tsx
// Loading skeleton for a vehicle page, drawn for the day view of a vehicle on
// a run.

import { Bone, ChipBone, TitleBone } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Vehicle page loading skeleton: the back link, the header, the live card, the
 * record strip, then the runs table.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Back link: text-sm */}
      <Bone className="h-5 w-56" />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TitleBone className="w-48" />
          {/* Subtitle: mt-0.5 text-sm */}
          <Bone className="mt-0.5 h-5 w-56" />
        </div>
        <div className="flex gap-2">
          <ChipBone className="w-12" />
          <ChipBone className="w-14" />
          <ChipBone className="w-16" />
        </div>
      </header>

      {/* Live card: eyebrow, route line, status, then a row of facts */}
      <div className="space-y-4 border border-at-border bg-at-surface px-6 py-5">
        <div className="space-y-1">
          <Bone className="h-5 w-40" />
          <Bone className="h-8 w-32" />
          <Bone className="h-5 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Bone key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Bone className="h-7 w-28" />
        <div className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Bone key={i} className="h-13 w-full" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Bone className="h-7 w-24" />
        <div className="border border-at-border bg-at-surface">
          <div className="border-b border-at-border p-3">
            <Bone className="h-4 w-full" />
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="border-b border-at-border p-3 last:border-b-0">
              <Bone className="h-5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
