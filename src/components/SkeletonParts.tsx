// src/components/SkeletonParts.tsx
// Skeleton pieces shared by the loading pages and the in-page Suspense fallbacks.
// Each mirrors a real component box for box - the same padding, gaps, borders and
// text line heights, with a bone the height of each text line - so a skeleton
// fills exactly the space of the page it turns into and nothing jumps on arrival.
// A change to one of the mirrored components needs the matching change here.

import { Bone } from "@/components/shame/ShameBoardSkeleton";
import { cn } from "@/lib/cn";
import type { JSX } from "react";

/**
 * A `.chip` with a text label: `px-3 py-1 text-sm` plus the 1px `chip-off`
 * border, so 30px tall.
 * @param root0 - Props.
 * @param root0.className - Width class for the label's length.
 * @returns The chip placeholder.
 */
export function ChipBone({ className }: { className: string }): JSX.Element {
  return <Bone className={cn("h-7.5 rounded-full", className)} />;
}

/**
 * A `.chip` holding only a 16px chevron: 26px tall and 42px wide.
 * @returns The chip placeholder.
 */
export function IconChipBone(): JSX.Element {
  return <Bone className="h-6.5 w-10.5 rounded-full" />;
}

/**
 * A page title: `text-2xl sm:text-3xl`, so a 32px line on phones and 36px above.
 * @param root0 - Props.
 * @param root0.className - Width class for the title's length.
 * @returns The title placeholder.
 */
export function TitleBone({ className }: { className: string }): JSX.Element {
  return <Bone className={cn("h-8 max-w-full sm:h-9", className)} />;
}

/**
 * Mirrors DayNav on the current day: the previous-day chip and the `px-2
 * text-sm` date label (the next-day chip only appears on past days).
 * @returns The stepper placeholder.
 */
export function DayNavSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <IconChipBone />
      <div className="px-2">
        <Bone className="h-5 w-18" />
      </div>
    </div>
  );
}

/**
 * Mirrors FleetSummary: one bordered strip of `p-3` cells, each an uppercase
 * `text-xs` label (16px) over a `text-xl` value (28px).
 * @returns The KPI strip placeholder.
 */
export function KpiStripSkeleton(): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-3">
            <Bone className="h-4 w-16" />
            <Bone className="h-7 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors the highlight cards (ShameOfDay, WorstRouteCard, WorstStopCard): a
 * `px-6 py-5` bordered column of a `text-xs` label, a `text-2xl` title row, a
 * `text-sm` summary and a `text-xs` footnote, 4px apart. The trip card's title
 * row also carries the headsign and start time, which wrap onto their own lines
 * once the card is phone-narrow, so `withHeadsign` adds those lines below `md`.
 * In the Shame dashboard's grid (`narrow`) the headsign always takes its own line,
 * and a typical one wraps to two once the cards sit two or three across.
 * @param root0 - Props.
 * @param root0.withHeadsign - Mirror the trip card's headsign and start time.
 * @param root0.narrow - The card never gets wide enough for the headsign to share the title row.
 * @returns The card placeholder.
 */
export function FeatureCardSkeleton({
  withHeadsign = false,
  narrow = false,
}: {
  withHeadsign?: boolean;
  narrow?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 border border-at-border bg-at-surface px-6 py-5">
      <Bone className="h-4 w-20" />
      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-8 w-24" />
        {withHeadsign && (
          <>
            <Bone className={cn("h-6 w-full", narrow ? "sm:h-12" : "md:w-48")} />
            <Bone className="h-5 w-14" />
          </>
        )}
      </div>
      <Bone className="h-5 w-64 max-w-full" />
      <Bone className="h-4 w-28" />
    </div>
  );
}

/**
 * Mirrors the home page's pair of highlight cards.
 * @returns The two-card grid placeholder.
 */
export function FeatureCardPairSkeleton(): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FeatureCardSkeleton withHeadsign />
      <FeatureCardSkeleton />
    </div>
  );
}

/**
 * Mirrors RankBoard's top ten: a `text-lg` heading (28px, `mb-1`), the caption
 * slot (`mb-3`, 20px; the off-schedule board's on-time line wraps to two lines
 * until the boards are `lg` wide), then ten `py-3` rows of a 24px line split by
 * 1px rules.
 * @param root0 - Props.
 * @param root0.caption - Whether the board carries the on-time caption.
 * @param root0.rows - How many rows to draw (the home boards show ten).
 * @returns The board placeholder.
 */
export function RankBoardSkeleton({
  caption = false,
  rows = 10,
}: {
  caption?: boolean;
  rows?: number;
}): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface p-4">
      <Bone className="mb-1 h-7 w-44" />
      <div className={cn("mb-3", caption ? "h-10 lg:h-5" : "h-5")}>
        {caption && <Bone className="h-full w-80 max-w-full" />}
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "-mx-4 flex items-center gap-2 px-4 py-3",
              i > 0 && "border-t border-at-border",
            )}
          >
            <Bone className="h-4 w-5" />
            <Bone className="h-5 w-5 rounded-full" />
            <div className="flex h-6 flex-1 items-center">
              <Bone className="h-4 w-14" />
            </div>
            <Bone className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors the filter row above the boards: the mode chips with the school-bus
 * toggle on the left, the All/Late/Early delay chips at the right (wrapping under
 * them on a phone).
 * @returns The filter row.
 */
