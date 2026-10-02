// src/components/map/MapLegend.tsx
// The keys for the stop, route and trip maps: stop dot colours beside the
// heading, and under the map what a live vehicle marker and an off-route line mean.
import { glyphFor } from "@/components/ModeIcon";
import { DotSwatch, SwatchKey, type SwatchKeyItem } from "@/components/ui/SwatchKey";
import { VEHICLE_CHEVRON } from "@/lib/map/vehicle-marker";
import type { Mode } from "@/lib/mode";
import type { JSX } from "react";

/**
 * The stop-dot colours, for the map section's heading row, and the small white
 * dot StopMap draws for a stop with no reading. The swatches must follow the
 * markers drawn in StopMap.
 * @param props - Component props.
 * @param props.noReading - List the no-reading dot; off where the map cannot show one.
 * @param props.lone - The map holds one stop, which StopMap rings in full even
 *   without a reading, so the swatch is ringed to match.
 * @returns The key.
 */
export function StopDotKey({
  noReading = true,
  lone = false,
}: {
  noReading?: boolean;
  lone?: boolean;
}): JSX.Element {
  const items: SwatchKeyItem[] = [
    { swatch: <DotSwatch className="bg-at-ontime" />, label: "On time" },
    { swatch: <DotSwatch className="bg-at-late" />, label: "Late" },
    { swatch: <DotSwatch className="bg-at-early" />, label: "Early" },
  ];
  if (noReading) {
    items.push({
      swatch: (
        <DotSwatch
          className={
            lone
              ? "border-2 border-at-ink bg-at-surface"
              : "size-2 border border-at-border bg-at-surface"
          }
        />
      ),
      label: "No reading",
    });
  }
  return <SwatchKey items={items} />;
}

/**
 * What the map's other marks mean, under the map. The vehicle entry draws a small
 * copy of the marker (ring, the route's glyph and the heading chevron) so the
 * words point at something the reader can match; it must follow vehicleMarkerHtml.
 * @param props - Component props.
 * @param props.live - The map shows live vehicles.
 * @param props.offRoute - The map draws off-route readings.
 * @param props.mode - The route's mode, for the marker's glyph.
 * @param props.school - The route is a school service, which takes the school bus glyph.
 * @returns The key, or null when the map has neither.
 */
export function MapMarkKey({
  live,
  offRoute = false,
  mode = "BUS",
  school = false,
}: {
  live: boolean;
  offRoute?: boolean;
  mode?: Mode;
  school?: boolean;
}): JSX.Element | null {
  const items: SwatchKeyItem[] = [];
  if (live) {
    const { Icon } = glyphFor(mode, school);
    items.push({
      key: "live",
      swatch: (
        <svg viewBox="0 0 40 40" className="-mt-1 h-8 w-8 shrink-0" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r="14"
            className="fill-at-surface stroke-at-late"
            strokeWidth="3"
          />
          <Icon x={10} y={10} size={20} className="text-at-late" />
          <path
            d={VEHICLE_CHEVRON}
            transform="rotate(45 20 20)"
            className="fill-at-late stroke-at-surface"
            strokeWidth="1.5"
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        </svg>
      ),
      label: (
        <>
          A vehicle on the route now, ringed in its delay colour (grey when there is no reading).
          The point shows which way it is heading, and a label beside it says how far off schedule
          it is once it is outside the on-time window.
        </>
      ),
    });
  }
  if (offRoute) {
    items.push({
      key: "off-route",
      swatch: (
        <span
          className="mt-2 inline-block w-4 shrink-0 border-t-2 border-dashed border-at-commercial"
          aria-hidden="true"
        />
      ),
      label: "Where the vehicle was seen off its route.",
    });
  }
  return <SwatchKey items={items} layout="list" className="mt-2" />;
}
