// src/components/Chip.tsx
// The two chip contracts every filter and sort row on the site is built
// from: a link that narrows or reorders what is on screen, and a button that
// toggles client state. Both existed as a dozen hand-rolled copies, and each copy
// was a chance to leave out one of the three things a chip needs - the `chip`
// classes, `scroll={false}` and `aria-current`/`aria-pressed`. Copies had left out
// all three at various times.
//
// A tab for a view the reader is *on* is a third contract, ChipTab: the active
// one renders as a plain `<span aria-current="page">` rather than a link, so
// clicking where you already are cannot rebuild the page and drop the board
// sort with it. StepperLink is the fourth, the chevron either side of a date.

import { StepPending } from "@/components/date/StepPending";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useId, type JSX, type ReactNode } from "react";

/**
 * A chip that links: one option of a filter or sort row.
 *
 * `scroll={false}` is the default because every one of these narrows or reorders
 * something the reader is already looking at, and jumping to the top of the page
 * loses their place. Pass `scroll` only for a link that genuinely moves elsewhere.
 * @param root0 - Props.
 * @param root0.href - Where the chip goes.
 * @param root0.active - Whether this is the chosen option.
 * @param root0.activeClass - Classes for the active state, for a row that colours
 *   its options (late red, early amber) rather than using the chip's own fill.
 * @param root0.className - Extra classes, usually a text size or `tabular-nums`.
 * @param root0.prefetch - Passed through to the link.
 * @param root0.scroll - Passed through to the link.
 * @param root0.ariaLabel - An accessible name, for a chip holding only an icon.
 * @param root0.children - The label.
 * @returns The chip link.
 */
export function ChipLink({
  href,
  active = false,
  activeClass = "chip-on",
  className,
  prefetch,
  scroll = false,
  ariaLabel,
  children,
}: {
  href: string;
  active?: boolean;
  activeClass?: string;
  className?: string;
  prefetch?: boolean;
  scroll?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      scroll={scroll}
      aria-current={active ? "true" : undefined}
      aria-label={ariaLabel}
      className={cn("chip", active ? activeClass : "chip-off", className)}
    >
      {children}
    </Link>
  );
}

/**
 * A chip that toggles client state, for a control whose choice lives in the
 * component rather than in the URL. `aria-pressed` by default, for a chip that
 * switches something on or off; a row that picks one of several marks its pick
 * with `aria-current` instead, as the URL chips do.
 * @param root0 - Props.
 * @param root0.on - Whether the chip is active.
 * @param root0.onClick - Toggle handler.
 * @param root0.activeClass - Classes for the active state.
 * @param root0.offClass - Classes for the inactive state, for a row whose off
 *   chips say more than "not chosen" (the live map's struck-through layers).
 * @param root0.disabled - Whether the chip can be pressed.
 * @param root0.single - One choice of several (pressing it again changes nothing),
 *   so the chosen one is current rather than pressed.
 * @param root0.className - Extra classes.
 * @param root0.children - The label.
 * @returns The chip button.
 */
export function ChipToggle({
  on,
  onClick,
  activeClass = "chip-on",
  offClass = "chip-off",
  disabled,
  single,
  className,
  children,
}: {
  on: boolean;
  onClick: () => void;
  activeClass?: string;
  offClass?: string;
  disabled?: boolean;
  single?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={single ? undefined : on}
      aria-current={single && on ? "true" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn("chip", on ? activeClass : offClass, className)}
    >
      {children}
    </button>
  );
}

/**
 * A tab that switches the view: the board, the window. The active tab is a
 * span, not a link, because its href would reset the view's own params and move
 * the reader off what they were reading.
 * @param root0 - Props.
 * @param root0.href - The tab's view.
 * @param root0.active - Whether the reader is on this view.
 * @param root0.children - The label.
 * @returns The tab.
 */
export function ChipTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}): JSX.Element {
  if (active) {
    return (
      <span aria-current="page" className="chip chip-on">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} className="chip chip-off">
      {children}
    </Link>
  );
}

/**
 * The chevron either side of a date that steps to the previous or next day,
 * week or month. With no step to take, a `.step-slot` holds its 44px so the
 * date and the tabs beside it do not slide when the reader reaches either end.
 * Both directions prefetch in full by default: the stepper is how the archive
 * is read, so the next click is nearly always one of these. A caller whose
 * neighbour is costly to render passes `prefetch={null}` (Next's default, the
 * shell only) and flips it to full on `onIntent`. The chevron pulses while the
 * click waits on the server.
 * @param root0 - Props.
 * @param root0.href - The neighbouring period, or null when there is none.
 * @param root0.dir - Which way it steps.
 * @param root0.label - Accessible name, such as "Previous day".
 * @param root0.fallback - What stands in with no step, when not the empty slot.
 * @param root0.prefetch - The link's prefetch: full (`true`) unless given.
 * @param root0.onIntent - Called when the reader points at, focuses or presses the link.
 * @returns The link or its placeholder.
 */
export function StepperLink({
  href,
  dir,
  label,
  fallback,
  prefetch = true,
  onIntent,
}: {
  href: string | null | undefined;
  dir: "prev" | "next";
  label: string;
  fallback?: ReactNode;
  prefetch?: boolean | null;
  onIntent?: () => void;
}): JSX.Element {
  if (!href) return <>{fallback ?? <span className="step-slot" aria-hidden />}</>;
  const Chevron = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      prefetch={prefetch}
      scroll={false}
      className="chip chip-icon chip-off"
      aria-label={label}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
    >
      <StepPending>
        <Chevron />
      </StepPending>
    </Link>
  );
}

/**
 * A row of chips that pick one thing, named for assistive tech as a group. With
 * `showLabel` the name also leads the row as an eyebrow.
 * @param root0 - Props.
 * @param root0.label - What the chips pick, such as "Direction".
 * @param root0.showLabel - Show the label at the head of the row.
 * @param root0.className - Extra classes, usually the gap.
 * @param root0.children - The chips.
 * @returns The group.
 */
export function ChipGroup({
  label,
  showLabel = false,
  className,
  children,
}: {
  label: string;
  showLabel?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <div
      role="group"
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? id : undefined}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {showLabel && (
        <span id={id} className="at-eyebrow text-at-muted">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
