import { cn } from "@/lib/cn";
import type { JSX, ReactNode } from "react";

/** Padding for every header and body cell, so all tables share one density. */
export const CELL_CLASS = "p-3";

/** A body row: ruled off from the next, with no rule under the last. */
export const ROW_CLASS = "border-b border-at-border last:border-b-0";

/** Props for {@link DataTable}. */
export interface DataTableProps {
  /** What the table lists, for screen readers; shown only when `showCaption`. */
  caption: string;
  /** Show the caption under the table rather than only to assistive tech. */
  showCaption?: boolean;
  /** Draw the box; turn off for a table inside a panel that already has one. */
  framed?: boolean;
  /** Extra classes for the scroll wrapper. */
  className?: string;
  /** Extra classes for the table itself, such as a fixed layout for set column widths. */
  tableClassName?: string;
  /** The `thead` and `tbody`. Header rows take `.at-th-row`, body rows {@link ROW_CLASS}, cells {@link CELL_CLASS}, and a row's first cell is a `th scope="row"`. */
  children: ReactNode;
}

/**
 * A table in a horizontally scrolling box, so a wide one scrolls on a phone
 * rather than widening the page.
 * @param props - Component props.
 * @param props.caption - What the table lists.
 * @param props.showCaption - Show the caption visibly.
 * @param props.framed - Draw the box.
 * @param props.className - Extra classes for the wrapper.
 * @param props.tableClassName - Extra classes for the table.
 * @param props.children - The table's sections.
 * @returns The table.
 */
export function DataTable({
  caption,
  showCaption = false,
  framed = true,
  className,
  tableClassName,
  children,
}: DataTableProps): JSX.Element {
  return (
    <div className={cn("overflow-x-auto", framed && "at-card", className)}>
      <table className={cn("min-w-full text-sm", tableClassName)}>
        <caption
          className={showCaption ? "caption-bottom p-3 text-left text-xs text-at-muted" : "sr-only"}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}
