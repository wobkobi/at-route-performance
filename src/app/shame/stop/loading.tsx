// src/app/shame/stop/loading.tsx
// Loading skeleton for the shame stop page.

import { ShameHeaderSkeleton } from "@/components/SkeletonParts";
import type { JSX } from "react";

/**
 * Shame stop page loading skeleton: the header alone. Which window is
 * opening is in the query, which a loading file is not given, so the board is
 * left to the page's own Suspense fallback rather than drawn here in the wrong
 * shape.
 * @returns Skeleton layout matching the shame stop page structure.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-6">
      <ShameHeaderSkeleton twoLineSubtitle />
    </main>
  );
}
