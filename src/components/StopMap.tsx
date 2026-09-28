"use client";
// src/components/StopMap.tsx
// Render a Leaflet map of stops and live vehicles with delay-coloured markers.

import { cn } from "@/lib/cn";
import { delayColour } from "@/lib/delay-colour";
import { UNKNOWN_VALUE, formatDelay, formatDuration } from "@/lib/format";
import { VERCEL_KEY_HOSTS, cartoTileUrl } from "@/lib/map-tiles";
import { wheelZoomOnHover } from "@/lib/map-wheel";
import { vehicleStatus, vehiclesOnMap } from "@/lib/vehicle-status";
import type { LiveVehicle } from "@/lib/vehicles";
import type * as Leaflet from "leaflet";
import type { JSX } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Stop for map rendering */
interface StopPoint {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  avg_delay_sec: number | null;
  on_time_pct: number | null;
  /** Average absolute deviation (off-by); when set, the popup shows it too. */
  avg_abs_delay_sec?: number | null;
}

/** A route variant's path: stop coordinates in schedule order. */
type RouteLine = Array<[number, number]>;

/** A vehicle reading off its trip's road path, drawn on the trip map. */
export interface OffRoutePoint {
  lat: number;
  lon: number;
  /** Tooltip text, e.g. "8:14 am, 420 m off route". */
  label: string;
}

/** Stable empty default for `offRoute`, so the redraw effect does not rerun on every render. */
const NO_OFF_ROUTE: OffRoutePoint[] = [];

/**
 * How often to refresh live vehicle positions while the tab is visible. The
 * server caches the AT feed for 120s, so polling faster only re-reads the cache.
 */
const POLL_MS = 120_000;

/** How long a vehicle takes to glide from its last polled position to its new one. */
const GLIDE_MS = 1000;

/** The word a vehicle marker's accessible name starts with. */
const MODE_WORD: Record<RouteMode, string> = { BUS: "Bus", TRAIN: "Train", FERRY: "Ferry" };

/** Options for a vehicle's floating delay label. */
const VEHICLE_TOOLTIP: Leaflet.TooltipOptions = {
  permanent: true,
  direction: "right",
  offset: [4, 0],
  className: "bus-delay-label",
};

/**
 * Zoom for focusing a single stop: a neighbourhood view that shows surrounding
 * context rather than street-level zoom.
 */
const STOP_FOCUS_ZOOM = 14;

/**
 * Haversine distance in kilometres between two WGS-84 coordinates.
 * @param lat1 - Latitude of point 1.
 * @param lon1 - Longitude of point 1.
 * @param lat2 - Latitude of point 2.
 * @param lon2 - Longitude of point 2.
 * @returns Distance in kilometres.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Resolve a CSS custom property on the document root to its concrete value.
 * Leaflet draws on canvas/SVG rather than via classes, so markers read the AT
 * palette tokens from globals.css this way.
 * @param name - Custom property name, e.g. "--color-at-late".
 * @returns The trimmed computed value.
 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Escape HTML special characters in external strings before inserting into popup HTML.
 * @param s - Raw string from external data.
 * @returns HTML-safe string.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The route's transport mode; picks the vehicle glyph. */
type RouteMode = "BUS" | "TRAIN" | "FERRY";

/**
 * Inner SVG markup for each mode's vehicle glyph, scaled to fit the 20x20 glyph
 * area inside the 40x40 marker disc. Each icon is scaled evenly by 20 over its
 * longer side and centred along the shorter one, so none is stretched:
 *   BUS   (FaBusAlt) 512x512 - scale(20/512)
 *   TRAIN (FaSubway) 448x512 - scale(20/512), 17.5 wide, so shifted 1.25 right
 *   FERRY (FaShip)   640x512 - scale(20/640), 16 tall, so shifted 2 down
 */
