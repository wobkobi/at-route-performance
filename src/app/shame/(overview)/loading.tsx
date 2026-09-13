// src/app/shame/(overview)/loading.tsx
// Loading skeleton for the shame dashboard.

import {
  CancelledBoardSkeleton,
  FeatureCardSkeleton,
  ShameHeaderSkeleton,
} from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Shame dashboard loading skeleton: the dashboard's ShameHeader (no Day/Week
 * toggle), the three highlight cards, three across from `lg`, and the
 * most-cancelled board, each built from the box-for-box skeleton parts.
 * @returns Skeleton layout matching the shame dashboard structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCardSkeleton withHeadsign narrow />
        <FeatureCardSkeleton />
        <FeatureCardSkeleton />
      </div>
      <CancelledBoardSkeleton />
    </main>
  );
}
