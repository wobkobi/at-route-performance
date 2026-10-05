"use client";
// src/components/map/StopMapWrapper.tsx
// Client wrapper that lazy-loads the Leaflet stop map with a skeleton placeholder.

import type { FocusVehicle, OffRoutePoint } from "@/components/map/StopMap";
import type { Mode } from "@/lib/mode";
import type { MapStop } from "@/lib/route/view";
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
  return (
    <div
      role="status"
      aria-label="Loading the map"
      className="h-full w-full animate-pulse bg-at-bg motion-reduce:animate-none"
    />
  );
}

// ssr: false defers the Leaflet chunk to the client.
const StopMap = dynamic(() => import("@/components/map/StopMap"), {
  ssr: false,
  loading: MapPlaceholder,
});

interface StopMapWrapperProps {
  stops: MapStop[];
  /** Per-variant stop-coordinate sequences drawn as the route path. */
  routeLines?: Array<Array<[number, number]>>;
  /** Route id, keying the saved viewport and the live-vehicle poll. */
  routeId?: string;
  /** Poll and plot the route's live vehicles; set only when the view covers now. */
  live?: boolean;
  /** Route transport mode, selecting the live-vehicle glyph. */
  mode?: Mode;
  /** The route is a school service, whose vehicles take the school bus glyph. */
  school?: boolean;
  /** When set, the map centres on this stop and opens its popup. */
  selectedStopId?: string;
  /** When set, only the live vehicle whose tripId matches is shown. */
  filterTripId?: string;
  /** The vehicle the page is about: the map opens on it and haloes its marker. */
  focusVehicle?: FocusVehicle;
  /**
   * When set, only live vehicles whose `directionId` is in this list are shown.
   * Pass all raw GTFS direction ids that alias to the active direction.
   */
  filterDirectionIds?: number[];
  /** Readings of the vehicle off its road path, in time order (trip map). */
  offRoute?: OffRoutePoint[];
  /** Link each stop's popup name to its page; off leaves names unlinked. */
  stopLinks?: boolean;
  /** The day those links open on, or undefined for today. */
  stopDay?: string;
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
