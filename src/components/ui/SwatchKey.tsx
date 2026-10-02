import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** One entry in a {@link SwatchKey}. */
export interface SwatchKeyItem {
  /** React key; the label when omitted, so pass one when the label is not plain text. */
  key?: string;
  /** A small copy of the mark the entry explains. */
  swatch: ReactNode;
  /** What the mark means. */
  label: ReactNode;
}

/** Props for {@link SwatchKey}. */
export interface SwatchKeyProps {
  /** The marks to explain; pass only those on screen, so the key never describes a missing one. */
  items: SwatchKeyItem[];
  /** `row` wraps short entries side by side; `list` stacks long ones, swatch top-aligned. */
  layout?: "row" | "list";
  /** Extra classes, usually the gap above. */
  className?: string;
}

/**
 * The key under a board, map or strip: each mark beside a few words on what it
 * means, as a description list so a screen reader pairs them. Swatches are
 * decorative copies of marks already explained by the words.
 * @param props - Component props.
 * @param props.items - The marks to explain.
 * @param props.layout - Side by side or stacked.
 * @param props.className - Extra classes.
 * @returns The key, or null when there is nothing to explain.
 */
export function SwatchKey({
  items,
  layout = "row",
  className,
}: SwatchKeyProps): JSX.Element | null {
  if (items.length === 0) return null;
  const list = layout === "list";
  return (
    <dl
      className={cn(
        "text-xs text-at-muted",
        list ? "space-y-1" : "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        className,
      )}
    >
      {items.map((i, n) => (
        <div
          key={i.key ?? (typeof i.label === "string" ? i.label : n)}
          className={cn("flex", list ? "items-start gap-2" : "items-center gap-1.5")}
        >
          <dt className="flex shrink-0 items-center">{i.swatch}</dt>
          <dd>{i.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A round colour swatch, for a dot or a colour band.
 * @param props - Component props.
 * @param props.className - The fill (and any ring) classes.
 * @returns The dot.
 */
export function DotSwatch({ className }: { className: string }): JSX.Element {
  return <span aria-hidden className={cn("inline-block size-2.5 rounded-full", className)} />;
}

/**
 * An SVG swatch box, for keys that copy a drawn mark (a ring, a dashed leg).
 * @param props - Component props.
 * @param props.width - Box width in px.
 * @param props.height - Box height in px.
 * @param props.className - Extra classes for the SVG.
 * @param props.children - The SVG shapes.
 * @returns The SVG.
 */
export function SvgSwatch({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}
