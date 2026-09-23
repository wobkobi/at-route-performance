// src/components/Chip.tsx
// The two chip contracts every filter, sort and pager row on the site is built
// from: a link that narrows or reorders what is on screen, and a button that
// toggles client state. Both existed as a dozen hand-rolled copies, and each copy
// was a chance to leave out one of the three things a chip needs - the `chip`
// classes, `scroll={false}` and `aria-current`/`aria-pressed`. Copies had left out
// all three at various times.
//
// A tab for a view the reader is *on* is a third contract and deliberately not
// here: SiteNav, ShameHeader, RangeControls and the route page's Day/Week toggle
// render the active one as a plain `<span aria-current="page">` rather than a
// link, so clicking where you already are cannot rebuild the page and drop the
// board sort with it.

import { cn } from "@/lib/cn";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * A chip that links: one option of a filter, sort or pager row.
 *
 * `scroll={false}` is the default because every one of these narrows or reorders
 * something the reader is already looking at, and jumping to the top of the page
 * loses their place. Pass `scroll` only for a link that genuinely moves elsewhere.
 * @param root0 - Props.
 * @param root0.href - Where the chip goes.
 * @param root0.active - Whether this is the chosen option.
 * @param root0.current - The `aria-current` token when active: `"true"` for one
 *   option of a set, `"page"` for a page number in a pager.
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
  current = "true",
  activeClass = "chip-on",
  className,
  prefetch,
  scroll = false,
  ariaLabel,
  children,
}: {
  href: string;
  active?: boolean;
  current?: "true" | "page";
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
      aria-current={active ? current : undefined}
      aria-label={ariaLabel}
      className={cn("chip", active ? activeClass : "chip-off", className)}
    >
      {children}
    </Link>
  );
}

/**
 * A chip that toggles client state, for a control whose choice lives in the
 * component rather than in the URL. `aria-pressed` rather than `aria-current`,
 * because nothing is being navigated to.
 * @param root0 - Props.
 * @param root0.on - Whether the chip is active.
 * @param root0.onClick - Toggle handler.
 * @param root0.activeClass - Classes for the active state.
 * @param root0.className - Extra classes.
 * @param root0.children - The label.
 * @returns The chip button.
 */
export function ChipToggle({
  on,
  onClick,
  activeClass = "chip-on",
  className,
  children,
}: {
  on: boolean;
  onClick: () => void;
  activeClass?: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("chip", on ? activeClass : "chip-off", className)}
    >
      {children}
    </button>
  );
}
