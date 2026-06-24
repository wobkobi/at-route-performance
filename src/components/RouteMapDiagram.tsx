"use client";

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
  /** Route id, so the map polls and plots live vehicles. */
  routeId: string;
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
 * live vehicle markers. Returns null when there are no stops to plot.
 * @param props - Component props.
 * @param props.stops - Stops to plot on the map.
 * @param props.routeLines - Per-direction road path lines.
 * @param props.routeId - Route id for live vehicles.
 * @param props.mode - Route mode.
 * @param props.filterDirectionIds - Raw GTFS direction ids aliasing the active direction.
 * @returns The map section, or null when no stops are available.
 */
export function RouteMapDiagram({
  stops,
  routeLines,
  routeId,
  mode,
  filterDirectionIds,
}: RouteMapDiagramProps): JSX.Element | null {
  if (stops.length === 0) return null;
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-ultra tracking-zero">Route map</h2>
        <span className="flex items-center gap-3 text-xs text-at-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-late" /> late
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-early" /> early
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-at-ontime" /> on time
          </span>
        </span>
      </div>
      <StopMapWrapper
        stops={stops}
        routeLines={routeLines}
        routeId={routeId}
        mode={mode as "BUS" | "TRAIN" | "FERRY"}
        filterDirectionIds={filterDirectionIds}
        className="h-125"
      />
    </section>
  );
}
