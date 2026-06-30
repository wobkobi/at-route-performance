// src/app/shame/stop/loading.tsx
/**
 * @description Loading skeleton for the worst-stop shame page.
 */
import type { JSX } from "react";

/**
 * Pulse-placeholder skeleton element.
 * @param root0 - Props.
 * @param root0.className - Tailwind size and shape classes.
 * @returns The bone element.
 */
function Bone({ className }: { className: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-at-border ${className}`} />;
}

/**
 * Skeleton for a single shame list row.
 * @returns The list item placeholder.
 */
function ListRow(): JSX.Element {
  return (
    <li className="flex items-start gap-3 border-t border-at-border px-4 py-3">
      <Bone className="mt-0.5 h-4 w-12 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Bone className="h-4 w-40" />
        <Bone className="h-3 w-56" />
      </div>
      <Bone className="mt-0.5 h-4 w-20 shrink-0" />
    </li>
  );
}

/**
 * Shame stop page loading skeleton.
 * @returns Skeleton layout matching the shame stop page structure.
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

      {/* List (no mode icon column unlike trips/route shame) */}
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
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-4 w-40" />
                  <Bone className="h-3 w-56" />
                </div>
                <Bone className="mt-0.5 h-4 w-20 shrink-0" />
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
