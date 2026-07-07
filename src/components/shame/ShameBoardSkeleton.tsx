// src/components/shame/ShameBoardSkeleton.tsx
/**
 * @description Pulse-placeholder skeleton for a shame board list, shared by the
 * shame loading pages and the in-page Suspense fallbacks while a board streams.
 */
import type { JSX } from "react";

/**
 * Pulse-placeholder skeleton element.
 * @param root0 - Props.
 * @param root0.className - Tailwind size and shape classes.
 * @returns The bone element.
 */
export function Bone({ className }: { className: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-at-border ${className}`} />;
}

/**
 * Skeleton for a single shame list row.
 * @param root0 - Props.
 * @param root0.withTopBorder - Whether the row draws a top border.
 * @returns The list item placeholder.
 */
function ListRow({ withTopBorder = true }: { withTopBorder?: boolean }): JSX.Element {
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 ${withTopBorder ? "border-t border-at-border" : ""}`}
    >
      <Bone className="mt-0.5 h-4 w-12 shrink-0" />
      <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Bone className="h-4 w-32" />
        <Bone className="h-3 w-52" />
      </div>
      <Bone className="mt-0.5 h-4 w-20 shrink-0" />
    </li>
  );
}

/**
 * Skeleton for a shame board list. The day layout mirrors the hourly board
 * (single column on mobile, two-column grid on desktop); the week layout is the
 * single-column day-per-row list the week and month boards render.
 * @param root0 - Props.
 * @param root0.layout - Which board shape to mirror.
 * @returns The board placeholder.
 */
export function ShameBoardSkeleton({ layout }: { layout: "day" | "week" }): JSX.Element {
  if (layout === "week") {
    return (
      <div className="border border-at-border bg-at-surface">
        <ul>
          {Array.from({ length: 7 }).map((_, i) => (
            <ListRow key={i} withTopBorder={i > 0} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="border border-at-border bg-at-surface">
      {/* Mobile: single column */}
      <ul className="md:hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <ListRow key={i} />
        ))}
      </ul>
      {/* Desktop: 2-column grid matching the real page layout */}
      <ul className="hidden md:grid md:grid-cols-2">
        {Array.from({ length: 20 }).map((_, i) => {
          const isRight = i >= 10;
          const rowIdx = isRight ? i - 10 : i;
          return (
            <li
              key={i}
              className={[
                "flex items-start gap-3 px-4 py-3",
                rowIdx > 0 ? "border-t border-at-border" : "",
                isRight ? "border-l border-at-border" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
            >
              <Bone className="mt-0.5 h-4 w-12 shrink-0" />
              <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Bone className="h-4 w-32" />
                <Bone className="h-3 w-52" />
              </div>
              <Bone className="mt-0.5 h-4 w-20 shrink-0" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