const MODE_GLYPHS: Record<RouteMode, string> = {
  BUS:
    '<g transform="scale(0.0390625)">' +
    '<path d="M488 128h-8V80c0-44.8-99.2-80-224-80S32 35.2 32 80v48h-8c-13.25 0-24 10.74-24 24v80c0 13.25 10.75 24 24 24h8v160c0 17.67 14.33 32 32 32v32c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-32h192v32c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-32h6.4c16 0 25.6-12.8 25.6-25.6V256h8c13.25 0 24-10.75 24-24v-80c0-13.26-10.75-24-24-24zM160 72c0-4.42 3.58-8 8-8h176c4.42 0 8 3.58 8 8v16c0 4.42-3.58 8-8 8H168c-4.42 0-8-3.58-8-8V72zm-48 328c-17.67 0-32-14.33-32-32s14.33-32 32-32 32 14.33 32 32-14.33 32-32 32zm128-112H128c-17.67 0-32-14.33-32-32v-96c0-17.67 14.33-32 32-32h112v160zm32 0V128h112c17.67 0 32 14.33 32 32v96c0 17.67-14.33 32-32 32H272zm128 112c-17.67 0-32-14.33-32-32s14.33-32 32-32 32 14.33 32 32-14.33 32-32 32z"/>' +
    "</g>",
  TRAIN:
    '<g transform="translate(1.25 0) scale(0.0390625)">' +
    '<path d="M448 96v256c0 51.815-61.624 96-130.022 96l62.98 49.721C386.905 502.417 383.562 512 376 512H72c-7.578 0-10.892-9.594-4.957-14.279L130.022 448C61.82 448 0 403.954 0 352V96C0 42.981 64 0 128 0h192c65 0 128 42.981 128 96zM200 232V120c0-13.255-10.745-24-24-24H72c-13.255 0-24 10.745-24 24v112c0 13.255 10.745 24 24 24h104c13.255 0 24-10.745 24-24zm200 0V120c0-13.255-10.745-24-24-24H272c-13.255 0-24 10.745-24 24v112c0 13.255 10.745 24 24 24h104c13.255 0 24-10.745 24-24zm-48 56c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48zm-256 0c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48z"/>' +
    "</g>",
  FERRY:
    '<g transform="translate(0 2) scale(0.03125)">' +
    '<path d="M496.616 372.639l70.012-70.012c16.899-16.9 9.942-45.771-12.836-53.092L512 236.102V96c0-17.673-14.327-32-32-32h-64V24c0-13.255-10.745-24-24-24H248c-13.255 0-24 10.745-24 24v40h-64c-17.673 0-32 14.327-32 32v140.102l-41.792 13.433c-22.753 7.313-29.754 36.173-12.836 53.092l70.012 70.012C125.828 416.287 85.587 448 24 448c-13.255 0-24 10.745-24 24v16c0 13.255 10.745 24 24 24 61.023 0 107.499-20.61 143.258-59.396C181.677 487.432 216.021 512 256 512h128c39.979 0 74.323-24.568 88.742-59.396C508.495 491.384 554.968 512 616 512c13.255 0 24-10.745 24-24v-16c0-13.255-10.745-24-24-24-60.817 0-101.542-31.001-119.384-75.361zM192 128h256v87.531l-118.208-37.995a31.995 31.995 0 0 0-19.584 0L192 215.531V128z"/>' +
    "</g>",
};

