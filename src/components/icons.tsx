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
