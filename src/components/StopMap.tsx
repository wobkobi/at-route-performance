"use client";

import { cn } from "@/lib/cn";
import { formatDelay } from "@/lib/format";
import type { LiveVehicle } from "@/lib/vehicles";
import type * as Leaflet from "leaflet";
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

/** A route variant's path: stop coordinates in schedule order. */
type RouteLine = Array<[number, number]>;

/** Vehicles beyond this many seconds off schedule are coloured late/early. */
const VEHICLE_THRESHOLD = 120;

/** How often to refresh live vehicle positions while the tab is visible. */
const POLL_MS = 60_000;

/**
 * Compact delay label for a bus map marker, e.g. `4m late` / `3m early`.
 * @param sec - Signed deviation in seconds (negative early, positive late).
 * @returns A short label rounded to the nearest minute.
 */
function busLabel(sec: number): string {
  const mins = Math.max(1, Math.round(Math.abs(sec) / 60));
  return `${mins}m ${sec > 0 ? "late" : "early"}`;
}

/**
 * Resolve a CSS custom property on the document root to its concrete value.
 * Leaflet draws on canvas/SVG, not via classes, so markers read the AT palette
 * tokens from globals.css this way.
 * @param name - Custom property name, e.g. "--color-at-late".
 * @returns The trimmed computed value.
 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A rotatable arrow `divIcon` for a live bus, pointing to its compass heading.
 * The triangle points north at 0deg, so a wrapper rotation of `bearing` aims it
 * along the direction of travel; fill is the delay colour with a white halo.
 * @param L - The Leaflet module.
 * @param bearing - Compass heading in degrees (0 = north).
 * @param colour - Fill colour for the arrow.
 * @returns A Leaflet divIcon.
 */
function arrowIcon(L: typeof import("leaflet"), bearing: number, colour: string): Leaflet.DivIcon {
  const svg =
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">` +
    `<path d="M12 2 L20 21 L12 16 L4 21 Z" fill="${colour}" stroke="#fff" stroke-width="1.6" ` +
    `stroke-linejoin="round"/></svg>`;
  return L.divIcon({
    className: "bus-arrow-wrap",
    html: `<div class="bus-arrow" style="transform: rotate(${Math.round(bearing)}deg)">${svg}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/**
 * Leaflet route map: the route's path (straight lines between stops in order),
 * its stops as black-outlined nodes coloured by average delay, and the live
 * vehicles as heading arrows coloured by punctuality (late = Anther Red,
 * early = Bright Green, on-time = Shore).
 * @param root0 - Props object.
 * @param root0.stops - Stops to plot (each with id, name, lat, lon, and delay info).
 * @param root0.routeLines - Per-variant stop-coordinate sequences for the path.
 * @param root0.routeId - When set, poll and plot live vehicles for this route.
 * @param root0.className - Optional extra classes for the container.
 * @returns Map container element.
 */
export default function StopMap({
  stops,
  routeLines = [],
  routeId,
  className,
}: {
  stops: StopPoint[];
  routeLines?: RouteLine[];
  routeId?: string;
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let map: Leaflet.Map | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();

    (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");
      if (cancelled || !divRef.current) return;

      const lateColour = cssVar("--color-at-late") || "#de0a2b";
      const earlyColour = cssVar("--color-at-early") || "#95c11f";
      const ontimeColour = cssVar("--color-at-ontime") || "#0073bd";
      const inkColour = cssVar("--color-at-ink") || "#001930";
      const shoreColour = cssVar("--color-at-shore") || "#0073bd";

      map = L.map(divRef.current);
      // CARTO basemaps allow app/embedded use; OSM's volunteer tile servers block
      // it (403, "Referer is required by tile usage policy"). Positron is clean and
      // light, which suits the AT palette.
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: "© OpenStreetMap contributors © CARTO",
      }).addTo(map);

      // Route path: straight segments between consecutive stops (AT exposes stop
      // order but no road geometry). Drawn first so stops/buses sit on top.
      for (const line of routeLines) {
        if (line.length > 1) {
          L.polyline(line, { color: shoreColour, weight: 3, opacity: 0.45 }).addTo(map);
        }
      }

      for (const s of stops) {
        const v = s.avg_delay_sec ?? 0;
        const colour = v > 5 ? lateColour : v < -5 ? earlyColour : ontimeColour;
        // Black outline so the coloured stop nodes pop against the light basemap.
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 5,
          color: inkColour,
          fillColor: colour,
          fillOpacity: 0.85,
          weight: 2,
        });
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = s.name;
        const avg = s.avg_delay_sec == null ? "—" : formatDelay(s.avg_delay_sec);
        popup.append(
          title,
          document.createElement("br"),
          document.createTextNode(`Avg delay: ${avg}`),
        );
        marker.bindPopup(popup);
        marker.addTo(map);
      }

      // Frame the map to the stops (falling back to the route lines, else NZ).
      const boundsPoints: Leaflet.LatLngExpression[] = [
        ...stops.map((s) => [s.lat, s.lon] as [number, number]),
        ...routeLines.flat(),
      ];
      if (boundsPoints.length) {
        map.fitBounds(L.latLngBounds(boundsPoints).pad(0.1));
      } else {
        map.setView([-36.8485, 174.7633], 12);
      }

      if (!routeId) return;

      // Live vehicles: a dedicated layer we clear and redraw on each poll.
      const vehicleLayer = L.layerGroup().addTo(map);

      /**
       * Fetch the route's live vehicles and redraw the vehicle layer.
       * @returns Resolves once the layer has been refreshed.
       */
      const refresh = async (): Promise<void> => {
        try {
          const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/vehicles`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!res.ok) return;
          const data = (await res.json()) as { vehicles: LiveVehicle[] };
          if (cancelled || !map) return;
          vehicleLayer.clearLayers();
          for (const veh of data.vehicles) {
            const d = veh.delaySec;
            const colour =
              d == null
                ? ontimeColour
                : d > VEHICLE_THRESHOLD
                  ? lateColour
                  : d < -VEHICLE_THRESHOLD
                    ? earlyColour
                    : ontimeColour;
            // With a heading, show a rotated arrow pointing the way the bus is
            // travelling; without one, fall back to a white-ringed dot.
            const marker =
              veh.bearing == null
                ? L.circleMarker([veh.lat, veh.lon], {
                    radius: 8,
                    color: "#ffffff",
                    weight: 2,
                    fillColor: colour,
                    fillOpacity: 1,
                  })
                : L.marker([veh.lat, veh.lon], { icon: arrowIcon(L, veh.bearing, colour) });
            // Permanently label the late/early buses (the ones worth tracking);
            // on-time buses stay an unlabelled marker to keep the map readable.
            if (d != null && Math.abs(d) > VEHICLE_THRESHOLD) {
              marker.bindTooltip(busLabel(d), {
                permanent: true,
                direction: "right",
                offset: [6, 0],
                className: "bus-delay-label",
              });
            }
            const popup = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = veh.label ?? veh.vehicleId;
            popup.append(
              title,
              document.createElement("br"),
              document.createTextNode(d == null ? "No live delay" : formatDelay(d)),
            );
            marker.bindPopup(popup);
            marker.addTo(vehicleLayer);
          }
        } catch {
          // Aborted on unmount or a transient fetch error; ignore.
        }
      };

      await refresh();
      // Poll on the interval, but skip while the tab is hidden so a backgrounded
      // page makes no upstream calls.
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
      map?.remove();
    };
  }, [stops, routeLines, routeId]);

  return <div ref={divRef} className={cn("w-full bg-at-bg", className)} />;
}