/**
 * A live-vehicle `divIcon`: a white disc ringed in the delay colour, the route's
 * mode glyph centred and upright, and (when a heading is known) a same-coloured
 * chevron over the top of the ring pointing the way the vehicle is travelling.
 * The chevron is the route arrows' shape, drawn after the disc with a white edge
 * so the ring cannot hide it and it reads over any tile; no chevron means the
 * feed gave no heading.
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
  const arrow =
    opts.bearing == null
      ? ""
      : `<g transform="rotate(${Math.round(opts.bearing)} 20 20)">` +
        `<path d="M20 0.75 L27.5 10 L20 7 L12.5 10 Z" fill="${opts.colour}" stroke="#fff" ` +
        `stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/></g>`;
  const html =
    `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">` +
    `<circle cx="20" cy="20" r="14" fill="#fff" stroke="${opts.colour}" stroke-width="3"/>` +
    `<g transform="translate(10 10)" fill="${opts.colour}">${glyph}</g>` +
    arrow +
    `</svg>`;
  // The tooltip anchor sits just past the ring (radius 14 plus half the 3px
  // stroke), so a label bound to the right starts beside the disc rather than
  // over it. A divIcon's default anchor is its centre.
  return L.divIcon({
    className: "vehicle-marker",
    html,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    tooltipAnchor: [16, 0],
  });
}

/**
 * A small filled-triangle arrow `divIcon` pointing along a bearing (degrees
 * clockwise from north) to show a route line's travel direction.
 * @param L - The Leaflet module.
 * @param colour - Fill colour (the line colour).
 * @param bearing - Heading in degrees (0 = north) of the underlying segment.
 * @returns A Leaflet divIcon.
 */
function arrowIcon(L: typeof import("leaflet"), colour: string, bearing: number): Leaflet.DivIcon {
  const html =
    `<svg viewBox="0 0 14 14" width="22" height="22" aria-hidden="true">` +
    `<g transform="rotate(${Math.round(bearing)} 7 7)">` +
    `<path d="M7 3.5 L11 10.5 L7 7 L3 10.5 Z" fill="${colour}"/></g></svg>`;
  return L.divIcon({ className: "route-arrow", html, iconSize: [22, 22], iconAnchor: [11, 11] });
}

/**
 * Scans forward then backward from `start` along `line` to find the nearest
 * index at least 40m from every stop circle, so direction arrows don't land
 * on top of a stop marker.
 * @param line - Polyline coordinate array `[lat, lon][]`.
 * @param start - Candidate index.
 * @param stops - Stop points to keep clear of.
 * @returns The first clear index found, or `start` when no clear spot exists.
 */
function clearArrowIdx(line: [number, number][], start: number, stops: StopPoint[]): number {
  const CLEARANCE_KM = 0.04;
  for (const dir of [1, -1]) {
    for (let offset = 0; offset < line.length; offset++) {
      const idx = start + dir * offset;
      if (idx < 1 || idx >= line.length) continue;
      const point = line[idx];
      if (point === undefined) continue;
      const [lat, lon] = point;
      if (!stops.some((s) => haversineKm(lat, lon, s.lat, s.lon) < CLEARANCE_KM)) return idx;
    }
  }
  return start;
}

/** AT palette colours resolved once from CSS custom properties. */
interface MapColours {
  late: string;
  early: string;
  ontime: string;
  /** A vehicle with no live delay, so it never reads as on time. */
  muted: string;
  ink: string;
  shore: string;
  border: string;
  surface: string;
  /** Off-route readings (AT Commercial orange). */
  offRoute: string;
}

/**
 * Read AT colour tokens from the computed style of the document root.
 * @returns Current theme colour values.
 */
function readColours(): MapColours {
  return {
    late: cssVar("--color-at-late") || "#de0a2b",
    // The vehicle ring, glyph and arrow are thin marks on white, so they take
    // the darker early; the brand green is about 2.1:1 there.
    early: cssVar("--color-at-early-strong") || "#5b7a12",
    ontime: cssVar("--color-at-ontime") || "#0073bd",
    muted: cssVar("--color-at-muted") || "#667583",
    ink: cssVar("--color-at-ink") || "#001930",
    shore: cssVar("--color-at-shore") || "#0073bd",
    border: cssVar("--color-at-border") || "#c7ced6",
    surface: cssVar("--color-at-surface") || "#ffffff",
    offRoute: cssVar("--color-at-commercial") || "#f7941f",
  };
}

