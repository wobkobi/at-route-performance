"use client";

import { RouteLineDiagram } from "@/components/RouteLineDiagram";
import type { RoutePattern } from "@/types/api";
import { useMemo, type JSX } from "react";

/** Props for {@link RouteLineDiagramClient}. */
interface RouteLineDiagramClientProps {
  /** Stopping patterns per direction (already direction-filtered). */
  directions: RoutePattern["directions"];
  /** Stop id to average delay - plain object so it crosses the server boundary. */
  delayByStop: Record<string, number | null>;
  /** Stop id to display name - plain object so it crosses the server boundary. */
  nameByStop: Record<string, string>;
  /** Route mode, for per-mode on-time colour banding. */
  mode: string;
  /** Stop IDs named in an active service alert (serialisable array; converted to Set internally). */
  alertStopIds?: string[];
  /** True when there is an active DETOUR alert for this route - dashes the SVG route lines. */
  hasDetour?: boolean;
}

/**
 * Server-boundary adapter for {@link RouteLineDiagram}: accepts serialisable
 * plain objects and rebuilds the Maps the diagram component requires.
 * @param props - Component props.
 * @param props.directions - Stopping patterns per direction.
 * @param props.delayByStop - Stop id to average delay.
 * @param props.nameByStop - Stop id to display name.
 * @param props.mode - Route mode.
 * @param props.alertStopIds - Stop ids with active alerts (drawn with a warning badge).
 * @param props.hasDetour - When true, dashes the route lines to indicate a detour.
 * @returns The line diagram, or null when there are no directions to render.
 */
export function RouteLineDiagramClient({
  directions,
  delayByStop,
  nameByStop,
  mode,
  alertStopIds,
  hasDetour,
}: RouteLineDiagramClientProps): JSX.Element | null {
  const delayMap = useMemo(() => new Map(Object.entries(delayByStop)), [delayByStop]);
  const nameMap = useMemo(() => new Map(Object.entries(nameByStop)), [nameByStop]);
  const alertSet = useMemo(
    () => (alertStopIds ? new Set(alertStopIds) : undefined),
    [alertStopIds],
  );
  if (Object.keys(directions).length === 0) return null;
  return (
    <RouteLineDiagram
      directions={directions}
      delayByStop={delayMap}
      nameByStop={nameMap}
      mode={mode}
      alertStopIds={alertSet}
      hasDetour={hasDetour}
    />
  );
}
