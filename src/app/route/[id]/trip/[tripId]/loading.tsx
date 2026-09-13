// src/app/route/[id]/trip/[tripId]/loading.tsx
// Loading skeleton for the trip timeline page.

import { MapSectionSkeleton } from "@/components/SkeletonParts";
import { Bone } from "@/components/shame/ShameBoardSkeleton";
import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** Stops drawn on the timeline placeholder. */
const STOPS = 9;

/**
 * Trip page loading skeleton: the `text-sm` back link, the headline (a 28px icon
 * beside the `text-3xl` route number at line-height 1, so 30px) over the trip
 * line, the map card, and the stop timeline, whose rows are a rail with a dot
 * beside a `py-3` pair of a 24px name and a `text-xs` time line.
 * @returns Skeleton layout matching the trip detail page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* The inline-flex text-sm link sits on a 21px line box */}
      <div className="flex h-5.25 items-center">
        <Bone className="h-4 w-24" />
      </div>

      <header className="space-y-1">
        <div className="flex h-7.5 items-center gap-3">
          <Bone className="h-7 w-7 shrink-0 rounded-full" />
          <Bone className="h-7.5 w-20" />
        </div>
        <Bone className="h-6 w-52" />
      </header>

      <MapSectionSkeleton mapClass="h-100" />

      <div className="border border-at-border bg-at-surface p-4">
        <ol>
          {Array.from({ length: STOPS }).map((_, i) => (
            <li key={i} className="flex items-stretch gap-3">
              <div className="flex w-3 flex-col items-center">
                <span className={cn("w-px flex-1", i > 0 && "bg-at-border")} />
                <Bone className="h-3 w-3 shrink-0 rounded-full" />
                <span className={cn("w-px flex-1", i < STOPS - 1 && "bg-at-border")} />
              </div>
              <div className="flex flex-1 items-start justify-between gap-3 py-3">
                <div>
                  <div className="flex h-6 items-center">
                    <Bone className="h-4 w-40" />
                  </div>
                  <Bone className="h-4 w-32" />
                </div>
                <Bone className="h-5 w-16 shrink-0" />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