/** All Leaflet objects created on mount, kept alive for the component lifetime. */
interface MapState {
  L: typeof import("leaflet");
  map: Leaflet.Map;
  colours: MapColours;
  routeLayer: Leaflet.LayerGroup;
  offRouteLayer: Leaflet.LayerGroup;
  stopLayer: Leaflet.LayerGroup;
  vehicleLayer: Leaflet.LayerGroup;
  markerById: Map<string, Leaflet.CircleMarker>;
  /** Live vehicle markers by vehicle id, reused from one poll to the next. */
  vehicles: Map<string, VehicleEntry>;
}

/** A live vehicle's marker and what it last showed, so a poll changes only what moved. */
interface VehicleEntry {
  marker: Leaflet.Marker;
  /** Colour, mode and heading the icon was built from; a new icon only when they change. */
  iconKey: string;
  label: string | null;
}

/**
 * Let a marker and its label slide to the next position rather than jump. The
 * transition is switched on only for the length of one glide: left on, it would
 * also drag the marker behind every zoom, when Leaflet repositions it.
 * @param marker - The vehicle marker about to move.
 */
function glide(marker: Leaflet.Marker): void {
  const els = [marker.getElement(), marker.getTooltip()?.getElement()].filter(
    (el): el is HTMLElement => el != null,
  );
  for (const el of els) el.classList.add("vehicle-gliding");
  setTimeout(() => {
    for (const el of els) el.classList.remove("vehicle-gliding");
  }, GLIDE_MS);
}

/**
 * Bring the vehicle markers in line with one poll, keyed by vehicle id. A vehicle
 * already on the map keeps its marker and glides to its new position, so an open
 * popup, a hover and keyboard focus all survive the poll; its icon, label and
 * popup change only where the poll changed them. A vehicle missing from the poll
 * is removed, and a new one is added.
 * @param state - The map state holding the vehicle layer and markers.
 * @param vehicles - The vehicles to show, already filtered to this map.
 * @param mode - The route's mode, which sets the glyph and the on-time window.
 */
function syncVehicles(state: MapState, vehicles: LiveVehicle[], mode: RouteMode): void {
  const { L, colours } = state;
  const seen = new Set<string>();
  for (const veh of vehicles) {
    seen.add(veh.vehicleId);
    // One verdict for the ring, the label and the popup, on the same mode-aware
    // window as every figure on the page.
    const status = vehicleStatus(veh.delaySec, mode);
    const colour = status.band === "unknown" ? colours.muted : colours[status.band];
    const bearing = veh.bearing == null ? null : Math.round(veh.bearing);
    const iconKey = `${colour}|${mode}|${bearing}`;
    const cars = veh.cars ? `${veh.cars} cars` : null;
    const popup =
      `<strong>${esc(veh.label ?? veh.vehicleId)}</strong>` +
      (cars ? ` &middot; ${cars}` : "") +
      `<br>${esc(status.detail)}`;
    // Leaflet makes each marker a focusable button, and the icon's svg is hidden
    // from assistive tech, so the name has to be set on the element itself.
    const name = [
      `${MODE_WORD[mode] ?? "Vehicle"} ${veh.label ?? veh.vehicleId}`,
      cars,
      status.detail,
    ]
      .filter(Boolean)
      .join(", ");

    const entry = state.vehicles.get(veh.vehicleId);
    if (!entry) {
      // Vehicles and route arrows share the marker pane, where Leaflet stacks by
      // latitude; the offset keeps every vehicle above every arrow.
      const marker = L.marker([veh.lat, veh.lon], {
        icon: vehicleIcon(L, { colour, mode, bearing }),
        zIndexOffset: 1000,
      });
      if (status.label) marker.bindTooltip(status.label, VEHICLE_TOOLTIP);
      marker.bindPopup(popup);
      marker.addTo(state.vehicleLayer);
      marker.getElement()?.setAttribute("aria-label", name);
      state.vehicles.set(veh.vehicleId, { marker, iconKey, label: status.label });
      continue;
    }

    const { marker } = entry;
    const prev = marker.getLatLng();
    if (prev.lat !== veh.lat || prev.lng !== veh.lon) {
      glide(marker);
      marker.setLatLng([veh.lat, veh.lon]);
    }
    // A divIcon reuses its element when replaced, so focus stays on the marker.
    if (entry.iconKey !== iconKey) {
      marker.setIcon(vehicleIcon(L, { colour, mode, bearing }));
      entry.iconKey = iconKey;
    }
    if (entry.label !== status.label) {
      if (status.label == null) marker.unbindTooltip();
      else if (entry.label == null) marker.bindTooltip(status.label, VEHICLE_TOOLTIP);
      else marker.setTooltipContent(status.label);
      entry.label = status.label;
    }
    marker.setPopupContent(popup);
    marker.getElement()?.setAttribute("aria-label", name);
  }
  for (const [id, entry] of state.vehicles) {
    if (seen.has(id)) continue;
    state.vehicleLayer.removeLayer(entry.marker);
    state.vehicles.delete(id);
  }
}

