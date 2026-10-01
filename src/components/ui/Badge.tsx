import { cn } from "@/lib/cn";
import {
  CANCELLATION_BADGE,
  CANCELLATION_BADGE_MEANING,
  CANCELLATION_BADGE_SHORT,
  type CancellationStage,
} from "@/lib/trip/cancellation";
import type { JSX } from "react";

/** A badge's colour, one of the `.badge-*` tones in globals.css. */
export type BadgeTone =
  "ok" | "late" | "early" | "live" | "commercial" | "disruption" | "muted" | "pale" | "outline";

/** Badge tone per cancellation stage: reinstated is an outline, an actual cancellation is solid. */
export const CANCELLATION_TONE: Record<CancellationStage, BadgeTone> = {
  before: "late",
  "mid-trip": "late",
  ran: "outline",
};

/**
 * The classes for a badge in one tone, for a link or other element that has to
 * look like a {@link Badge} without being one.
 * @param tone - The badge's colour.
 * @returns The `.badge` class pair.
 */
export function badgeClass(tone: BadgeTone): string {
  return `badge badge-${tone}`;
}

/** Props for {@link Badge}. */
export interface BadgeProps {
  /** The badge's colour. */
  tone: BadgeTone;
  /** The label, in capitals for a status. */
  label: string;
  /** A narrower label shown below `sm`; omit when the label does not change. */
  shortLabel?: string;
  /** What the badge means, for a pointer hover. */
  title?: string;
  /** Extra classes. */
  className?: string;
}

/**
 * A small status label beside a row's name.
 * @param props - Component props.
 * @param props.tone - The badge's colour.
 * @param props.label - The label.
 * @param props.shortLabel - The narrower label below `sm`.
 * @param props.title - What the badge means.
 * @param props.className - Extra classes.
 * @returns The badge.
 */
export function Badge({ tone, label, shortLabel, title, className }: BadgeProps): JSX.Element {
  return (
    <span title={title} className={cn(badgeClass(tone), className)}>
      <BadgeLabel label={label} shortLabel={shortLabel} />
    </span>
  );
}

/**
 * A badge's text, swapping to the short label below `sm` when there is one.
 * @param props - Component props.
 * @param props.label - The full label.
 * @param props.shortLabel - The narrower label.
 * @returns The label text.
 */
export function BadgeLabel({
  label,
  shortLabel,
}: {
  label: string;
  shortLabel?: string;
}): JSX.Element {
  if (!shortLabel || shortLabel === label) return <>{label}</>;
  return (
    <>
      <span className="sm:hidden">{shortLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </>
  );
}

/**
 * The LIVE badge for a trip or vehicle that is broadcasting a position now.
 * @returns The badge.
 */
export function LiveBadge(): JSX.Element {
  return <Badge tone="live" label="LIVE" />;
}

/**
 * The badge for a cancelled trip, worded for the stage AT cancelled it at.
 * @param props - Component props.
 * @param props.stage - When the trip was cancelled.
 * @returns The badge.
 */
export function CancellationBadge({ stage }: { stage: CancellationStage }): JSX.Element {
  return (
    <Badge
      tone={CANCELLATION_TONE[stage]}
      label={CANCELLATION_BADGE[stage]}
      shortLabel={CANCELLATION_BADGE_SHORT[stage]}
      title={CANCELLATION_BADGE_MEANING[stage]}
    />
  );
}
