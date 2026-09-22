// src/components/VehiclesSection.tsx
// The home page's vehicles band: how many buses, trains and ferries ran the
// routes, over the page's window and since the archive began.

import { ModeIcon } from "@/components/ModeIcon";
import { SectionLink } from "@/components/SectionLink";
import { getVehicleCounts, getVehicleCountsAllTime, TODAY_REVALIDATE } from "@/lib/data";
import { DATA_START_SHORT } from "@/lib/data-start";
import type { DateRange } from "@/lib/time";
import { VEHICLE_MODES, type VehicleCounts, type VehicleMode } from "@/lib/vehicle-counts";
import type { JSX } from "react";

const NOUN: Record<VehicleMode, [string, string]> = {
  BUS: ["bus", "buses"],
  TRAIN: ["train", "trains"],
  FERRY: ["ferry", "ferries"],
};

/**
 * The modes a filtered page shows: just the chosen one, or all three.
 * @param mode - Mode filter, or null for every mode.
 * @returns The modes in display order.
 */
export function vehicleModesShown(mode: VehicleMode | null): readonly VehicleMode[] {
  return mode ? [mode] : VEHICLE_MODES;
}

/**
 * Coupled trains need a word: AT's feed puts each run on one unit, so a train
 * is counted by that unit and a unit coupled behind it is never seen.
 */
export const TRAIN_COUNT_NOTE =
  "Trains are counted by the unit carrying each run; a unit coupled behind it is not seen.";

/**
 * One card: an eyebrow naming the span, then a figure per mode.
 * @param props - Component props.
 * @param props.eyebrow - The span the figures cover.
 * @param props.counts - Distinct vehicles per mode.
 * @param props.modes - Which modes to show.
 * @returns The card.
 */
function VehicleCard({
  eyebrow,
  counts,
  modes,
}: {
  eyebrow: string;
  counts: VehicleCounts;
  modes: readonly VehicleMode[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4 border border-at-border bg-at-surface px-6 py-5">
      <p className="text-xs font-semibold tracking-zero text-at-muted uppercase">{eyebrow}</p>
      <dl className="grid grid-cols-3 gap-4">
        {modes.map((m) => (
          <div key={m} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-xs tracking-zero text-at-muted uppercase">
              <ModeIcon mode={m} className="h-4 w-4" />
              {NOUN[m][counts[m] === 1 ? 0 : 1]}
            </dt>
            <dd className="text-2xl font-ultra tracking-zero text-at-ink tabular-nums sm:text-3xl">
              {counts[m].toLocaleString("en-NZ")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The two vehicle cards, one for the page's window and one since the archive
 * began, under the page's mode and school filters, then the train note.
 * @param props - Component props.
 * @param props.range - The window the page shows.
 * @param props.label - How the window is named on its card ("Today", a date, a week).
 * @param props.mode - Mode filter, or null for every mode.
 * @param props.includeSchool - Whether school services are included.
 * @returns The cards.
 */
export async function VehicleCards({
  range,
  label,
  mode,
  includeSchool,
}: {
  range: DateRange;
  label: string;
  mode: VehicleMode | null;
  includeSchool: boolean;
}): Promise<JSX.Element> {
  const filter = { mode, includeSchool };
  const [inWindow, allTime] = await Promise.all([
    getVehicleCounts(range, filter, TODAY_REVALIDATE),
    getVehicleCountsAllTime(filter, TODAY_REVALIDATE),
  ]);
  const modes = vehicleModesShown(mode);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <VehicleCard eyebrow={label} counts={inWindow} modes={modes} />
        <VehicleCard
          eyebrow={`All time, since ${DATA_START_SHORT}`}
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
