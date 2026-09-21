// src/app/shame/route/loading.tsx
// Loading skeleton for the shame route page.

import { ShameHeaderSkeleton } from "@/components/SkeletonParts";
import { ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Shame route page loading skeleton: the ShameHeader with its Day/Week toggle
 * and the hourly board. Route rows carry one line of arrivals.
 * @returns Skeleton layout matching the shame route page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton toggle twoLineSubtitle />
      <ShameBoardSkeleton layout="day" />
    </main>
  );
}
