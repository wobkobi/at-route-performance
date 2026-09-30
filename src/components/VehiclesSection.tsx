// src/components/VehiclesSection.tsx
// The home page's vehicles band: how many buses, trains and ferries ran the
// routes, over the page's window and since the archive began.

import { ModeIcon } from "@/components/ModeIcon";
import { SectionLink } from "@/components/SectionLink";
import { getVehicleCounts, getVehicleCountsAllTime, TODAY_REVALIDATE } from "@/lib/data";
import { formatCount } from "@/lib/format";
import { MODES, modeWord, type Mode } from "@/lib/mode";
import { type SchoolFilter } from "@/lib/school-bus";
import { DATA_START_SHORT } from "@/lib/time/data-start";
import type { DateRange } from "@/lib/time/service-day";
import { hourRangeClock, type HourRange } from "@/lib/time/time-of-day";
import type { VehicleCounts } from "@/lib/vehicle/counts";
import type { JSX } from "react";

/**
 * The modes a filtered page shows: just the chosen one, or all three.
 * @param mode - Mode filter, or null for every mode.
 * @returns The modes in display order.
 */
export function vehicleModesShown(mode: Mode | null): readonly Mode[] {
  return mode ? [mode] : MODES;
}

/**
 * Coupled trains need a word: AT's feed puts each run on one unit, so a train
 * is counted by that unit and a unit coupled behind it is never seen.
 */
export const TRAIN_COUNT_NOTE =
  "Trains are counted by the unit carrying each run; a unit coupled behind it is not seen.";

/**
 * One span's figures: an eyebrow naming the span on a hairline, then a figure
 * per mode. Same shape as the fleet strip - a rule, a label, then the numbers -
 * so the two read as one set rather than as two kinds of container.
 * @param props - Component props.
 * @param props.eyebrow - The span the figures cover.
 * @param props.counts - Distinct vehicles per mode.
 * @param props.modes - Which modes to show.
 * @returns The column.
 */
function VehicleCard({
  eyebrow,
  counts,
  modes,
}: {
  eyebrow: string;
  counts: VehicleCounts;
  modes: readonly Mode[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 border-t border-at-border pt-4">
      <p className="at-eyebrow text-at-muted">{eyebrow}</p>
      <dl className="grid grid-cols-3 gap-4">
        {modes.map((m) => (
          <div key={m} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-xs tracking-zero text-at-muted uppercase">
              <ModeIcon mode={m} className="h-4 w-4" />
              {modeWord(m, counts[m] !== 1)}
            </dt>
            <dd className="text-2xl font-ultra tracking-zero text-at-ink tabular-nums sm:text-3xl">
              {formatCount(counts[m])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The two vehicle cards, one for the page's window and one since the archive
 * began, under the page's mode, school and time-of-day filters, then the train
 * note. With a part of the day set, both count only vehicles on runs due in
 * those hours, and both eyebrows name them.
 * @param props - Component props.
 * @param props.range - The window the page shows.
 * @param props.label - How the window is named on its card ("Today", a date, a week).
 * @param props.mode - Mode filter, or null for every mode.
 * @param props.schools - Which school services count (default leave them out).
 * @param props.hours - Part of the day to count, or null/undefined for all of it.
 * @param props.live - Whether the window is the day still under way, so a range
 *   running to the day's end reads "to now".
 * @returns The cards.
 */
export async function VehicleCards({
  range,
  label,
  mode,
  schools,
  hours = null,
  live = false,
}: {
  range: DateRange;
  label: string;
  mode: Mode | null;
  schools: SchoolFilter;
  hours?: HourRange | null;
  live?: boolean;
}): Promise<JSX.Element> {
  const filter = { mode, schools };
  const [inWindow, allTime] = await Promise.all([
    getVehicleCounts(range, filter, TODAY_REVALIDATE, hours),
    getVehicleCountsAllTime(filter, TODAY_REVALIDATE, hours),
  ]);
  const modes = vehicleModesShown(mode);
  /**
   * The eyebrow's suffix naming the part of the day, or nothing with none set.
   * All time passes false: every earlier day ran to its end, never "to now".
   * @param runsLive - Whether the span runs into the day still under way.
   * @returns E.g. ", 7am to 10am".
   */
  const within = (runsLive: boolean): string =>
    hours ? `, ${hourRangeClock(hours, runsLive)}` : "";
  return (
    <>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <VehicleCard eyebrow={`${label}${within(live)}`} counts={inWindow} modes={modes} />
        <VehicleCard
          eyebrow={`All time, since ${DATA_START_SHORT}${within(false)}`}
          counts={allTime}
          modes={modes}
        />
      </div>
      {modes.includes("TRAIN") && <p className="text-xs text-at-muted">{TRAIN_COUNT_NOTE}</p>}
    </>
  );
}

/**
 * The vehicles band's heading, linking to the hardest-worked vehicles board. It
 * sits outside the Suspense boundary so it never waits on the counts.
 * @param props - Component props.
 * @param props.href - The vehicles board, carrying the page's window and filters.
 * @returns The heading.
 */
export function VehiclesHeading({ href }: { href: string }): JSX.Element {
  return <SectionLink title="Vehicles on the routes" href={href} />;
}
