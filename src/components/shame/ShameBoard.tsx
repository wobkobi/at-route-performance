// src/components/shame/ShameBoard.tsx
// Shame board layout rendering rows as a mobile single-column list or a desktop two-column grid.

import { cn } from "@/lib/cn";
import {
  afterMidnightNote,
  nzHourLabel,
  SERVICE_START_HOUR,
  weekdayShort,
} from "@/lib/time/service-day";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/** The label column's box, shared by the hour and rank labels so rows line up. */
const LABEL = "w-12 shrink-0 pt-px text-sm font-semibold tabular-nums";

/**
 * A label that is its row's main link: its `::after` is stretched over the whole
 * row (the row is `relative`), so a press anywhere opens it, and only a lifted
 * {@link ShameSubjectLink} goes elsewhere.
 */
const STRETCHED =
  "text-at-shore after:absolute after:inset-0 group-hover:underline underline-offset-2";

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

/**
 * A day-board row's hour, such as "9am". The hours after midnight close the
 * board rather than open it, so each carries a tooltip naming the service day
 * it counts towards. Given an href, the hour is the row's main link (see
 * {@link ShameSplitRow}), opening the hour's ranked list from anywhere on the row.
 * @param props - Component props.
 * @param props.hour - Hour of day, 0-23.
 * @param props.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param props.href - Where the hour opens, or undefined for a plain label.
 * @param props.linkLabel - The link's accessible name, naming what it opens.
 * @returns The label element.
 */
export function ShameHourLabel({
  hour,
  serviceDate,
  href,
  linkLabel,
}: {
  hour: number;
  serviceDate: string;
  href?: string;
  linkLabel?: string;
}): JSX.Element {
  const afterMidnight = hour < SERVICE_START_HOUR;
  const note = afterMidnight ? afterMidnightNote(serviceDate) : undefined;
  if (href) {
    return (
      <Link href={href} aria-label={linkLabel} title={note} className={cn(LABEL, STRETCHED)}>
        {nzHourLabel(hour)}
      </Link>
    );
  }
  return (
    <span className={cn(LABEL, "text-at-muted", afterMidnight && "cursor-help")} title={note}>
      {nzHourLabel(hour)}
    </span>
  );
}

/**
 * A ranked list's position, such as "1", in the column the hour takes on the
 * hourly board.
 * @param props - Component props.
 * @param props.rank - Position in the list, from 1.
 * @returns The label element.
 */
export function ShameRankLabel({ rank }: { rank: number }): JSX.Element {
  return <span className={cn(LABEL, "text-at-muted")}>{rank}</span>;
}

/**
 * A week or month board's day, such as "Thu 24/09", as the row's main link: it
 * opens the day's ranked list from anywhere on the row (see {@link ShameSplitRow}).
 * @param props - Component props.
 * @param props.date - The service date (`YYYY-MM-DD`).
 * @param props.href - The day's ranked list.
 * @param props.linkLabel - The link's accessible name, naming what it opens.
 * @returns The label element.
 */
export function ShameDayLabel({
  date,
  href,
  linkLabel,
}: {
  date: string;
  href: string;
  linkLabel: string;
}): JSX.Element {
  const [, m, d] = date.split("-");
  return (
    <Link
      href={href}
      aria-label={linkLabel}
      className={cn("w-16 shrink-0 pt-px text-sm font-semibold tabular-nums", STRETCHED)}
    >
      {weekdayShort(date)} {d}/{m}
    </Link>
  );
}

/**
 * A row with two destinations. Links cannot nest, so the label (a linked
 * {@link ShameHourLabel} or {@link ShameDayLabel}) stretches its link over the
 * whole row, and the row's subject, a {@link ShameSubjectLink}, is lifted above
 * it. The row reads and hovers as one surface that opens the period's ranked
 * list; only a press on the subject opens the route, run or stop.
 * @param props - Component props.
 * @param props.ctx - Surface context from the board.
 * @param props.label - The label column, whose link covers the row.
 * @param props.className - Extra classes for the row (the worst highlight).
 * @param props.children - The row body after the label, holding the subject link.
 * @returns The row element.
 */
export function ShameSplitRow({
  ctx,
  label,
  className,
  children,
}: {
  ctx: ShameRowContext;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn(ctx.anchorClass, "group relative", className)}>
      {label}
      {children}
    </div>
  );
}

