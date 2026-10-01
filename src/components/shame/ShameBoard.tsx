// src/components/shame/ShameBoard.tsx
// Shame board layout rendering rows as a mobile single-column list or a desktop two-column grid.

import { ModeIcon } from "@/components/ModeIcon";
import { FlameCount } from "@/components/shame/FlameCount";
import { ShameRowDelay } from "@/components/shame/ShameRowDelay";
import { ShameWorstBadge } from "@/components/shame/ShameWorstBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Hint } from "@/components/ui/Hint";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import type { HourSlot } from "@/lib/page/nav";
import type { RouteDisplay } from "@/lib/route/slug";
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
  if (note) {
    return (
      <Hint align="start" hint={note} className={cn(LABEL, "relative z-10 text-at-muted")}>
        {nzHourLabel(hour)}
      </Hint>
    );
  }
  return <span className={cn(LABEL, "text-at-muted")}>{nzHourLabel(hour)}</span>;
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
 * @param props.worst - Whether the row holds the board's worst, which tints it.
 * @param props.children - The row body after the label, holding the subject link.
 * @returns The row element.
 */
export function ShameSplitRow({
  ctx,
  label,
  worst,
  children,
}: {
  ctx: ShameRowContext;
  label: ReactNode;
  worst: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn(ctx.anchorClass, "group relative", worst && "at-worst")}>
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
 * What every shame row shows after its hour, day or rank label: the route's mode
 * icon (stop rows have none), the subject with its worst badge and flame, a muted
 * detail line, and the off-schedule figure on the right.
 * @param props - Component props.
 * @param props.route - The route, for its mode icon; omitted on stop rows.
 * @param props.subject - The subject's name: a {@link ShameSubjectLink} on a split
 *   row, plain text on a row that is one link.
 * @param props.worst - Whether the row holds the board's worst, which earns the badge.
 * @param props.flame - The repeat-offender flame beside the badge, if any.
 * @param props.detail - The muted line under the name ("12 arrivals").
 * @param props.note - A further muted line under the detail, if any.
 * @param props.figures - The row's delay averages and mode (the row itself).
 * @param props.figures.avg_delay_sec - Signed average deviation in seconds.
 * @param props.figures.avg_abs_delay_sec - Average absolute deviation in seconds.
 * @param props.figures.mode - Route mode, for the on-time window and wording.
 * @returns The row body.
 */
export function ShameRowBody({
  route,
  subject,
  worst,
  flame,
  detail,
  note,
  figures,
}: {
  route?: Pick<RouteDisplay, "mode" | "shortName" | "longName">;
  subject: ReactNode;
  worst: boolean;
  flame?: ReactNode;
  detail: ReactNode;
  note?: ReactNode;
  figures: { avg_delay_sec: number | null; avg_abs_delay_sec: number; mode: string };
}): JSX.Element {
  return (
    <>
      {route && (
        <ModeIcon
          mode={route.mode}
          shortName={route.shortName}
          longName={route.longName}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {subject}
          {worst && <ShameWorstBadge />}
          {flame}
        </span>
        <span className="block text-xs text-at-muted tabular-nums">{detail}</span>
        {note && <span className="block text-xs text-at-muted">{note}</span>}
      </span>
      <ShameRowDelay
        avgDelaySec={figures.avg_delay_sec}
        avgAbsDelaySec={figures.avg_abs_delay_sec}
        mode={figures.mode}
      />
    </>
  );
}

/**
 * A day-board route's repeat-offender flame, the strongest that applies: the days
 * in a row it was the day's worst, else the days in a row it made the board, else
 * how many of the day's hours it took. Both streak labels count the hours it took
 * across the run.
 * @param props - Component props.
 * @param props.name - The route's name, for the flame's label.
 * @param props.worst - Whether this row holds the day's worst.
 * @param props.hourCount - How many of the day's hourly slots the route took.
 * @param props.streak - The route's run of earlier days on the board, if read.
 * @param props.hoursLabel - The hourly count's label, which each board words its own way.
 * @returns The flame, or null for a route in one hour with no streak.
 */
export function ShameDayFlame({
  name,
  worst,
  hourCount,
  streak,
  hoursLabel,
}: {
  name: string;
  worst: boolean;
  hourCount: number;
  streak: { count: number; prevHours: number; prevWorstOfDayDays: number } | undefined;
  hoursLabel: string;
}): JSX.Element | null {
  const streakDays = streak?.count ?? 1;
  const totalHours = hourCount + (streak?.prevHours ?? 0);
  // Today counts towards the worst-of-the-day run only when this row holds it.
  const worstOfDayStreak = (worst ? 1 : 0) + (streak?.prevWorstOfDayDays ?? 0);
  if (worstOfDayStreak >= 2) {
    return (
      <FlameCount
        tier="streak"
        count={worstOfDayStreak}
        worst={worst}
        label={`${name}: worst of the day ${worstOfDayStreak} days in a row · ${totalHours} hours total`}
      />
    );
  }
  if (streakDays >= 2) {
    return (
      <FlameCount
        tier="streak"
        count={streakDays}
        worst={worst}
        label={`${name}: on the shame list ${streakDays} days in a row · ${totalHours} hours total`}
      />
    );
  }
  if (hourCount > 1) {
    return <FlameCount tier="day" count={hourCount} worst={worst} label={hoursLabel} />;
  }
  return null;
}

/**
 * A day board's row renderer over hour slots: the hour's row when something
 * qualified, else a {@link ShameEmptyHourRow} saying what fell short, so every
 * board covers the whole day the same way.
 * @param renderRow - Renders an hour that has a row.
 * @param empty - What an empty hour shows.
 * @param empty.serviceDate - The shown service date (`YYYY-MM-DD`).
 * @param empty.title - What did not fit, e.g. "No route fits this hour".
 * @param empty.reason - The minimum it missed.
 * @returns The board's `renderRow`.
 */
export function hourSlotRenderer<H>(
  renderRow: (row: H, ctx: ShameRowContext) => JSX.Element,
  empty: { serviceDate: string; title: string; reason: string },
): (slot: HourSlot<H>, ctx: ShameRowContext) => JSX.Element {
  return function renderHourSlot(slot, ctx) {
    return slot.row ? (
      renderRow(slot.row, ctx)
    ) : (
      <ShameEmptyHourRow hour={slot.hour} {...empty} ctx={ctx} />
    );
  };
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
    return <EmptyState>{emptyMessage}</EmptyState>;
  }

  const footer = showFooter && footerMessage && (
    <Panel as="p" className="px-4 py-3 text-sm text-at-muted">
      {footerMessage}
    </Panel>
  );

  if (layout === "week") {
    return (
      <>
        <Panel as="div">
          <ul className="striped">
            {items.map((item, i) => (
              <li key={keyOf(item, i)}>
                {renderRow(item, { surface: "mobile", anchorClass: MOBILE_ANCHOR })}
              </li>
            ))}
          </ul>
        </Panel>
        {footer}
      </>
    );
  }

  return (
    <>
      <Panel as="div">
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
      </Panel>
      {footer}
    </>
  );
}
