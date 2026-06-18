"use client";

import dynamic from "next/dynamic";
import type { JSX } from "react";

/**
 * Placeholder shown while the Leaflet map chunk loads.
 * @returns A pulsing skeleton box.
 */
function MapSkeleton(): JSX.Element {
  return <div className="h-100 animate-pulse rounded-lg bg-at-bg" />;
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
  }>;
  /** Per-variant stop-coordinate sequences drawn as the route path. */
  routeLines?: Array<Array<[number, number]>>;
  /** When set, the map polls and plots live vehicles for this route. */
  routeId?: string;
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
