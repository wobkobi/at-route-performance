"use client";
// src/components/StopMapWrapper.tsx
/**
 * @description Client wrapper that lazy-loads the Leaflet stop map with a skeleton placeholder.
 */

import dynamic from "next/dynamic";
import type { JSX } from "react";

/**
 * Placeholder shown while the Leaflet chunk loads. Fills its parent (`h-full`)
 * rather than a fixed height, so it inherits the caller's height from the
 * wrapper div - the dynamic `loading` option can't read props, so a hardcoded
 * height here would mismatch callers and cause a jump when the map swaps in.
 * @returns A pulsing skeleton box.
 */
function MapPlaceholder(): JSX.Element {
  return <div className="h-full w-full animate-pulse bg-at-bg" />;
}

// ssr: false defers the Leaflet chunk to the client.
const StopMap = dynamic(() => import("@/components/StopMap"), {
  ssr: false,
  loading: MapPlaceholder,
});

interface StopMapWrapperProps {
  stops: Array<{
    stop_id: string;
    name: string;
    lat: number;
    lon: number;
    avg_delay_sec: number | null;
    on_time_pct: number | null;
    /** Average absolute deviation (off-by); when set, the popup shows it too. */
    avg_abs_delay_sec?: number | null;
  }>;
  /** Per-variant stop-coordinate sequences drawn as the route path. */
  routeLines?: Array<Array<[number, number]>>;
  /** When set, the map polls and plots live vehicles for this route. */
  routeId?: string;
  /** Route transport mode, selecting the live-vehicle glyph. */
  mode?: "BUS" | "TRAIN" | "FERRY";
  /** When set, the map centres on this stop and opens its popup. */
  selectedStopId?: string;
  /** When set, only the live vehicle whose tripId matches is shown. */
  filterTripId?: string;
  /**
   * When set, only live vehicles whose `directionId` is in this list are shown.
   * Pass all raw GTFS direction ids that alias to the active direction.
   */
  filterDirectionIds?: number[];
  className?: string;
}

/**
 * Client wrapper for {@link StopMap} that enables `ssr: false` in the dynamic
 * import. Owns the map height via a wrapper div so the map and its loading
 * placeholder share it (no layout jump when the Leaflet chunk swaps in).
 * @param props - Component props (stop data plus the props {@link StopMap} accepts).
 * @param props.className - Height/size classes applied to the wrapper div.
 * @returns The sized map container.
 */
export default function StopMapWrapper({ className, ...props }: StopMapWrapperProps): JSX.Element {
  // The wrapper owns the height so both the map and its loading placeholder
  // (h-full) match it - no jump when the Leaflet chunk swaps in.
  return (
    <div className={className}>
      <StopMap {...props} className="h-full w-full" />
    </div>
  );
}
