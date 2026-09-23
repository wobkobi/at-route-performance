// src/app/shame/trip/loading.tsx
// Loading skeleton for the shame trip page.

import { ShameHeaderSkeleton } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Shame trip page loading skeleton: the header alone. Which window is
 * opening is in the query, which a loading file is not given, so the board is
 * left to the page's own Suspense fallback rather than drawn here in the wrong
 * shape.
 * @returns Skeleton layout matching the shame trip page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton twoLineSubtitle />
    </main>
  );
}
