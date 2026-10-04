import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/**
 * A row of headline figures in one box: two columns on a phone, then three, then
 * five. Each cell pads itself, so a strip lines up cell for cell with the
 * `PunctualityStat` cells on the home and routes pages.
 * @param props - Component props.
 * @param props.className - Extra classes, usually a column count for more or fewer figures.
 * @param props.children - The {@link Figure} cells.
 * @returns The strip.
 */
export function FigureStrip({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Panel as="dl" className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {children}
    </Panel>
  );
}

/** Props for {@link Figure}. */
export interface FigureProps {
  /** What the figure counts, as a small capitals label. */
  label: ReactNode;
  /** A note under the value: a share, a caveat. */
  note?: ReactNode;
  /** `md` for a strip cell; `sm` for a figure inside a list row. */
  size?: "md" | "sm";
  /** Classes for the value, usually a tone colour. */
  className?: string;
  children: ReactNode;
}

/**
 * One labelled figure: the label over the value, with an optional note below.
 * @param props - Component props.
 * @param props.label - What it counts.
 * @param props.note - A note under the value.
 * @param props.size - Strip cell or in-row size.
 * @param props.className - Classes for the value.
 * @param props.children - The value.
 * @returns The term and its value.
 */
export function Figure({
  label,
  note,
  size = "md",
  className,
  children,
}: FigureProps): JSX.Element {
  return (
    <div className={cn("min-w-0", size === "md" && "p-3")}>
      <dt className="at-eyebrow text-at-muted">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          size === "md" ? "at-figure text-xl text-at-ink" : "truncate font-semibold",
          className,
        )}
      >
        {children}
      </dd>
      {note && <dd className="text-xs text-at-muted">{note}</dd>}
    </div>
  );
}
