// src/app/days/loading.tsx
// Loading skeleton for the Day by day page, drawn for the week, its default.

import { DaysBodySkeleton, DaysHeaderSkeleton } from "@/components/DaysSkeleton";
import type { JSX } from "react";

/**
 * Day by day loading skeleton, shown while the header's two lookups resolve.
 * @returns Skeleton markup.
 */
export default function Loading(): JSX.Element {
  return (
    <main className="space-y-4">
      <DaysHeaderSkeleton />
      <DaysBodySkeleton window="week" />
    </main>
  );
}
