"use client";
// src/components/LiveMapWrapper.tsx
// Client wrapper that lazy-loads the live network map with a placeholder of the
// same height, as StopMapWrapper does for the route maps.

import type { LiveMode } from "@/lib/live-routes";
import dynamic from "next/dynamic";
import type { JSX } from "react";

/**
 * Placeholder while the Leaflet chunk loads; fills the wrapper's height.
 * @returns A pulsing box.
 */
function MapPlaceholder(): JSX.Element {
  return <div className="h-full w-full animate-pulse bg-at-bg motion-reduce:animate-none" />;
}

// ssr: false defers the Leaflet chunk to the client.
const LiveMap = dynamic(() => import("@/components/LiveMap"), {
  ssr: false,
  loading: MapPlaceholder,
});

/**
 * The live map, sized by its wrapper so the placeholder and the map match.
 * @param props - Component props.
 * @param props.mode - Show one mode's vehicles, or null for every mode.
 * @param props.className - Height classes for the wrapper.
 * @returns The sized map.
 */
export default function LiveMapWrapper({
  mode,
  className,
}: {
  mode: LiveMode | null;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <LiveMap mode={mode} className="h-full w-full" />
    </div>
  );
}
