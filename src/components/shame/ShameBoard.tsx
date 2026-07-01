// src/components/shame/ShameBoard.tsx
/**
 * @description Shame board layout rendering rows as a mobile single-column list or a desktop two-column grid.
 */
import { cn } from "@/lib/cn";
import { ITEMS_PER_COL } from "@/lib/shame-page";
import type { JSX } from "react";

/** Anchor classes for a single-column row (mobile day list + week list). */
const MOBILE_ANCHOR =
  "flex items-start gap-3 border-t border-at-border px-4 py-3 transition-colors hover:bg-at-shore-pale";
/** Anchor classes for a desktop grid cell (border lives on the `<li>`, cell is full-height). */
const GRID_ANCHOR =
  "flex h-full items-start gap-3 px-4 py-3 transition-colors hover:bg-at-shore-pale";

/** Context passed to a board's `renderRow`, describing the row's surface. */
export interface ShameRowContext {
  /** "mobile" = single-column list; "grid" = desktop two-column cell. */
  surface: "mobile" | "grid";
  /** The anchor's surface-specific border/sizing classes; spread into the `<a>` className. */
  anchorClass: string;
}

/** Props for {@link ShameBoard}. */
export interface ShameBoardProps<T> {
  /** "day" = responsive two-column hour grid; "week" = single-column day list. */
  layout: "day" | "week";
  /** Rows to render (already filtered/ordered by the page). */
  items: T[];
  /** Stable React key for a row. */
  keyOf: (item: T, index: number) => string;
  /** Message shown in place of the board when there are no rows. */
  emptyMessage: string;
  /** Footer message shown under a day board (e.g. "No runs were notably off-schedule…"). */
  footerMessage?: string;
  /** Whether to show the footer (day view, when nothing was crowned). */
  showFooter?: boolean;
  /** Render a row's `<a>…</a>`, applying `ctx.anchorClass` and any worst highlight. */
  renderRow: (item: T, ctx: ShameRowContext) => JSX.Element;
}

/**
 * Shared board shell for the shame day/week views. Owns the surface container,
 * the empty state, the responsive layout (single-column on mobile and in the
 * week view; an explicit two-column CSS grid on desktop day views so column
 * dividers stay row-aligned), and the optional "none notably bad" footer. Each
 * page supplies `renderRow` for the entity-specific row body.
 * @param props - Component props.
 * @param props.layout - "day" (hour grid) or "week" (day list).
 * @param props.items - Rows to render.
 * @param props.keyOf - Stable key for a row.
 * @param props.emptyMessage - Shown when there are no rows.
 * @param props.footerMessage - Footer text (day view).
 * @param props.showFooter - Whether to show the footer.
 * @param props.renderRow - Renders a row's anchor element.
 * @returns The board element(s).
 */
export function ShameBoard<T>({
  layout,
  items,
  keyOf,
  emptyMessage,
  footerMessage,
  showFooter,
  renderRow,
}: ShameBoardProps<T>): JSX.Element {
  if (items.length === 0) {
    return (
      <p className="border border-at-border bg-at-surface p-4 text-at-muted">{emptyMessage}</p>
    );
  }

  if (layout === "week") {
    return (
      <div className="border border-at-border bg-at-surface">
        <ul>
          {items.map((item, i) => (
            <li key={keyOf(item, i)}>
              {renderRow(item, { surface: "mobile", anchorClass: MOBILE_ANCHOR })}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      <div className="border border-at-border bg-at-surface">
        {/* Mobile: sequential single-column list */}
        <ul className="md:hidden">
          {items.map((item, i) => (
            <li key={keyOf(item, i)}>
              {renderRow(item, { surface: "mobile", anchorClass: MOBILE_ANCHOR })}
            </li>
          ))}
        </ul>
        {/*
          Desktop: explicit CSS Grid placement so col1[i] and col2[i] share the
          same grid row. The browser equalises their height, keeping the
          horizontal dividers aligned across both columns even when one cell has
          extra lines (repeat-count badge, streak text, etc.).
        */}
        <ul className="hidden md:grid md:grid-cols-2">
          {items.map((item, i) => {
            const isRight = i >= ITEMS_PER_COL;
            const rowIdx = isRight ? i - ITEMS_PER_COL : i;
            return (
              <li
                key={keyOf(item, i)}
                className={cn(
                  rowIdx > 0 && "border-t border-at-border",
                  isRight && "border-l border-at-border",
                )}
                style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
              >
                {renderRow(item, { surface: "grid", anchorClass: GRID_ANCHOR })}
              </li>
            );
          })}
        </ul>
      </div>
      {showFooter && footerMessage && (
        <p className="border border-at-border bg-at-surface px-4 py-3 text-sm text-at-muted">
          {footerMessage}
        </p>
      )}
    </>
  );
}
