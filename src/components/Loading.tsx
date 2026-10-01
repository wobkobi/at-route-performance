// src/components/Loading.tsx
// The site's one loading state. Every page and every streamed block waits behind
// the same wheel, so a reader learns one signal rather than a different
// box-for-box placeholder per page.

import { cn } from "@/lib/cn";
import type { JSX } from "react";

/**
 * The wheel: a ring with one coloured quarter, turning. Decorative on its own -
 * the block around it carries the announcement - so it is hidden from assistive
 * technology.
 * @param props - Component props.
 * @param props.className - Size and spacing classes.
 * @returns The wheel element.
 */
export function Spinner({ className }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-6 animate-spin rounded-full border-2 border-at-border border-t-at-shore motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * A block that is still loading: the wheel, centred, holding enough height that
 * the page does not read as finished and empty.
 *
 * A stopped wheel says nothing at all, so where motion is turned off the label
 * beside it stops being screen-reader-only and carries the state in words.
 * @param props - Component props.
 * @param props.className - Padding or height classes for the space being held.
 * @param props.label - What is loading, announced and shown without motion.
 * @returns The block.
 */
export function LoadingBlock({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}): JSX.Element {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-3 py-16", className)}>
      <Spinner className="size-8" />
      <span className="sr-only text-sm text-at-muted motion-reduce:not-sr-only">{label}</span>
    </div>
  );
}

/**
 * A line of text still loading, for a fallback that holds one line of a page's
 * furniture (the footer's freshness note) where a wheel would be out of scale.
 * @param props - Component props.
 * @param props.className - Text colour, for a dark band.
 * @param props.label - What to say while it loads.
 * @returns The line.
 */
export function LoadingLine({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}): JSX.Element {
  return (
    <p role="status" className={cn("text-xs text-at-muted", className)}>
      {label}
    </p>
  );
}

/**
 * A whole page still loading, for a route's `loading.tsx`. Taller than an
 * in-page block because it stands for everything below the masthead.
 * @returns The page-level loading state.
 */
export function PageLoading(): JSX.Element {
  return (
    <main>
      <LoadingBlock className="py-32" />
    </main>
  );
}
