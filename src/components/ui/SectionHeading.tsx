import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** Props for {@link SectionHeading}. */
export interface SectionHeadingProps {
  /** The heading level: `h2` under the page title, `h3` under a band's own `h2`. */
  as?: "h2" | "h3";
  /** Anchor id, for a heading a link or `aria-labelledby` points at. */
  id?: string;
  /** Extra classes: spacing, or a colour that replaces the ink. */
  className?: string;
  children: ReactNode;
}

/**
 * The heading over a board, map or table: one size and weight everywhere, so a
 * reader can tell a section from a band (`SectionLink`) or the page title.
 * @param props - Component props.
 * @param props.as - The heading level.
 * @param props.id - Anchor id.
 * @param props.className - Extra classes.
 * @param props.children - The heading text.
 * @returns The heading.
 */
export function SectionHeading({
  as: Tag = "h2",
  id,
  className,
  children,
}: SectionHeadingProps): JSX.Element {
  return (
    <Tag id={id} className={cn("text-lg font-ultra tracking-zero text-at-ink", className)}>
      {children}
    </Tag>
  );
}
