"use client";
// src/components/StopMap.tsx
// Render a Leaflet map of stops and live vehicles with delay-coloured markers.

import { cn } from "@/lib/cn";
import { delayColour } from "@/lib/delay-colour";
import { formatDelay, formatDuration } from "@/lib/format";
import { cartoTileUrl } from "@/lib/map-tiles";
import { vehicleStatus } from "@/lib/vehicle-status";
import type { LiveVehicle } from "@/lib/vehicles";
import type * as Leaflet from "leaflet";
import type { JSX } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

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
 * area inside the 40x40 marker disc. Scale factors derived from each icon's viewBox:
 *   BUS  (FaBusAlt)  512x512 - scale(20/512)       = 0.039
 *   TRAIN (FaSubway) 448x512 - scale(20/448, 20/512) = scale(0.0446, 0.039)
 *   FERRY (FaShip)   640x512 - scale(20/640, 20/512) = scale(0.03125, 0.039)
 */
const MODE_GLYPHS: Record<RouteMode, string> = {
  BUS:
    '<g transform="scale(0.039)">' +
    '<path d="M488 128h-8V80c0-44.8-99.2-80-224-80S32 35.2 32 80v48h-8c-13.25 0-24 10.74-24 24v80c0 13.25 10.75 24 24 24h8v160c0 17.67 14.33 32 32 32v32c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-32h192v32c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-32h6.4c16 0 25.6-12.8 25.6-25.6V256h8c13.25 0 24-10.75 24-24v-80c0-13.26-10.75-24-24-24zM160 72c0-4.42 3.58-8 8-8h176c4.42 0 8 3.58 8 8v16c0 4.42-3.58 8-8 8H168c-4.42 0-8-3.58-8-8V72zm-48 328c-17.67 0-32-14.33-32-32s14.33-32 32-32 32 14.33 32 32-14.33 32-32 32zm128-112H128c-17.67 0-32-14.33-32-32v-96c0-17.67 14.33-32 32-32h112v160zm32 0V128h112c17.67 0 32 14.33 32 32v96c0 17.67-14.33 32-32 32H272zm128 112c-17.67 0-32-14.33-32-32s14.33-32 32-32 32 14.33 32 32-14.33 32-32 32z"/>' +
    "</g>",
  TRAIN:
    '<g transform="scale(0.0446 0.039)">' +
    '<path d="M448 96v256c0 51.815-61.624 96-130.022 96l62.98 49.721C386.905 502.417 383.562 512 376 512H72c-7.578 0-10.892-9.594-4.957-14.279L130.022 448C61.82 448 0 403.954 0 352V96C0 42.981 64 0 128 0h192c65 0 128 42.981 128 96zM200 232V120c0-13.255-10.745-24-24-24H72c-13.255 0-24 10.745-24 24v112c0 13.255 10.745 24 24 24h104c13.255 0 24-10.745 24-24zm200 0V120c0-13.255-10.745-24-24-24H272c-13.255 0-24 10.745-24 24v112c0 13.255 10.745 24 24 24h104c13.255 0 24-10.745 24-24zm-48 56c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48zm-256 0c-26.51 0-48 21.49-48 48s21.49 48 48 48 48-21.49 48-48-21.49-48-48-48z"/>' +
    "</g>",
  FERRY:
    '<g transform="scale(0.03125 0.039)">' +
    '<path d="M496.616 372.639l70.012-70.012c16.899-16.9 9.942-45.771-12.836-53.092L512 236.102V96c0-17.673-14.327-32-32-32h-64V24c0-13.255-10.745-24-24-24H248c-13.255 0-24 10.745-24 24v40h-64c-17.673 0-32 14.327-32 32v140.102l-41.792 13.433c-22.753 7.313-29.754 36.173-12.836 53.092l70.012 70.012C125.828 416.287 85.587 448 24 448c-13.255 0-24 10.745-24 24v16c0 13.255 10.745 24 24 24 61.023 0 107.499-20.61 143.258-59.396C181.677 487.432 216.021 512 256 512h128c39.979 0 74.323-24.568 88.742-59.396C508.495 491.384 554.968 512 616 512c13.255 0 24-10.745 24-24v-16c0-13.255-10.745-24-24-24-60.817 0-101.542-31.001-119.384-75.361zM192 128h256v87.531l-118.208-37.995a31.995 31.995 0 0 0-19.584 0L192 215.531V128z"/>' +
    "</g>",
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
  const arrow =
    opts.bearing == null
      ? ""
      : `<g transform="rotate(${Math.round(opts.bearing)} 20 20)">` +
        `<path d="M20 0.5 L24.5 6.5 L15.5 6.5 Z" fill="${opts.colour}"/></g>`;
  const html =
    `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">` +
    arrow +
    `<circle cx="20" cy="20" r="14" fill="#fff" stroke="${opts.colour}" stroke-width="3"/>` +
    `<g transform="translate(10 10)" fill="${opts.colour}">${glyph}</g>` +
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
    early: cssVar("--color-at-early") || "#95c11f",
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
    const net = s.avg_delay_sec == null ? "—" : formatDelay(s.avg_delay_sec, { mode });
    const popup =
      s.avg_abs_delay_sec != null
        ? `<strong>${esc(s.name)}</strong><br>Net: ${net}<br>Off by: ${formatDuration(s.avg_abs_delay_sec)} avg`
        : `<strong>${esc(s.name)}</strong><br>Avg delay: ${net}`;
    marker.bindPopup(popup);
    marker.addTo(stopLayer);
    markerById.set(s.stop_id, marker);
  }
}