/**
 * Remove every live vehicle marker, when polling stops.
 * @param state - The map state holding the vehicle layer and markers.
 */
function clearVehicles(state: MapState): void {
  state.vehicleLayer.clearLayers();
  state.vehicles.clear();
}

/**
 * Redraw the route polylines and direction arrows into `layer`, clearing what
 * was there before. Separated from the stop layer so direction-filter changes
 * can update one without touching the other.
 * @param state - Live map state (L, layer, colours).
 * @param routeLines - Per-variant coordinate sequences.
 * @param stops - Stops to keep arrows clear of.
 */
function drawRouteLayer(state: MapState, routeLines: RouteLine[], stops: StopPoint[]): void {
  const { L, routeLayer, colours } = state;
  routeLayer.clearLayers();
  for (const [lineIdx, line] of routeLines.entries()) {
    if (line.length < 2) continue;
    L.polyline(line, {
      color: colours.shore,
      weight: 4,
      opacity: 0.8,
      smoothFactor: 1.5,
    }).addTo(routeLayer);
    // Two arrows staggered by line index so inbound/outbound don't overlap.
    const shift = (lineIdx % 2) * 0.15;
    const rawIdxs = [
      ...new Set(
        [0.3 + shift, 0.65 + shift].map((f) =>
          Math.max(1, Math.round(Math.min(f, 0.95) * (line.length - 1))),
        ),
      ),
    ];
    for (const i of rawIdxs.map((idx) => clearArrowIdx(line, idx, stops))) {
      // clearArrowIdx only returns indices in [1, line.length), so both ends of
      // the segment exist; the guard makes that explicit to the type checker.
      const from = line[i - 1];
      const to = line[i];
      if (from === undefined || to === undefined) continue;
      const [aLat, aLon] = from;
      const [bLat, bLon] = to;
      const bearing =
        (Math.atan2((bLon - aLon) * Math.cos((aLat * Math.PI) / 180), bLat - aLat) * 180) / Math.PI;
      L.marker([(aLat + bLat) / 2, (aLon + bLon) / 2], {
        icon: arrowIcon(L, colours.shore, bearing),
        interactive: false,
        keyboard: false,
      }).addTo(routeLayer);
    }
  }
}

/**
 * Redraw the off-route readings: a dashed orange line through them in time
 * order, and a dot with its time and distance at each.
 * @param state - Live map state.
 * @param points - The readings, in time order.
 */
function drawOffRouteLayer(state: MapState, points: OffRoutePoint[]): void {
  const { L, offRouteLayer, colours } = state;
  offRouteLayer.clearLayers();
  if (points.length > 1) {
    L.polyline(
      points.map((p) => [p.lat, p.lon] as [number, number]),
      { color: colours.offRoute, weight: 3, dashArray: "6 6", opacity: 0.9 },
    ).addTo(offRouteLayer);
  }
  for (const p of points) {
    L.circleMarker([p.lat, p.lon], {
      radius: 6,
      color: colours.ink,
      fillColor: colours.offRoute,
      fillOpacity: 1,
      weight: 1.5,
    })
      .bindTooltip(esc(p.label))
      .addTo(offRouteLayer);
  }
}

