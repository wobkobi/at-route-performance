"use client";

import dynamic from "next/dynamic";
import type { JSX } from "react";

/**
 * Placeholder shown while the Leaflet map chunk loads.
 * @returns A pulsing skeleton box.
 */
function MapSkeleton(): JSX.Element {
  return <div className="h-125 animate-pulse bg-at-bg" />;
}

const StopMap = dynamic(() => import("@/components/StopMap"), {
  ssr: false,
  loading: MapSkeleton,
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
 * Client component wrapper for StopMap to enable ssr: false in dynamic import.
 * @param props - Stop data and optional className
 * @returns StopMap component
 */
export default function StopMapWrapper(props: StopMapWrapperProps): JSX.Element {
  return <StopMap {...props} />;
}