export function BoardFiltersSkeleton(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <ChipBone className="w-11" />
          <ChipBone className="w-12" />
          <ChipBone className="w-15" />
        </div>
        <ChipBone className="w-27" />
      </div>
      <div className="flex flex-wrap gap-2">
        <ChipBone className="w-11" />
        <ChipBone className="w-14" />
        <ChipBone className="w-16" />
      </div>
    </div>
  );
}

/**
 * Mirrors ShameHeader: the red title over its `mt-0.5 text-sm` subtitle, then the
 * Trips/Routes/Stops chips, the Day/Week toggle chip on the hour boards, and the
 * day stepper.
 * @param root0 - Props.
 * @param root0.toggle - Whether the header carries the Day/Week toggle chip.
 * @param root0.twoLineSubtitle - Whether the subtitle wraps to two lines below `sm`.
 * @returns The header placeholder.
 */
export function ShameHeaderSkeleton({
  toggle = false,
  twoLineSubtitle = false,
}: {
  toggle?: boolean;
  twoLineSubtitle?: boolean;
}): JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <TitleBone className="w-64" />
        <Bone className={cn("mt-0.5 w-80 max-w-full", twoLineSubtitle ? "h-10 sm:h-5" : "h-5")} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <ChipBone className="w-15" />
          <ChipBone className="w-17" />
          <ChipBone className="w-15" />
        </div>
        {toggle && <ChipBone className="w-15" />}
        <DayNavSkeleton />
      </div>
    </header>
  );
}

/**
 * Mirrors CancelledBoard: a `px-4 py-3` header over its bottom rule, then `py-3`
 * rows of a 24px line split by 1px rules.
 * @param root0 - Props.
 * @param root0.rows - How many rows to draw (the Shame dashboard shows ten).
 * @returns The board placeholder.
 */
export function CancelledBoardSkeleton({ rows = 10 }: { rows?: number }): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface">
      <div className="flex items-center justify-between gap-3 border-b border-at-border px-4 py-3">
        <Bone className="h-6 w-36" />
        <Bone className="h-5 w-16" />
      </div>
      <div className="divide-y divide-at-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Bone className="h-4 w-5" />
            <Bone className="h-5 w-5 rounded-full" />
            <div className="flex h-6 flex-1 items-center">
              <Bone className="h-4 w-16" />
            </div>
            <Bone className="h-5 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors the route and stop stats strips: `p-4` cells of an uppercase `text-xs`
 * label (16px) over a `text-2xl` value (32px), two across on a phone and four
 * from `sm`.
 * @returns The stats strip placeholder.
 */
export function StatCellsSkeleton(): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4">
            <Bone className="h-4 w-20" />
            <Bone className="h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors a map card (RouteMapDiagram, the stop and trip maps): a `p-4` section
 * with a `text-lg` heading row (`mb-2`) above the map box.
 * @param root0 - Props.
 * @param root0.mapClass - The map's height class (`h-125` on routes, `h-100` elsewhere).
 * @returns The map card placeholder.
 */
export function MapSectionSkeleton({ mapClass }: { mapClass: string }): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface p-4">
      <Bone className="mb-2 h-7 w-28" />
      <Bone className={mapClass} />
    </div>
  );
}

/**
 * Mirrors WorstTripsBoard on page 1: the `text-base` heading beside the four
 * `text-xs` sort chips (26px; they wrap under the heading on a phone), ten
 * `py-2.5 text-sm` rows split by rules, and the pagination chips.
 * @returns The board placeholder.
 */
export function TripBoardSkeleton(): JSX.Element {
  return (
    <div className="min-w-0 border border-at-border bg-at-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Bone className="h-6 w-32" />
        <div className="flex flex-wrap gap-1">
          <Bone className="h-6.5 w-17 rounded-full" />
          <Bone className="h-6.5 w-13 rounded-full" />
          <Bone className="h-6.5 w-15 rounded-full" />
          <Bone className="h-6.5 w-19 rounded-full" />
        </div>
      </div>
      <div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "-mx-4 flex items-center gap-3 px-4 py-2.5",
              i > 0 && "border-t border-at-border",
            )}
          >
            <Bone className="h-4 w-6" />
            <div className="flex h-5 min-w-0 flex-1 items-center">
              <Bone className="h-4 w-56 max-w-full" />
            </div>
            <Bone className="h-4 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1">
        <ChipBone className="w-9" />
        <ChipBone className="w-9" />
        <ChipBone className="w-9" />
        <IconChipBone />
      </div>
    </div>
  );
}

/**
 * Mirrors the head of RouteLineDiagram: the `text-lg` heading (`mb-1`), the
 * `text-xs` hover hint (`mb-3`), then the diagram, whose real height depends on
 * the route's branches, so its box is only a typical size.
 * @returns The diagram placeholder.
 */
export function LineDiagramSkeleton(): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface p-4">
      <Bone className="mb-1 h-7 w-32" />
      <Bone className="mb-3 h-4 w-40" />
      <Bone className="h-96" />
    </div>
  );
}

/**
 * Mirrors StopSchedule: the uppercase `text-sm` heading, then the departures
 * table's `text-xs` head row and its `py-1.5 text-sm` rows.
 * @returns The schedule placeholder.
 */
export function StopScheduleSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Bone className="h-5 w-36" />
      <div>
        <div className="border-b border-at-border pb-1">
          <Bone className="h-4 w-48" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-at-border/40 py-1.5 last:border-0">
            <Bone className="h-5 w-64 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
