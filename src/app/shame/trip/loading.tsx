// src/app/shame/trip/loading.tsx
// Loading skeleton for the shame trip page.

import { ShameHeaderSkeleton } from "@/components/SkeletonParts";
import { ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Shame trip page loading skeleton: the ShameHeader with its Day/Week toggle and
 * the hourly board. Trip rows carry the headsign, start time and stop count,
 * which wrap to two lines in a desktop cell and four on a phone.
 * @returns Skeleton layout matching the shame trip page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton toggle twoLineSubtitle filters />
      <ShameBoardSkeleton layout="day" shape={{ icon: true, mobileLines: 4, gridLines: 2 }} />
    </main>
  );
}