/**
 * Redraw the stop circle markers into `layer`, clearing what was there before.
 * Updates `markerById` in-place so later `panToStop` calls can find markers by id.
 * @param state - Live map state.
 * @param stops - Stops to render.
 * @param mode - Route mode, for the delay colour band.
 */
function drawStopLayer(state: MapState, stops: StopPoint[], mode: RouteMode): void {
  const { L, stopLayer, colours, markerById } = state;
  stopLayer.clearLayers();
  markerById.clear();
  for (const s of stops) {
    const hasData = s.avg_delay_sec != null;
    const marker = L.circleMarker(
      [s.lat, s.lon],
      hasData
        ? {
            radius: 6,
            color: colours.ink,
            fillColor: delayColour(s.avg_delay_sec, mode),
            fillOpacity: 1,
            weight: 2,
          }
        : {
            radius: 4,
            color: colours.border,
            fillColor: colours.surface,
            fillOpacity: 1,
            weight: 1.5,
          },
    );
    // A signed mean, so the window is not applied: it prints its distance rather than "on time",
    // which would contradict the "Off by" figure beside it.
    const net =
      s.avg_delay_sec == null ? UNKNOWN_VALUE : formatDelay(s.avg_delay_sec, { thresholdSec: 0 });
    const popup =
      s.avg_abs_delay_sec != null
        ? `<strong>${esc(s.name)}</strong><br>Early or late: ${net}<br>Off by: ${formatDuration(s.avg_abs_delay_sec)} avg`
        : `<strong>${esc(s.name)}</strong><br>Early or late: ${net}`;
    marker.bindPopup(popup);
    marker.addTo(stopLayer);
    markerById.set(s.stop_id, marker);
  }
}

/**
 * Set the initial map viewport: fit all stops and route lines, or a single stop
 * at neighbourhood zoom, or central Auckland when there is nothing to frame.
 * @param state - Live map state.
 * @param stops - Route stops (lat/lon bounds).
 * @param routeLines - Route path bounds.
 */
function setInitialViewport(state: MapState, stops: StopPoint[], routeLines: RouteLine[]): void {
  const { L, map } = state;
  const pts: Leaflet.LatLngExpression[] = [
    ...stops.map((s) => [s.lat, s.lon] as [number, number]),
    ...routeLines.flat(),
  ];
  const [only] = pts;
  if (pts.length === 1 && only !== undefined) {
    map.setView(only, STOP_FOCUS_ZOOM);
  } else if (pts.length > 1) {
    map.fitBounds(L.latLngBounds(pts).pad(0.1));
  } else {
    map.setView([-36.8485, 174.7633], 12);
  }
}

/**
 * Leaflet route map: the route's path as offset coloured polylines, stop circles
 * coloured by average delay, and live vehicles as mode-glyph markers with a
 * heading arrow. Clicking a diagram stop smoothly pans the map without rebuilding
 * it.
 * @param root0 - Props object.
 * @param root0.stops - Stops to plot.
 * @param root0.routeLines - Per-variant stop-coordinate sequences for the path.
 * @param root0.routeId - Route id, keying the live-vehicle poll.
 * @param root0.live - Poll and plot live vehicles; only for a view that covers now.
 * @param root0.mode - Route transport mode, selecting the live-vehicle glyph.
 * @param root0.selectedStopId - When set, smoothly pan to this stop and open its popup.
 * @param root0.filterTripId - When set, only show the live vehicle for this trip.
 * @param root0.filterDirectionIds - Raw GTFS direction ids to restrict the displayed path.
 * @param root0.offRoute - Readings of the vehicle off its road path, in time order (trip map).
 * @param root0.className - Optional extra classes for the container div.
 * @returns Map container element.
 */
