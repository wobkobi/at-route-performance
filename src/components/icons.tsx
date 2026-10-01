// src/components/icons.tsx
// Inline SVG icon components that inherit text colour via currentColor.

import { cn } from "@/lib/cn";
import type { JSX } from "react";

/** Props shared by the inline icon components. */
export interface IconProps {
  /** Extra classes; size defaults to `h-4 w-4` and can be overridden. */
  className?: string;
}

/**
 * Right-pointing chevron (uses `currentColor`, so it inherits text colour).
 * @param props - Component props.
 * @param props.className - Extra classes; overrides the default `h-4 w-4` size.
 * @returns The chevron SVG.
 */
export function ChevronRight({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={cn("h-4 w-4", className)}>
      <path d="M7.5 4.5 13 10l-5.5 5.5-1.06-1.06L10.88 10 6.44 5.56 7.5 4.5Z" />
    </svg>
  );
}

/**
 * Left-pointing chevron - the {@link ChevronRight} glyph mirrored horizontally.
 * @param props - Component props.
 * @param props.className - Extra classes; overrides the default `h-4 w-4` size.
 * @returns The chevron SVG.
 */
export function ChevronLeft({ className }: IconProps): JSX.Element {
  return <ChevronRight className={cn("-scale-x-100", className)} />;
}

/**
 * A location arrow, for "zoom to where I am" (uses `currentColor`).
 * @param props - Component props.
 * @param props.className - Extra classes; overrides the default `h-4 w-4` size.
 * @returns The arrow SVG.
 */
export function LocateArrow({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={cn("h-4 w-4", className)}>
      <path d="M17.6 2.4a.75.75 0 0 1 .17.8l-5.5 14a.75.75 0 0 1-1.41-.06L9.2 10.8 2.86 9.14a.75.75 0 0 1-.06-1.41l14-5.5a.75.75 0 0 1 .8.17Z" />
    </svg>
  );
}

/**
 * Down-pointing chevron, for a menu or disclosure that opens below (uses
 * `currentColor`). Rotate it for an open state.
 * @param props - Component props.
 * @param props.className - Extra classes; overrides the default `h-4 w-4` size.
 * @returns The chevron SVG.
 */
export function ChevronDown({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={cn("h-4 w-4", className)}>
      <path d="M5.5 7.5 10 12l4.5-4.5 1.06 1.06L10 14.12 4.44 8.56 5.5 7.5Z" />
    </svg>
  );
}

/**
 * A small triangle for a sorted list or column: down for high to low, up for low
 * to high. A faint down one marks a column that can be sorted but is not, so the
 * headings read as pressable; it is left off phones, where its width pushes a
 * narrow table's last column out of view. Always beside text that names the
 * order, so it is hidden from assistive tech.
 * @param props - Component props.
 * @param props.dir - The order, or null for a sortable column that is not the sorted one.
 * @param props.className - Extra classes.
 * @returns The arrow SVG.
 */
export function SortArrow({
  dir,
  className,
}: {
  dir: "asc" | "desc" | null;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden
      className={cn(
        "h-2 w-2 shrink-0",
        dir === null && "hidden opacity-30 sm:block",
        dir === "asc" && "rotate-180",
        className,
      )}
    >
      <path d="M1 3h8L5 8z" />
    </svg>
  );
}