/**
 * A split row's subject (the route number, or the stop name), lifted above the
 * row's stretched list link so a press on it opens the subject itself. Dotted
 * underline so it reads as a link of its own inside a row that is one.
 * @param props - Component props.
 * @param props.href - Where the subject opens.
 * @param props.children - The subject's name.
 * @returns The link element.
 */
export function ShameSubjectLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Link
      href={href}
      className="relative z-10 font-semibold text-at-ink underline decoration-at-border decoration-dotted underline-offset-4 hover:text-at-shore hover:decoration-at-shore hover:decoration-solid"
    >
      {children}
    </Link>
  );
}

/**
 * A day-board hour where nothing met the board's minimum sample, so the board
 * still covers the whole day. Not a link: there is nothing to open. The hover
 * tint is cancelled for the same reason.
 * @param props - Component props.
 * @param props.hour - Hour of day, 0-23.
 * @param props.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param props.title - What did not fit, e.g. "No route fits this hour".
 * @param props.reason - The minimum it missed, e.g. "No route had 30 arrivals".
 * @param props.ctx - Surface context from the board.
 * @returns The row element.
 */
export function ShameEmptyHourRow({
  hour,
  serviceDate,
  title,
  reason,
  ctx,
}: {
  hour: number;
  serviceDate: string;
  title: string;
  reason: string;
  ctx: ShameRowContext;
}): JSX.Element {
  return (
    <div className={cn(ctx.anchorClass, "hover:bg-transparent")}>
      <ShameHourLabel hour={hour} serviceDate={serviceDate} />
      <span className="min-w-0 flex-1">
        <span className="block text-at-muted">{title}</span>
        <span className="block text-xs text-at-muted">{reason}</span>
      </span>
    </div>
  );
}

/** Props for {@link ShameBoard}. */
export interface ShameBoardProps<T> {
  /** "day" = responsive two-column hour grid; "week" = single-column list (days, or a ranked list). */
  layout: "day" | "week";
  /** Rows to render (already filtered/ordered by the page). */
  items: T[];
  /** Stable React key for a row. */
  keyOf: (item: T, index: number) => string;
  /** Message shown in place of the board when there are no rows. */
  emptyMessage: string;
  /** Footer message shown under the board (e.g. "No runs were notably off schedule…"). */
  footerMessage?: string;
  /** Whether to show the footer. */
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

  const footer = showFooter && footerMessage && (
    <p className="border border-at-border bg-at-surface px-4 py-3 text-sm text-at-muted">
      {footerMessage}
    </p>
  );

  if (layout === "week") {
    return (
      <>
        <div className="border border-at-border bg-at-surface">
          <ul className="striped">
            {items.map((item, i) => (
              <li key={keyOf(item, i)}>
                {renderRow(item, { surface: "mobile", anchorClass: MOBILE_ANCHOR })}
              </li>
            ))}
          </ul>
        </div>
        {footer}
      </>
    );
  }

  return (
    <>
      <div className="border border-at-border bg-at-surface">
        {/* Mobile: sequential single-column list */}
        <ul className="striped md:hidden">
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
            // Half the rows down each column (the extra one on the left), so a
            // full day reads 12 and 12 rather than leaving a gap under one side.
            const perCol = Math.ceil(items.length / 2);
            const isRight = i >= perCol;
            const rowIdx = isRight ? i - perCol : i;
            // An odd count leaves the right column one short; its last cell
            // then has no row below to draw the divider, so it draws its own.
            const closesShortColumn = isRight && i === items.length - 1 && items.length % 2 === 1;
            return (
              <li
                key={keyOf(item, i)}
                className={cn(
                  rowIdx > 0 && "border-t border-at-border",
                  // Striped by grid row, not list order, so a row reads across both columns.
                  rowIdx % 2 === 1 && "bg-at-stripe",
                  isRight && "border-l border-at-border",
                  closesShortColumn && "border-b border-at-border",
                )}
                style={{ gridColumn: isRight ? 2 : 1, gridRow: rowIdx + 1 }}
              >
                {renderRow(item, { surface: "grid", anchorClass: GRID_ANCHOR })}
              </li>
            );
          })}
        </ul>
      </div>
      {footer}
    </>
  );
}