export default function StopMap({
  stops,
  routeLines = [],
  routeId,
  live = false,
  mode = "BUS",
  selectedStopId,
  filterTripId,
  filterDirectionIds,
  offRoute = NO_OFF_ROUTE,
  className,
}: {
  stops: StopPoint[];
  routeLines?: RouteLine[];
  routeId?: string;
  live?: boolean;
  mode?: RouteMode;
  selectedStopId?: string;
  filterTripId?: string;
  filterDirectionIds?: number[];
  offRoute?: OffRoutePoint[];
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<MapState | null>(null);
  // Set once the async map setup has finished, so the vehicle poll can start.
  const [ready, setReady] = useState(false);
  // The last vehicle poll failed, so the positions shown (if any) are not current.
  const [vehiclesFailed, setVehiclesFailed] = useState(false);
  // The mount-only vehicle poll words each vehicle's delay by mode; a ref keeps
  // the current mode reachable without rebuilding the map when the prop changes.
  const modeRef = useRef<RouteMode>(mode);

  // Always-current prop values read by the async vehicle polling callback so it
  // never uses stale closures from the effect that set it up.
  const latestRef = useRef({
    stops,
    routeLines,
    routeId,
    live,
    mode,
    selectedStopId,
    filterTripId,
    filterDirectionIds,
    offRoute,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      stops,
      routeLines,
      routeId,
      live,
      mode,
      selectedStopId,
      filterTripId,
      filterDirectionIds,
      offRoute,
    };
  });

  // --- Effect 1: initialise map once -------------------------------------------
  // Creates the Leaflet instance and layer groups, draws the initial content and
  // sets up the viewport. Tears down on unmount only.
  useEffect(() => {
    let dead = false;

    void (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");
      if (dead || !divRef.current) return;

      const colours = readColours();
      /*
        Leaflet's always-on wheel zoom and one-finger drag would take a scroll the
        reader meant for the page - on a phone the map is most of the viewport. So
        one-finger drag is off on touch (pinch and the zoom buttons still work),
        and the wheel zooms only once the mouse has settled on the map.
      */
      const map = L.map(divRef.current, {
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
      });
      wheelZoomOnHover(map);
      // The key goes out only where CARTO accepts it (see cartoTileUrl).
      const tiles = cartoTileUrl(
        window.location.host,
        process.env.NEXT_PUBLIC_CARTO_API_KEY,
        VERCEL_KEY_HOSTS,
      );
      L.tileLayer(tiles, {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: "© OpenStreetMap contributors © CARTO",
        // The site-wide Referrer-Policy is same-origin, which strips the Referer
        // from tile requests and fails a host-restricted CARTO key. Send the
        // origin only (no page path) to the tile host.
        referrerPolicy: "strict-origin-when-cross-origin",
      }).addTo(map);

      const state: MapState = {
        L,
        map,
        colours,
        routeLayer: L.layerGroup().addTo(map),
        offRouteLayer: L.layerGroup().addTo(map),
        stopLayer: L.layerGroup().addTo(map),
        vehicleLayer: L.layerGroup().addTo(map),
        markerById: new Map(),
        vehicles: new Map(),
      };
      stateRef.current = state;

      // Draw initial content from the current prop values.
      const { stops: s0, routeLines: rl0, mode: m0 } = latestRef.current;
      drawRouteLayer(state, rl0, s0);
      drawOffRouteLayer(state, latestRef.current.offRoute);
      drawStopLayer(state, s0, m0);

      // No saved view: every visit frames the route afresh, so a zoom left on one
      // visit never carries into the next.
      setInitialViewport(state, s0, rl0);

      /*
        Focus a stop the caller actually asked for. This used to key on
        `filterTripId` and focus `s0[0]`, which meant every trip map opened zoomed
        on the trip's first stop with that stop's popup up - a framing nobody chose
        and a popup nobody clicked, hiding the run the page is about. Effect 3 does
        the same job once the map is live; this covers a stop selected before the
        map finished loading.
      */
      const sel0 = latestRef.current.selectedStopId;
      if (sel0) {
        const m = state.markerById.get(sel0);
        if (m) {
          map.setView(m.getLatLng(), Math.max(map.getZoom(), STOP_FOCUS_ZOOM));
          m.openPopup();
        }
      }

      setReady(true);
    })();

    return () => {
      dead = true;
      stateRef.current?.map.remove();
      stateRef.current = null;
    };
  }, []);

  // --- Effect 2: update route + stop layers when stops/lines/mode change --------
  // Runs after init (stateRef is set) without rebuilding the map. On the route
  // page, props are server-rendered and stable; on direction-filter changes the
  // page navigates, so this mainly guards against any parent re-renders.
  useEffect(() => {
    modeRef.current = mode;
    const state = stateRef.current;
    if (!state) return;
    drawRouteLayer(state, routeLines, stops);
    drawOffRouteLayer(state, offRoute);
    drawStopLayer(state, stops, mode);
  }, [stops, routeLines, mode, offRoute]);

  // --- Effect 3: smooth-pan to the selected stop (no map rebuild) ---------------
  // A flyTo with a short duration keeps the context visible while centering.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !selectedStopId) return;
    const marker = state.markerById.get(selectedStopId);
    if (!marker) return;
    state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), STOP_FOCUS_ZOOM), {
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      duration: 0.4,
    });
    marker.openPopup();
  }, [selectedStopId]);

  // --- Effect 4: poll live vehicles while the view covers now ------------------
  // A past day's map shows where vehicles are right now, not where they were, so
  // only a live view polls. Keyed on `live` and `routeId`, so a view that turns
  // live after mount starts polling, and one that stops being live clears its
  // vehicles. A hidden tab skips its polls, so returning to it polls straight away
  // when the last positions are a full poll old.
  useEffect(() => {
    const state = stateRef.current;
    if (!ready || !state || !live || !routeId) return;
    let dead = false;
    const ctrl = new AbortController();
    let lastPoll = 0;

    /** Fetch the route's vehicles and move the markers, reading current props. */
    const poll = async (): Promise<void> => {
      lastPoll = Date.now();
      const {
        stops: pollStops,
        routeLines: pollLines,
        filterTripId: pollFTrip,
        filterDirectionIds: pollFDirs,
        mode: pollMode,
      } = latestRef.current;
      try {
        const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/vehicles`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (dead) return;
        if (!res.ok) {
          setVehiclesFailed(true);
          return;
        }
        const data = (await res.json()) as { vehicles: LiveVehicle[] };
        if (dead) return;
        setVehiclesFailed(false);

        const vehicles = vehiclesOnMap(data.vehicles, {
          tripId: pollFTrip,
          directionIds: pollFDirs,
          lines: pollLines,
          stops: pollStops,
        });
        syncVehicles(state, vehicles, pollMode);
      } catch {
        // An abort on cleanup is not a failure; anything else is.
        if (!dead) setVehiclesFailed(true);
      }
    };

    /** Poll on returning to the tab, when the last positions are a full poll old. */
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && Date.now() - lastPoll >= POLL_MS) {
        void poll();
      }
    };
    /** End any running glide, which would otherwise drag its marker behind a zoom. */
    const stopGlides = (): void => {
      for (const el of state.map.getContainer().querySelectorAll(".vehicle-gliding")) {
        el.classList.remove("vehicle-gliding");
      }
    };

    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    state.map.on("zoomstart", stopGlides);

    return () => {
      dead = true;
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      state.map.off("zoomstart", stopGlides);
      clearVehicles(state);
      setVehiclesFailed(false);
    };
  }, [ready, live, routeId]);

  // `isolate` keeps Leaflet's high pane z-indexes (200-700) in their own stacking
  // context so they don't paint over the sticky header.
  return (
    <div className={cn("relative w-full", className)}>
      <div ref={divRef} className="isolate h-full w-full bg-at-bg" />
      {vehiclesFailed && (
        <p
          role="status"
          className="absolute top-2 right-2 z-10 max-w-60 border border-at-border bg-at-surface px-2 py-1 text-xs text-at-ink"
        >
          Live positions could not be refreshed. Trying again in two minutes.
        </p>
      )}
    </div>
  );
}
