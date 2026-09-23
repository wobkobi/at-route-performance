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
 * `text-xs` label (16px) over a `text-xl` value (28px). One cell carries a
 * third `text-xs` line ("Reinstated trips included"), which sets the whole row's
 * height, so the placeholder has to draw it or the strip jumps on hydration.
 *
 * With `verdict` it mirrors the lead panel too: a `p-4` block, 12px apart, of the
 * `text-xs` label, the `text-5xl`/`sm:text-6xl` word (line height 1, so 48px
 * then 60px), the 8px meter and a `text-sm` sentence that wraps to two lines on
 * a phone, over four cells, not five.
 * @param root0 - Props.
 * @param root0.noteCell - Index of the cell carrying the note line. Defaults to
 * FleetSummary's flagged-cancelled cell; the cancellations strip puts it first.
 * @param root0.verdict - Mirror FleetSummary's verdict panel.
 * @returns The KPI strip placeholder.
 */
export function KpiStripSkeleton({
  noteCell,
  verdict = false,
}: { noteCell?: number; verdict?: boolean } = {}): JSX.Element {
  // The on-time cell moves into the panel, so flagged-cancelled is one earlier.
  const note = noteCell ?? (verdict ? 2 : 3);
  return (
    <div className="border border-at-border bg-at-surface">
      {verdict && (
        <div className="space-y-3 border-b border-at-border p-4">
          <Bone className="h-4 w-20" />
          <Bone className="h-12 w-40 sm:h-15 sm:w-52" />
          <Bone className="h-2 w-full max-w-xs" />
          <Bone className="h-10 w-96 max-w-full sm:h-5" />
        </div>
      )}
      <div
        className={cn(
          "grid grid-cols-2",
          verdict ? "lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-5",
        )}
      >
        {Array.from({ length: verdict ? 4 : 5 }).map((_, i) => (
          <div key={i} className="p-3">
            <Bone className="h-4 w-16" />
            <Bone className="h-7 w-20" />
            {i === note && <Bone className="h-4 w-24" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors the highlight cards (ShameOfDay, WorstRouteCard, WorstStopCard): a
 * `px-6 py-5` bordered column of a `text-xs` label, a `text-2xl` title row, a
 * `text-sm` summary and a `text-xs` footnote, 4px apart. The trip card puts its
 * headsign on a `text-base` line of its own under the title at every width, so
 * `withHeadsign` draws that line; its start time rides on the summary line. In
 * the Shame dashboard's grid (`narrow`) a typical headsign wraps to two lines
 * once the cards sit two or three across.
 * @param root0 - Props.
 * @param root0.withHeadsign - Mirror the trip card's headsign line.
 * @param root0.narrow - The card sits in the Shame grid, where the headsign wraps to two lines from `sm`.
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
      <Bone className="h-8 w-24" />
      {withHeadsign && (
        <Bone className={cn("h-6", narrow ? "w-full sm:h-12" : "w-48 max-w-full")} />
      )}
      <Bone className="h-5 w-64 max-w-full" />
      <Bone className="h-4 w-28" />
    </div>
  );
}

/**
 * Mirrors the home page's row of highlight cards: the trip, route and stop the
 * shame boards crown, in the same grid they sit in.
 * @returns The three-card grid placeholder.
 */
export function FeatureCardRowSkeleton(): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FeatureCardSkeleton withHeadsign narrow />
      <FeatureCardSkeleton />
      <FeatureCardSkeleton />
    </div>
  );
}

/**
 * Mirrors RankBoard's top ten: a `text-lg` heading (28px, `mb-1`), the caption
 * block (`mb-3`, 56px; every board captions itself, and the off-schedule line
 * wraps to two lines until the boards are `lg` wide), then ten `py-3` rows of a
 * 24px line split by 1px rules.
 * @param root0 - Props.
 * @param root0.colourKey - Whether the board is the signed one, which adds the
 * late/early colour key under its caption.
 * @param root0.deltas - Whether the board ranks against a previous period, which
 * widens the rank column from 20px to 56px to hold the movement badge.
 * @param root0.rows - How many rows to draw (the home boards show ten).
 * @returns The board placeholder.
 */
export function RankBoardSkeleton({
  colourKey = false,
  deltas = false,
  rows = 10,
}: {
  colourKey?: boolean;
  deltas?: boolean;
  rows?: number;
}): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface p-4">
      <Bone className="mb-1 h-7 w-44" />
      {/* Both boards caption themselves now, and the signed board adds a colour
          key under it, so the block is a fixed height on either. */}
      <div className="mb-3 h-14">
        <Bone className="h-10 w-80 max-w-full lg:h-5" />
        {colourKey && <Bone className="mt-1 h-4 w-56 max-w-full" />}
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
            {deltas ? (
              // The rank number and its movement badge, in the 56px column the
              // real row reserves for the pair.
              <span className="flex w-14 shrink-0 items-center gap-1">
                <Bone className="h-4 w-5" />
                <Bone className="h-4 w-8" />
              </span>
            ) : (
              <Bone className="h-4 w-5" />
            )}
            <Bone className="h-5 w-5 rounded-full" />
            <div className="flex h-6 flex-1 items-center">
              <Bone className="h-4 w-14" />
            </div>
            <Bone className="h-4 w-20" />
            {/* The row's trailing chevron, which sets where the value ends. */}
            <Bone className="h-4 w-4 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mirrors the home page's mode chips and school-bus toggle, the row above the
 * verdict strip.
 * @returns The filter row.
 */
export function HomeFiltersSkeleton(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-2">
        <ChipBone className="w-11" />
        <ChipBone className="w-12" />
        <ChipBone className="w-15" />
      </div>
      <ChipBone className="w-27" />
    </div>
  );
}

/**
 * Mirrors RankingsHeader: the `text-lg` "Route rankings" heading with the
 * All/Late/Early delay chips at the right (wrapping under it on a phone).
 * @returns The heading row.
 */
export function RankingsHeaderSkeleton(): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Bone className="h-7 w-36" />
      <div className="flex flex-wrap gap-2">
        <ChipBone className="w-11" />
        <ChipBone className="w-14" />
        <ChipBone className="w-16" />
      </div>
    </div>
  );
}

