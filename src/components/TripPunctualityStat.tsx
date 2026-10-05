import { InfoPopover, StatCell, type PunctualityStatProps } from "@/components/PunctualityStat";
import { formatCount, formatPct, plural, UNKNOWN_VALUE } from "@/lib/format";
import {
  MIN_JUDGED_TRIPS,
  PUNCTUAL_DEFINITION,
  punctualJudged,
  punctualPct,
  RELIABLE_DEFINITION,
  reliablePct,
  TRIP_MEASURES_BASIS,
  TRIP_MEASURES_SOURCE,
  type PunctualityCounts,
} from "@/lib/trip/punctuality";
import { Suspense, type JSX } from "react";

/** What AT's two trip measures mean, in one paragraph, for a breakdown with no rows to define. */
const TRIP_PUNCTUALITY_HINT = `${TRIP_MEASURES_SOURCE} Punctual: ${PUNCTUAL_DEFINITION} Reliable: ${RELIABLE_DEFINITION} ${TRIP_MEASURES_BASIS}`;

/**
 * Which edge of the cell the breakdown lines up with: `start` (the default), `end` from `sm`
 * up for a cell last in its row, or `end-lg` for one that is full width until `lg` and last
 * in its row from there.
 */
export type TripPunctualityAlign = "start" | "end" | "end-lg";

/**
 * Whether a tally has enough trips behind it to print its shares.
 * @param counts - The tally, or null when the read failed.
 * @returns True at {@link MIN_JUDGED_TRIPS} or more.
 */
export function tripPunctualityShown(counts: PunctualityCounts | null): boolean {
  return counts !== null && punctualJudged(counts) >= MIN_JUDGED_TRIPS;
}

/**
 * One measure in the breakdown: its share, the trips it is out of, and what it means.
 * @param props - Row props.
 * @param props.label - The measure.
 * @param props.definition - What a trip has to do to meet it.
 * @param props.pct - Its share, or null with too few trips.
 * @param props.hit - Trips that met it.
 * @param props.of - Trips it is out of, cancelled ones included.
 * @returns The row.
 */
function MeasureRow({
  label,
  definition,
  pct,
  hit,
  of,
}: {
  label: string;
  definition: string;
  pct: number | null;
  hit: number;
  of: number;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-at-muted">{label}</span>
        <span className="text-xs text-at-muted tabular-nums">
          {formatCount(hit)} of {formatCount(of)}
        </span>
        <span className="w-14 text-right font-semibold tabular-nums">{formatPct(pct)}</span>
      </div>
      <p className="text-xs leading-snug text-at-muted">{definition}</p>
    </div>
  );
}

/**
 * The popover behind the info button: both measures with the counts they come from, and
 * what AT means by each.
 * @param props - Component props.
 * @param props.counts - The tally, or null when the read failed.
 * @param props.shown - Whether the tally is big enough to print shares.
 * @returns The breakdown.
 */
