import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { nzHourLabel, weekdayShort } from "@/lib/time/service-day";
import { hourRangeClock, type HourRange } from "@/lib/time/time-of-day";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/** A worst card's state: nothing ranked, ranked with nothing to crown, or a crowned row. */
export type WorstCardTone = "empty" | "clear" | "worst";

const TONE_CLASS: Record<WorstCardTone, { rule: string; eyebrow: string }> = {
  empty: { rule: "border-at-border", eyebrow: "text-at-muted" },
  clear: { rule: "border-at-ontime", eyebrow: "text-at-ontime" },
  worst: { rule: "border-at-late", eyebrow: "text-at-late" },
};

/** Props for {@link WorstCard}. */
export interface WorstCardProps {
  /** The card's state, which sets its rule and eyebrow colour. */
  tone: WorstCardTone;
  /** The board the card speaks for ("Worst route"). */
  eyebrow: string;
  /** Where the crowned row's page is; only a `worst` card links. */
  href?: string;
  children: ReactNode;
}

/**
 * The shell shared by the worst-route, worst-stop and worst-trip cards: a left
 * rule in the state's colour, an eyebrow naming the board, then the content.
 * The three cards sit side by side, so they must read through the same states.
 * @param props - Component props.
 * @param props.tone - The card's state.
 * @param props.eyebrow - The board the card speaks for.
 * @param props.href - The crowned row's page, for a `worst` card.
 * @param props.children - The card's content.
 * @returns The card.
 */
export function WorstCard({ tone, eyebrow, href, children }: WorstCardProps): JSX.Element {
  const { rule, eyebrow: eyebrowClass } = TONE_CLASS[tone];
  const shell = cn("flex flex-col gap-1 border-l-2 bg-at-surface py-3 pl-5", rule);
  const body = (
    <>
      <p className={cn("at-eyebrow", eyebrowClass)}>{eyebrow}</p>
      {children}
    </>
  );
  if (tone === "worst" && href) {
    return (
      <Link href={href} className={cn(shell, "transition-colors hover:bg-at-late/5")}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * The card's big line: the crowned row's name, or the state's headline.
 * @param props - Component props.
 * @param props.children - The text.
 * @returns The title.
 */
export function WorstCardTitle({ children }: { children: ReactNode }): JSX.Element {
  return <span className="text-2xl font-ultra tracking-zero text-at-ink">{children}</span>;
}

/** Props for {@link NoWorst}. */
export interface NoWorstProps {
  /** The board the card speaks for ("Worst route"). */
  eyebrow: string;
  /** What the board ranks, singular ("route"). */
  noun: string;
  /** Whether the board ranked anything, which tells a clean window from an empty one. */
  ranked: boolean;
  /** The shown window as words ("today", "on Sat 19 Sep"). */
  when: string;
}

/**
 * A worst card with nothing to crown. An empty board ("Nothing to rank yet") is
 * not good news, so it stays grey; only a board that ranked rows and found none
 * past the late bound gets the green all-clear.
 * @param props - Component props.
 * @param props.eyebrow - The board the card speaks for.
 * @param props.noun - What the board ranks.
 * @param props.ranked - Whether the board ranked anything.
 * @param props.when - The shown window as words.
 * @returns The card.
 */
export function NoWorst({ eyebrow, noun, ranked, when }: NoWorstProps): JSX.Element {
  if (!ranked) {
    return (
      <WorstCard tone="empty" eyebrow={eyebrow}>
        <WorstCardTitle>Nothing to rank yet</WorstCardTitle>
        <p className="text-sm text-at-muted">No {noun} has enough arrivals in this period.</p>
      </WorstCard>
    );
  }
  return (
    <WorstCard tone="clear" eyebrow={eyebrow}>
      <WorstCardTitle>No shame {when}</WorstCardTitle>
      <p className="text-sm text-at-muted">
        No {noun} stood out {when}, so there is nothing to call out.
      </p>
    </WorstCard>
  );
}

/** Props for {@link WorstCardBucket}. */
export interface WorstCardBucketProps {
  /** Arrivals behind the row's figures. */
  events: number;
  /** The row's service day, for a week or month row. */
  date?: string;
  /** The row's hour, for a day row. */
  hour?: number;
  /** The part of the day the board pooled, when the page is narrowed to one. */
  hours: HourRange | null;
  /** Whether the day is still under way, so a range running to its end reads "to now". */
  live: boolean;
}

/**
 * The footnote saying which slice the figures cover: "212 arrivals on Tue" for a
 * week row, "from 7 to 9 am" for a pooled range, "in the 8am hour" otherwise.
 * Week and month rows carry a service date and no meaningful hour; day rows are
 * the other way round.
 * @param props - Component props.
 * @param props.events - Arrivals behind the figures.
 * @param props.date - The row's service day, for a period row.
 * @param props.hour - The row's hour, for a day row.
 * @param props.hours - The pooled part of the day, or null.
 * @param props.live - Whether the day is still under way.
 * @returns The footnote.
 */
export function WorstCardBucket({
  events,
  date,
  hour,
  hours,
  live,
}: WorstCardBucketProps): JSX.Element {
  const bucket = date
    ? `on ${weekdayShort(date)}`
    : hours
      ? `from ${hourRangeClock(hours, live)}`
      : `in the ${nzHourLabel(hour ?? 0)} hour`;
  return (
    <p className="text-xs text-at-muted tabular-nums">
      {plural(events, "arrival")} {bucket}
    </p>
  );
}