/**
 * Mirrors VehicleCards: two bordered cards, each a `text-xs` eyebrow over a
 * figure per mode (a 16px label line and a `text-2xl sm:text-3xl` number), then
 * the one-line train note.
 * @param root0 - Props.
 * @param root0.modes - How many mode figures each card shows (1 or 3).
 * @param root0.trainNote - Whether the train note line follows.
 * @returns The cards placeholder.
 */
export function VehicleCardsSkeleton({
  modes = 3,
  trainNote = true,
}: {
  modes?: number;
  trainNote?: boolean;
}): JSX.Element {
  const card = (
    <div className="flex flex-col gap-4 border border-at-border bg-at-surface px-6 py-5">
      <Bone className="h-4 w-32" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: modes }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Bone className="h-4 w-14" />
            <Bone className="h-8 w-16 sm:h-9" />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {card}
        {card}
      </div>
      {trainNote && <Bone className="h-8 w-full max-w-xl sm:h-4" />}
    </>
  );
}

/**
 * Mirrors ShameHeader's three rows: the red title over its `mt-0.5 text-sm`
 * subtitle beside the Day/Week/Month chips and the day stepper, then the
 * Trips/Routes/Stops tabs, then the mode and school chips.
 * @param root0 - Props.
 * @param root0.twoLineSubtitle - Whether the subtitle wraps to two lines below `sm`.
 * @returns The header placeholder.
 */
export function ShameHeaderSkeleton({
  twoLineSubtitle = false,
}: {
  twoLineSubtitle?: boolean;
}): JSX.Element {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TitleBone className="w-64" />
          <Bone className={cn("mt-0.5 w-80 max-w-full", twoLineSubtitle ? "h-10 sm:h-5" : "h-5")} />
        </div>
        {/* The window controls, drawn as the home page draws its own. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <ChipBone className="w-13" />
            <ChipBone className="w-16" />
            <ChipBone className="w-18" />
          </div>
          <DayNavSkeleton />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <ChipBone className="w-15" />
        <ChipBone className="w-17" />
        <ChipBone className="w-15" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <ChipBone className="w-12" />
          <ChipBone className="w-13" />
          <ChipBone className="w-16" />
          <ChipBone className="w-16" />
        </div>
        <ChipBone className="w-28" />
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

/** Stops in the placeholder strip: a typical bus route's length. */
const STRIP_BONE_ROWS = 40;

/**
 * Mirrors RouteStrip: the `text-lg` heading (`mb-3`), the figure columns'
 * headings over a rule, then one 32px row per stop with its ring, name and
 * two figures. The real length depends on the route, so this is a typical
 * one: a single column on a phone, two from `lg`, as the strip breaks there.
 * @returns The diagram placeholder.
 */
export function LineDiagramSkeleton(): JSX.Element {
  return (
    <div className="border border-at-border bg-at-surface p-4">
      <Bone className="mb-3 h-7 w-32" />
      <div className="lg:grid lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[auto_repeat(20,2rem)] lg:gap-x-10">
        {[0, 1].map((col) => (
          <div
            key={col}
            className={cn(
              "flex justify-end gap-3 border-b border-at-border pb-1.5 lg:row-start-1",
              col === 0 ? "lg:col-start-1" : "hidden lg:col-start-2 lg:flex",
            )}
          >
            <Bone className="h-4 w-22" />
            <Bone className="h-4 w-22" />
          </div>
        ))}
        {Array.from({ length: STRIP_BONE_ROWS }, (_, i) => (
          <div key={i} className="flex h-8 items-center gap-3 pl-2.5">
            <Bone className="size-3.5 shrink-0 rounded-full" />
            <Bone className="ml-3 h-3.5 w-36" />
            <Bone className="ml-auto h-3.5 w-14" />
            <Bone className="h-3.5 w-14" />
          </div>
        ))}
      </div>
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
