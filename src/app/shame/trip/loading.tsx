// src/app/shame/trip/loading.tsx
/**
 * @description Loading skeleton for the shame trip page.
 */
import { Bone, ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Shame trip page loading skeleton.
 * @returns Skeleton layout matching the shame trip page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-9 w-56" />
        <div className="flex flex-wrap items-center gap-3">
          {/* Trips/Routes/Stops tabs */}
          <div className="flex items-center gap-1">
            <Bone className="h-8 w-14 rounded-full" />
            <Bone className="h-8 w-16 rounded-full" />
            <Bone className="h-8 w-14 rounded-full" />
          </div>
          {/* Day/Week toggle (single chip - shows the other view) */}
          <Bone className="h-8 w-14 rounded-full" />
          {/* Stepper */}
          <div className="flex items-center gap-2">
            <Bone className="h-8 w-7 rounded-full" />
            <Bone className="h-5 w-28" />
            <Bone className="h-8 w-7 rounded-full" />
          </div>
        </div>
      </header>

      <ShameBoardSkeleton layout="day" />
    </main>
  );
}