/**
 * Set the initial map viewport: restore from sessionStorage when the user has
 * previously panned/zoomed this route, otherwise fit all stops and route lines.
 * @param state - Live map state.
 * @param stops - Route stops (lat/lon bounds).
 * @param routeLines - Route path bounds.
 * @param storageKey - sessionStorage key for this route's viewport, or null.
 * @param hasSelectedStop - Skip storage restore when a specific stop is focused.
 */
function setInitialViewport(
  state: MapState,
  stops: StopPoint[],
  routeLines: RouteLine[],
  storageKey: string | null,
  hasSelectedStop: boolean,
): void {
  const { L, map } = state;
  if (storageKey && !hasSelectedStop) {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      try {
        const { lat, lng, zoom } = JSON.parse(saved) as { lat: number; lng: number; zoom: number };
        map.setView([lat, lng], zoom);
        return;
      } catch {
        // Malformed entry; fall through to default framing.
      }
    }
  }
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
 * @param root0.routeId - Route id, keying the saved viewport and the live-vehicle poll.
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
  // Creates the Leaflet instance and layer groups, draws the initial content, sets
  // up the viewport, and starts live-vehicle polling. Tears down on unmount only.
  useEffect(() => {
    let dead = false;
    const ctrl = new AbortController();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");
      if (dead || !divRef.current) return;

      const colours = readColours();
      /*
        Leaflet's defaults leave wheel zoom and one-finger drag on, so a wheel over
        the map zoomed it instead of scrolling past it and a thumb swipe panned the
        map instead of the page - on a phone the map is most of the viewport, so
        there was no reliable way to scroll past it at all. The zoom buttons and
        pinch-zoom both still work; this only takes away the two gestures that were
        stealing a scroll the reader meant for the page.
      */
      const map = L.map(divRef.current, {
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
      });
      // The key goes out only where CARTO accepts it (see cartoTileUrl).
      const tiles = cartoTileUrl(
        window.location.host,
        process.env.NEXT_PUBLIC_CARTO_API_KEY,
        process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
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
      };
      stateRef.current = state;

      // Draw initial content from the current prop values.
      const { stops: s0, routeLines: rl0, routeId: rId, mode: m0 } = latestRef.current;
      drawRouteLayer(state, rl0, s0);
      drawOffRouteLayer(state, latestRef.current.offRoute);
      drawStopLayer(state, s0, m0);

      /*
        Only a whole-route map remembers where it was left. The trip page passes the
        route's own slug as `routeId`, so both maps used to share one key and panning
        a trip map overwrote the route map's saved view. A trip map has one right
        framing anyway - the trip - so it saves nothing and always fits its own path.
      */
      const storageKey = rId && !latestRef.current.filterTripId ? `map-viewport:${rId}` : null;
      setInitialViewport(state, s0, rl0, storageKey, !!latestRef.current.selectedStopId);

      if (storageKey) {
        map.on("moveend", () => {
          const c = map.getCenter();
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }),
          );
        });
      }

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

      // A past day's map shows where vehicles are right now, not where they were, so
      // only a view that covers now polls.
      if (!rId || !latestRef.current.live) return;

      /** Fetch and redraw live vehicles, reading always-current values from latestRef. */
      const pollVehicles = async (): Promise<void> => {
        const {
          routeId: pollRId,
          stops: pollStops,
          filterTripId: pollFTrip,
          filterDirectionIds: pollFDirs,
          mode: pollMode,
        } = latestRef.current;
        if (!pollRId || !stateRef.current || dead) return;
        try {
          const res = await fetch(`/api/routes/${encodeURIComponent(pollRId)}/vehicles`, {
            cache: "no-store",
            signal: ctrl.signal,
          });
          if (!res.ok || dead || !stateRef.current) return;
          const data = (await res.json()) as { vehicles: LiveVehicle[] };
          if (dead || !stateRef.current) return;

          state.vehicleLayer.clearLayers();
          let vehicles = pollFTrip
            ? data.vehicles.filter((v) => v.tripId === pollFTrip)
            : data.vehicles;
          if (!pollFTrip) {
            if (pollFDirs) {
              vehicles = vehicles.filter(
                (v) => v.directionId == null || pollFDirs.includes(v.directionId),
              );
            }
            if (pollStops.length > 0) {
              vehicles = vehicles.filter((v) =>
                pollStops.some((st) => haversineKm(v.lat, v.lon, st.lat, st.lon) < 2.0),
              );
            }
          }
          for (const veh of vehicles) {
            // One verdict for the ring, the label and the popup, on the same
            // mode-aware window as every figure on the page.
            const status = vehicleStatus(veh.delaySec, pollMode);
            const colour = status.band === "unknown" ? colours.muted : colours[status.band];
            const vehMarker = L.marker([veh.lat, veh.lon], {
              icon: vehicleIcon(L, { colour, mode: pollMode, bearing: veh.bearing }),
            });
            if (status.label) {
              vehMarker.bindTooltip(status.label, {
                permanent: true,
                direction: "right",
                offset: [4, 0],
                className: "bus-delay-label",
              });
            }
            vehMarker.bindPopup(
              `<strong>${esc(veh.label ?? veh.vehicleId)}</strong><br>${esc(status.detail)}`,
            );
            vehMarker.addTo(state.vehicleLayer);
          }
        } catch {
          // Aborted on unmount or transient fetch error; ignore.
        }
      };

      await pollVehicles();
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") void pollVehicles();
      }, POLL_MS);
    })();

    return () => {
      dead = true;
      ctrl.abort();
      if (pollTimer) clearInterval(pollTimer);
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

  // `isolate` keeps Leaflet's high pane z-indexes (200-700) in their own stacking
  // context so they don't paint over the sticky header.
  return <div ref={divRef} className={cn("isolate w-full bg-at-bg", className)} />;
}
