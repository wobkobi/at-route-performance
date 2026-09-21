"use client";
// src/components/RouteMapDiagram.tsx
// Plot a route's stops on the map via the stop map wrapper.

import { MapMarkKey, StopDotKey } from "@/components/MapLegend";
import StopMapWrapper from "@/components/StopMapWrapper";
import type { JSX } from "react";

/** A stop plotted on the route map (the shape {@link StopMapWrapper} expects). */
interface MapStopView {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

/** Props for {@link RouteMapDiagram}. */
export interface RouteMapDiagramProps {
  /** Stops to plot (already direction-filtered by the page). */
  stops: MapStopView[];
  /** Per-direction road path lines. */
  routeLines: Array<Array<[number, number]>>;
  /** Route id, keying the saved viewport and the live-vehicle poll. */
  routeId: string;
  /** Plot where the route's vehicles are now; off for a past day or week. */
  live: boolean;
  /** Route mode (live-vehicle glyph + delay colour banding). */
  mode: string;
  /**
   * When set, only live vehicles whose `directionId` is in this list are shown.
   * Pass all raw GTFS direction ids that alias to the active direction.
   */
  filterDirectionIds?: number[];
}

/**
 * Route map section: stop pins coloured by delay, road-path polylines, and
 * live vehicle markers. With no stops to plot the section stays, saying so.
 * @param props - Component props.
 * @param props.stops - Stops to plot on the map.
 * @param props.routeLines - Per-direction road path lines.
 * @param props.routeId - Route id for the saved viewport and live vehicles.
 * @param props.live - Whether to plot live vehicles.
 * @param props.mode - Route mode.
 * @param props.filterDirectionIds - Raw GTFS direction ids aliasing the active direction.
 * @returns The map section.
 */
export function RouteMapDiagram({
  stops,
  routeLines,
  routeId,
  live,
  mode,
  filterDirectionIds,
}: RouteMapDiagramProps): JSX.Element {
  if (stops.length === 0) {
    return (
      <section className="border border-at-border bg-at-surface p-4">
        <h2 className="text-lg font-ultra tracking-zero">Route map</h2>
        <p className="mt-2 text-sm text-at-muted">
          No stops to plot yet. The map fills in once this route records arrivals.
        </p>
      </section>
    );
  }
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-ultra tracking-zero">Route map</h2>
        <StopDotKey />
      </div>
      <StopMapWrapper
        stops={stops}
        routeLines={routeLines}
        routeId={routeId}
        live={live}
        mode={mode as "BUS" | "TRAIN" | "FERRY"}
        filterDirectionIds={filterDirectionIds}
        className="h-125"
      />
      <MapMarkKey live={live} />
    </section>
  );
}
