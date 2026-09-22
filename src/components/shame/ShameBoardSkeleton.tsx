// src/components/shame/ShameBoardSkeleton.tsx
// Pulse-placeholder skeleton for a shame board list, shared by the
// shame loading pages and the in-page Suspense fallbacks while a board streams.
// Rows mirror the ShameBoard anchors box for box (padding, rules, line heights)
// so the list occupies the same height as the rows it turns into.

import { cn } from "@/lib/cn";
import { ITEMS_PER_COL } from "@/lib/shame-page";
import type { JSX } from "react";

/**
 * Pulse-placeholder skeleton element. Classes merge through `cn`, so a caller's
 * shape (`rounded-full`, `rounded-none`) replaces the default `rounded`.
 * @param root0 - Props.
 * @param root0.className - Tailwind size and shape classes.
 * @returns The bone element.
 */
export function Bone({ className }: { className: string }): JSX.Element {
  return (
    <div
      className={cn("animate-pulse rounded bg-at-border motion-reduce:animate-none", className)}
    />
  );
}

/** How a board's rows are drawn: which glyphs they carry and how their subtitle wraps. */
export interface ShameRowShape {
  /** Whether rows carry a route mode icon (trips and routes; stops have none). */
  icon: boolean;
  /** Subtitle lines in the single-column list (phones and the week list). */
  mobileLines: number;
  /** Subtitle lines in a desktop grid cell. */
  gridLines: number;
}

/** Route rows: a name line over one `text-xs` line of arrivals. */
const ONE_LINE: ShameRowShape = { icon: true, mobileLines: 1, gridLines: 1 };

/**
 * The body of one row: the `text-sm` label (with its 1px nudge), the icon,
 * a 24px name line over `text-xs` subtitle lines, and the delay value.
 * @param root0 - Props.
 * @param root0.shape - The row's glyphs.
 * @param root0.lines - Subtitle lines for this surface.
 * @param root0.labelClass - Width of the leading label ("7am", or "Mon 14/09").
 * @returns The row contents.
 */
function RowBody({
  shape,
  lines,
  labelClass,
}: {
  shape: ShameRowShape;
  lines: number;
  labelClass: string;
}): JSX.Element {
  return (
    <>
      <Bone className={cn("mt-px h-5 shrink-0", labelClass)} />
      {shape.icon && <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />}
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center">
          <Bone className="h-4 w-20" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex h-4 items-center">
            <Bone className={cn("h-3 max-w-full", i === lines - 1 ? "w-32" : "w-52")} />
          </div>
        ))}
      </div>
      <Bone className="mt-px h-5 w-20 shrink-0" />
    </>
  );
}

/**
 * Skeleton for a shame board list. The day layout mirrors the hourly board
 * (single column on mobile, two-column grid on desktop); the week layout is the
 * single-column day-per-row list the week and month boards render.
 * @param root0 - Props.
 * @param root0.layout - Which board shape to mirror.
 * @param root0.shape - The rows' glyphs and subtitle wrapping (a route row by default).
 * @returns The board placeholder.
 */
export function ShameBoardSkeleton({
  layout,
  shape = ONE_LINE,
}: {
  layout: "day" | "week";
  shape?: ShameRowShape;
}): JSX.Element {
  // A day row's label is an hour ("7am"); a week or month row's is a weekday
  // and date ("Mon 14/09"), which is half as wide again.
  const labelClass = layout === "week" ? "w-16" : "w-12";
  /**
   * One single-column row; each carries a top rule, as the real list anchors do.
   * @param i - Row index, for the key.
   * @returns The row placeholder.
   */
  const listRow = (i: number): JSX.Element => (
    <li key={i} className="flex items-start gap-3 border-t border-at-border px-4 py-3">
      <RowBody shape={shape} lines={shape.mobileLines} labelClass={labelClass} />
    </li>
  );
  if (layout === "week") {
    return (
      <div className="border border-at-border bg-at-surface">
        <ul>{Array.from({ length: 7 }).map((_, i) => listRow(i))}</ul>
      </div>
    );
  }
  return (
    <div className="border border-at-border bg-at-surface">
      <ul className="md:hidden">
        {Array.from({ length: 2 * ITEMS_PER_COL }).map((_, i) => listRow(i))}
      </ul>
      {/* Desktop: the same explicit two-column grid the real board places cells in */}
      <ul className="hidden md:grid md:grid-cols-2">
        {Array.from({ length: 2 * ITEMS_PER_COL }).map((_, i) => {
          const isRight = i >= ITEMS_PER_COL;
          const rowIdx = isRight ? i - ITEMS_PER_COL : i;
          return (
            <li
              key={i}
              className={cn(
                rowIdx > 0 && "border-t border-at-border",
                isRight && "border-l border-at-border",
              )}
              style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
            >
              <div className="flex h-full items-start gap-3 px-4 py-3">
                <RowBody shape={shape} lines={shape.gridLines} labelClass={labelClass} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
