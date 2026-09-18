"use client";
// src/components/StepPending.tsx
// Pending hint for a stepper chevron whose destination is still on its way.

import { useLinkStatus } from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * Wrap a stepper link's chevron so it pulses while the click waits on the
 * server. A step onto a prefetched day or period is instant and never shows
 * it. What it covers is a click that lands before the destination's prefetch
 * has finished: a second step in quick succession, or a day that was cold on
 * the server. The old page stays on screen, URL included, until the new one is
 * ready, so without this a slow step reads as a click that did nothing. The
 * pulse starts after a short delay (the `step-pending` class), so a step that
 * resolves quickly never flashes it. Must sit inside the `<Link>` it reports on.
 * @param props - Component props.
 * @param props.children - The chevron glyph.
 * @returns The glyph, pulsing while its link's navigation is pending.
 */
export function StepPending({ children }: { children: ReactNode }): JSX.Element {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className={pending ? "step-pending inline-flex" : "inline-flex"}>
      {children}
    </span>
  );
}
