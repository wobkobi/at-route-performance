"use client";

import { cn } from "@/lib/cn";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { JSX } from "react";
import { useEffect, useRef } from "react";

/** Stop for map rendering */
interface StopPoint {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
}

/**
 * Resolve a CSS custom property on the document root to its concrete value.
 * Used so Leaflet markers (drawn on canvas/SVG, not via classes) reuse the AT
 * palette tokens defined in globals.css.
 * @param name - Custom property name, e.g. "--color-at-late".
 * @returns The trimmed computed value.
 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Leaflet map of stops, coloured by punctuality
 * (late = Anther Red, early = Bright Green, on-time = Shore).
 * @param root0 - Props object.
 * @param root0.stops - Stops to plot (each with id, name, lat, lon, and delay info).
 * @param root0.className - Optional extra classes for the container.
 * @returns Map container element.
 */
export default function StopMap({
  stops,
  className,
}: {
  stops: StopPoint[];
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let map: Leaflet.Map | null = null;

    (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");

      const lateColour = cssVar("--color-at-late");
      const earlyColour = cssVar("--color-at-early");
      const ontimeColour = cssVar("--color-at-ontime");

      const center: Leaflet.LatLngExpression = stops.length
        ? [stops[0].lat, stops[0].lon]
        : [-36.8485, 174.7633];

      map = L.map(divRef.current as HTMLDivElement).setView(center, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      for (const s of stops) {
        const v = s.avg_delay_sec ?? 0;
        const colour = v > 5 ? lateColour : v < -5 ? earlyColour : ontimeColour;
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 6,
          color: colour,
          fillColor: colour,
          fillOpacity: 0.8,
          weight: 1,
        });
        marker.bindPopup(
          `<strong>${s.name}</strong><br/>Avg delay: ${
            s.avg_delay_sec == null ? "—" : Math.round(s.avg_delay_sec)
          }s<br/>On-time: ${s.on_time_pct == null ? "—" : s.on_time_pct.toFixed(1) + "%"}`,
        );
        marker.addTo(map);
      }
    })();

    return () => {
      map?.remove();
    };
  }, [stops]);

  return <div ref={divRef} className={cn("w-full bg-at-bg", className)} />;
}
