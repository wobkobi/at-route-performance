// src/components/LiveSkeleton.tsx
// Placeholders for the live page's two feed-bound parts. Each must match the
// real figure strip and table box for box, or the page jumps when the feed lands.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import type { JSX } from "react";

/**
 * The figure strip: five cells, each label, value (text-2xl) and note line.
 * @returns Skeleton markup.
 */
export function LiveFiguresSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 border border-at-border bg-at-surface px-6 py-5 sm:grid-cols-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-1">
          <Bone className="h-4 w-20" />
          <Bone className="h-8 w-16" />
          <Bone className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * The routes table: a header row and the 30 route rows it opens with.
 * @returns Skeleton markup.
 */
export function LiveTableSkeleton(): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface">
      <div className="border-b border-at-border p-3">
        <Bone className="h-4 w-full" />
      </div>
      {Array.from({ length: 30 }, (_, i) => (
        <div key={i} className="border-b border-at-border p-3 last:border-b-0">
          <Bone className="h-5 w-full" />
        </div>
      ))}
    </div>
  );
}
