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

/** The route's transport mode; picks the vehicle glyph. */
type RouteMode = "BUS" | "TRAIN" | "FERRY";

/**
 * Inner SVG markup for each mode's vehicle glyph, on a 24x24 grid. Windows are
 * knocked out in white so they read against the marker's white disc; every other
 * shape inherits the marker colour. Authored in the AT visual style (the brand
 * asset pack ships no mode pictograms).
 */
const MODE_GLYPHS: Record<RouteMode, string> = {
  BUS:
    '<rect x="4" y="4" width="16" height="13" rx="2.5"/>' +
    '<rect x="6" y="7" width="5" height="4" rx="0.6" fill="#fff"/>' +
    '<rect x="13" y="7" width="5" height="4" rx="0.6" fill="#fff"/>' +
    '<circle cx="8" cy="18" r="1.7"/><circle cx="16" cy="18" r="1.7"/>',
  TRAIN:
    '<rect x="5" y="3" width="14" height="15" rx="3.5"/>' +
    '<rect x="7" y="6" width="10" height="5" rx="1" fill="#fff"/>' +
    '<circle cx="9" cy="14.3" r="1.3" fill="#fff"/><circle cx="15" cy="14.3" r="1.3" fill="#fff"/>' +
    '<rect x="6.6" y="18" width="2.1" height="3.2" rx="1" transform="rotate(22 7.6 19.6)"/>' +
    '<rect x="15.3" y="18" width="2.1" height="3.2" rx="1" transform="rotate(-22 16.4 19.6)"/>',
  FERRY:
    '<path d="M4 13h16l-1.5 4.6a3 3 0 0 1-2.1 2 2 2 0 0 1-1.8-.5 1.8 1.8 0 0 0-2.4 0 2 2 0 0 1-1.8.5 3 3 0 0 1-2.1-2Z"/>' +
    '<rect x="7" y="6" width="10" height="6" rx="1"/>' +
    '<rect x="8.8" y="8" width="2.4" height="2.6" fill="#fff"/>' +
    '<rect x="12.8" y="8" width="2.4" height="2.6" fill="#fff"/>' +
    '<rect x="11" y="3" width="2" height="3" rx="0.5"/>',
};

/**
 * A live-vehicle `divIcon`: a white disc ringed in the delay colour, the route's
 * mode glyph centred and upright, and (when a heading is known) a same-coloured
 * arrow on the ring pointing the way the vehicle is travelling.
 * @param L - The Leaflet module.
 * @param opts - Marker options.
 * @param opts.colour - Delay colour for the ring, glyph, and arrow.
 * @param opts.mode - Route mode selecting the glyph (defaults to bus).
 * @param opts.bearing - Compass heading in degrees (0 = north), or null.
 * @returns A Leaflet divIcon.
 */
function vehicleIcon(
  L: typeof import("leaflet"),
  opts: { colour: string; mode: RouteMode; bearing: number | null },
): Leaflet.DivIcon {
  const glyph = MODE_GLYPHS[opts.mode] ?? MODE_GLYPHS.BUS;
  // Arrow sits on the ring's top edge, then the whole group rotates to the bearing.
  const arrow =
    opts.bearing == null
      ? ""
      : `<g transform="rotate(${Math.round(opts.bearing)} 18 18)">` +
        `<path d="M18 0.5 L22.5 6.5 L13.5 6.5 Z" fill="${opts.colour}"/></g>`;
  const html =
    `<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">` +
    arrow +
    `<circle cx="18" cy="18" r="12" fill="#fff" stroke="${opts.colour}" stroke-width="3"/>` +
    `<g transform="translate(9 9) scale(0.75)" fill="${opts.colour}">${glyph}</g>` +
    `</svg>`;
  return L.divIcon({ className: "vehicle-marker", html, iconSize: [36, 36], iconAnchor: [18, 18] });
}

/**
 * Leaflet route map: the route's path (straight lines between stops in order),
 * its stops as black-outlined nodes coloured by average delay, and the live
 * vehicles as mode-glyph markers in a punctuality-coloured ring (late = Anther
 * Red, early = Bright Green, on-time = Shore) with a heading arrow.
 * @param root0 - Props object.
 * @param root0.stops - Stops to plot (each with id, name, lat, lon, and delay info).
 * @param root0.routeLines - Per-variant stop-coordinate sequences for the path.
 * @param root0.routeId - When set, poll and plot live vehicles for this route.
 * @param root0.mode - Route transport mode, selecting the live-vehicle glyph.
 * @param root0.className - Optional extra classes for the container.
 * @returns Map container element.
 */
export default function StopMap({
  stops,
  routeLines = [],
  routeId,
  mode = "BUS",
  className,
}: {
  stops: StopPoint[];
  routeLines?: RouteLine[];
  routeId?: string;
  mode?: RouteMode;
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
            // Mode glyph in a delay-coloured ring; a same-coloured arrow on the
            // ring points the heading when the feed reports one.
            const marker = L.marker([veh.lat, veh.lon], {
              icon: vehicleIcon(L, { colour, mode, bearing: veh.bearing }),
            });
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
  }, [stops, routeLines, routeId, mode]);

  return <div ref={divRef} className={cn("w-full bg-at-bg", className)} />;
}