function TripBreakdown({
  counts,
  shown,
}: {
  counts: PunctualityCounts | null;
  shown: boolean;
}): JSX.Element {
  const judged = counts ? punctualJudged(counts) : 0;
  return (
    <>
      <p className="at-eyebrow text-at-muted">Of all trips</p>
      {counts && judged > 0 ? (
        <div className="mt-2 space-y-2 text-sm">
          <MeasureRow
            label="Punctual"
            definition={PUNCTUAL_DEFINITION}
            pct={shown ? punctualPct(counts) : null}
            hit={counts.punctual}
            of={judged}
          />
          <MeasureRow
            label="Reliable"
            definition={RELIABLE_DEFINITION}
            pct={shown ? reliablePct(counts) : null}
            hit={counts.reliable}
            of={counts.departed + counts.cancelled}
          />
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-at-muted">Cancelled</span>
            <span className="font-semibold tabular-nums">{formatCount(counts.cancelled)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-at-muted">
          {counts
            ? "No trips were timed in this window."
            : "The trip figures could not be read just now."}
        </p>
      )}
      {!shown && judged > 0 && (
        <p className="mt-2 text-xs leading-snug text-at-muted">
          Under {MIN_JUDGED_TRIPS} trips, one trip swings the share too far to print.
        </p>
      )}
      <p className="mt-2 text-xs leading-snug text-at-muted">
        {judged > 0 ? `${TRIP_MEASURES_SOURCE} ${TRIP_MEASURES_BASIS}` : TRIP_PUNCTUALITY_HINT}
      </p>
    </>
  );
}

/**
 * The line under the figure. A failed read, an empty tally and a small one each say which
 * they are, since all three print a dash. The trip count leads a shown figure because it is
 * the punctual share's base; the reliable share has its own, given in the breakdown.
 * @param counts - The tally, or null when the read failed.
 * @param shown - Whether the tally is big enough to print shares.
 * @returns The note.
 */
function tripNote(counts: PunctualityCounts | null, shown: boolean): string {
  if (!counts) return "Not available";
  const judged = punctualJudged(counts);
  if (shown) return `Of ${plural(judged, "trip")} · ${formatPct(reliablePct(counts))} reliable`;
  return judged > 0 ? `Only ${plural(judged, "trip")} to judge` : "No trips timed";
}

/**
 * AT's trip punctuality as a strip cell: the punctual share as the figure, its trip count
 * and the reliable share under it, and the breakdown behind an info button. A tally too
 * small to read prints a dash and says why.
 * @param props - Component props.
 * @param props.counts - The tally for what the strip covers, or null when the read failed.
 * @param props.size - Cell size, matching the stats beside it.
 * @param props.className - Wrapper classes, such as a column span.
 * @param props.align - Which edge of the cell the breakdown lines up with.
 * @returns The cell.
 */
export function TripPunctualityStat({
  counts,
  size = "lg",
  className,
  align = "start",
}: {
  counts: PunctualityCounts | null;
  size?: NonNullable<PunctualityStatProps["size"]>;
  className?: string;
  align?: TripPunctualityAlign;
}): JSX.Element {
  const shown = tripPunctualityShown(counts);
  return (
    <div className={className}>
      <StatCell
        label="Punctual trips"
        size={size}
        info={
          <InfoPopover
            label="Punctual trips"
            align={align === "end" ? "end" : "start"}
            // Start-aligned (`sm:left-0`) until `lg`, then flipped to the right edge.
            panelClassName={align === "end-lg" ? "lg:left-auto lg:right-0" : undefined}
          >
            <TripBreakdown counts={counts} shown={shown} />
          </InfoPopover>
        }
        note={tripNote(counts, shown)}
      >
        {shown && counts ? formatPct(punctualPct(counts)) : UNKNOWN_VALUE}
      </StatCell>
    </div>
  );
}

/** Props for {@link TripPunctualityStatStreamed}. */
interface StreamedProps {
  /** The tally, still loading; null when the read failed. */
  counts: Promise<PunctualityCounts | null>;
  size?: NonNullable<PunctualityStatProps["size"]>;
  className?: string;
  align?: TripPunctualityAlign;
}

/**
 * {@link TripPunctualityStat} behind its own Suspense boundary, so judging a running day's
 * trips never holds up the strip around it.
 * @param props - Component props.
 * @param props.counts - The tally, still loading.
 * @param props.size - Cell size.
 * @param props.className - Wrapper classes.
 * @param props.align - Which edge of the cell the breakdown lines up with.
 * @returns The cell, with a placeholder until the tally lands.
 */
export function TripPunctualityStatStreamed({
  counts,
  size = "lg",
  className,
  align,
}: StreamedProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className={className}>
          <StatCell label="Punctual trips" size={size} note="Loading">
            {UNKNOWN_VALUE}
          </StatCell>
        </div>
      }
    >
      <Resolved counts={counts} size={size} className={className} align={align} />
    </Suspense>
  );
}

/**
 * The cell once its tally has landed.
 * @param props - Component props.
 * @param props.counts - The tally, still loading.
 * @param props.size - Cell size.
 * @param props.className - Wrapper classes.
 * @param props.align - Which edge of the cell the breakdown lines up with.
 * @returns The cell.
 */
async function Resolved({ counts, size, className, align }: StreamedProps): Promise<JSX.Element> {
  return (
    <TripPunctualityStat counts={await counts} size={size} className={className} align={align} />
  );
}
