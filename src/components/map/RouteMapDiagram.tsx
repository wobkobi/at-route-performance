"use client";
// src/components/map/RouteMapDiagram.tsx
// Plot a route's stops on the map via the stop map wrapper.

import { MapMarkKey, StopDotKey } from "@/components/map/MapLegend";
import StopMapWrapper from "@/components/map/StopMapWrapper";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { modeOrBus } from "@/lib/mode";
import type { MapStop } from "@/lib/route/view";
import type { JSX } from "react";

/** Props for {@link RouteMapDiagram}. */
export interface RouteMapDiagramProps {
  /** Stops to plot (already direction-filtered by the page). */
  stops: MapStop[];
  /** Per-direction road path lines. */
  routeLines: Array<Array<[number, number]>>;
  /** Route id, keying the saved viewport and the live-vehicle poll. */
  routeId: string;
  /** Plot where the route's vehicles are now; off for a past day or week. */
  live: boolean;
  /** Route mode (live-vehicle glyph + delay colour banding). */
  mode: string;
  /** The route's GTFS colour (hex, no hash), for its lines; null for its mode's colour. */
  colour: string | null;
  /**
   * When set, only live vehicles whose `directionId` is in this list are shown.
   * Pass all raw GTFS direction ids that alias to the active direction.
   */
  filterDirectionIds?: number[];
  /** The day a stop's popup link opens on, or undefined for today or a week. */
  stopDay?: string;
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
 * @param props.colour - The route's GTFS colour, for its lines.
 * @param props.filterDirectionIds - Raw GTFS direction ids aliasing the active direction.
 * @param props.stopDay - The day a stop's popup link opens on.
 * @returns The map section.
 */
export function RouteMapDiagram({
  stops,
  routeLines,
  routeId,
  live,
  mode,
  colour,
  filterDirectionIds,
  stopDay,
}: RouteMapDiagramProps): JSX.Element {
  if (stops.length === 0) {
    return (
      <Panel pad="sm">
        <SectionHeading>Route map</SectionHeading>
        <EmptyState inset className="mt-2">
          No stops to plot yet. The map fills in once this route records arrivals.
        </EmptyState>
      </Panel>
    );
  }
  return (
    <Panel pad="sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>Route map</SectionHeading>
        <StopDotKey />
      </div>
      <StopMapWrapper
        stops={stops}
        routeLines={routeLines}
        routeId={routeId}
        live={live}
        mode={modeOrBus(mode)}
        colour={colour}
        filterDirectionIds={filterDirectionIds}
        stopLinks
        stopDay={stopDay}
        className="h-[min(31.25rem,60svh)]"
      />
      <MapMarkKey live={live} />
    </Panel>
  );
}
