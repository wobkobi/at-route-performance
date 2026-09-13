// src/app/shame/stop/loading.tsx
// Loading skeleton for the shame stop page.

import { ShameHeaderSkeleton } from "@/components/SkeletonParts";
import { ShameBoardSkeleton } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * Shame stop page loading skeleton: the ShameHeader with its Day/Week toggle and
 * the hourly board. Stop rows have no mode icon, and under the events line they
 * commonly carry "was bad N times today".
 * @returns Skeleton layout matching the shame stop page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton toggle />
      <ShameBoardSkeleton layout="day" shape={{ icon: false, mobileLines: 2, gridLines: 2 }} />
    </main>
  );
}
