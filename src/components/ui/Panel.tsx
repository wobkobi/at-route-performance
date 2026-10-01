import { cn } from "@/lib/cn";
import type { ElementType, HTMLAttributes, JSX, ReactNode } from "react";

/** A panel's inner padding: `sm` for boards and maps, `lg` for figure strips and notes. */
export type PanelPad = "sm" | "lg";

const PAD_CLASS: Record<PanelPad, string> = { sm: "p-4", lg: "px-6 py-5" };

/** Props for {@link Panel}. */
export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** The element to render; a `section` by default. */
  as?: "section" | "div" | "p" | "dl" | "ol" | "ul" | "li" | "form";
  /** Inner padding; omit for a panel whose rows run to its edges. */
  pad?: PanelPad;
  children?: ReactNode;
}

/**
 * The site's one box: a hairline border on white, square, flat. Every board,
 * map, figure strip and note sits in one, so a panel never differs by more than
 * its padding.
 * @param props - Component props, passed through to the element.
 * @param props.as - The element to render.
 * @param props.pad - Inner padding.
 * @param props.className - Extra classes.
 * @param props.children - The panel's content.
 * @returns The panel.
 */
export function Panel({
  as = "section",
  pad,
  className,
  children,
  ...rest
}: PanelProps): JSX.Element {
  const Tag: ElementType = as;
  return (
    <Tag {...rest} className={cn("at-card", pad && PAD_CLASS[pad], className)}>
      {children}
    </Tag>
  );
}
