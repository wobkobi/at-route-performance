"use client";

import { cn } from "@/lib/cn";
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from "react";

/** Props for {@link Hint}. */
export interface HintProps {
  /** The explanation, a sentence or two. */
  hint: string;
  /** The text the explanation is about. */
  children: ReactNode;
  /** Classes for the wrapper: `relative z-10` lifts it over a row's stretched link. */
  className?: string;
  /** Classes for the trigger text. */
  triggerClassName?: string;
  /**
   * Which edge of the trigger the tooltip lines up with: `end` for text in a
   * right-hand column, `start` for a left-hand one, so it never runs off a phone.
   */
  align?: "start" | "centre" | "end";
}

const ALIGN_CLASS = {
  start: "left-0",
  centre: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

/**
 * Text with an explanation a reader can reach on any device: shown on hover, on
 * keyboard focus and on tap, and tied to the text with `aria-describedby` so a
 * screen reader reads it too. A bare `title` does none of that on a phone.
 *
 * The trigger is a real button, so a Hint must never sit inside a link; for
 * text inside a whole-row link, explain it in a key under the list instead.
 * Taps open rather than toggle: on desktop a click lands after the focus that
 * already opened it, so a toggle would shut it straight away.
 * @param props - Component props.
 * @param props.hint - The explanation.
 * @param props.children - The text it explains.
 * @param props.className - Wrapper classes.
 * @param props.triggerClassName - Trigger classes.
 * @param props.align - Edge the tooltip lines up with.
 * @returns The text and its tooltip.
 */
export function Hint({
  hint,
  children,
  className,
  triggerClassName,
  align = "centre",
}: HintProps): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // iOS Safari does not focus a tapped button, so blur never fires there; a tap
  // anywhere else closes it instead.
  useEffect(() => {
    if (!open) return;
    /**
     * Close on a press outside the hint.
     * @param e - The pointer event.
     */
    const onPointerDown = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span ref={wrapRef} className={cn("group/hint relative inline-block", className)}>
      <button
        type="button"
        aria-describedby={id}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          "hit-44 cursor-help underline decoration-at-border decoration-dotted underline-offset-4",
          triggerClassName,
        )}
      >
        {children}
      </button>
      {/* Hidden with `display: none`, not `opacity-0`: an invisible box still
          counts towards the page's scrollable width. `w-max` before the bound,
          or the absolutely placed box shrink-wraps to the trigger and wraps one
          word per line. */}
      <span
        id={id}
        role="tooltip"
        className={cn(
          ALIGN_CLASS[align],
          "pointer-events-none absolute bottom-full z-20 mb-1.5 hidden w-max max-w-56 bg-at-ink px-2 py-1 text-center text-xs font-medium tracking-zero text-white normal-case shadow-md group-hover/hint:block",
          open && "block",
        )}
      >
        {hint}
      </span>
    </span>
  );
}
