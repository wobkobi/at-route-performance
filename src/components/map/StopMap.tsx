"use client";
// src/components/map/StopMap.tsx
// Render a Leaflet map of stops and live vehicles with delay-coloured markers.

import { MapGlyphs } from "@/components/map/MapGlyphs";
import { glyphFor } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import { delayColour } from "@/lib/delay-colour";
import type { LiveVehicle } from "@/lib/feed/vehicles";
import { UNKNOWN_VALUE, formatDelay, formatDuration } from "@/lib/format";
import { arrowPlacements, dropRepeatArrows, type ArrowPlacement } from "@/lib/map/line-arrows";
import { bandColours, bandTextColours, cssVar, escapeHtml } from "@/lib/map/style";
import { AUCKLAND_CENTRE, MAP_POLL_MS, createBaseMap, reducedMotion } from "@/lib/map/tiles";
import { usePopupLinkRouting } from "@/lib/map/use-popup-links";
import {
  readGlyphs,
  vehicleIcon,
  vehiclePopupHtml,
  type MarkerGlyph,
} from "@/lib/map/vehicle-marker";
import type { Mode } from "@/lib/mode";
import type { ReadingBand } from "@/lib/on-time";
import type { Operator } from "@/lib/operators";
import { stopHref } from "@/lib/page/hrefs";
import { PALETTE } from "@/lib/palette";
import { ROUTE_LINE_HEX } from "@/lib/route/colour";
import { routeSlug } from "@/lib/route/slug";
import type { MapStop } from "@/lib/route/view";
import { vehicleName } from "@/lib/vehicle/detail";
import { vehicleStatus, vehiclesOnMap } from "@/lib/vehicle/status";
import { startVisiblePoll } from "@/lib/visible-poll";
import type * as Leaflet from "leaflet";
import type { JSX } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

/** How long a vehicle takes to glide from its last polled position to its new one. */
const GLIDE_MS = 1000;

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

/** Zoom for a map with nothing to frame: the city around its centre. */
const OVERVIEW_ZOOM = 12;

/**
 * A chevron `divIcon` pointing along a route line's travel direction, in the
 * line's colour with a white edge so it reads over the line and any tile.
 * @param L - The Leaflet module.
 * @param angle - Degrees clockwise from screen up.
 * @returns A Leaflet divIcon.
 */
function arrowIcon(L: typeof import("leaflet"), angle: number): Leaflet.DivIcon {
  const html =
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
    `<g transform="rotate(${Math.round(angle)} 8 8)">` +
    `<path d="M8 2 L13.5 12.5 L8 9.5 L2.5 12.5 Z" fill="${ROUTE_LINE_HEX}" stroke="#fff" ` +
    `stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/></g></svg>`;
  return L.divIcon({ className: "route-arrow", html, iconSize: [16, 16], iconAnchor: [8, 8] });
}

/** Screen pixels between direction arrows on a route line, at every zoom. */
const ARROW_SPACING_PX = 140;

/**
 * Screen pixels an arrow keeps from the centre of a stop circle: the circle's
 * 8px (radius and ring) plus most of the arrow's own 8px half, so a chevron may
 * graze a ring but never cover a stop.
 */
const ARROW_STOP_CLEARANCE_PX = 14;

/** AT palette colours resolved once from CSS custom properties: each reading band's, then the rest. */
interface MapColours extends Record<ReadingBand, string> {
  ink: string;
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
    ...bandColours(),
    ink: cssVar("--color-at-ink") || PALETTE.ink,
    border: cssVar("--color-at-border") || PALETTE.border,
    surface: cssVar("--color-at-surface") || PALETTE.surface,
    offRoute: cssVar("--color-at-commercial") || PALETTE.commercial,
  };
}

/** All Leaflet objects created on mount, kept alive for the component lifetime. */
interface MapState {
  L: typeof import("leaflet");
  map: Leaflet.Map;
  colours: MapColours;
  /** Each band's colour for a marker glyph, darker than the ring for early. */
  glyphColours: Record<ReadingBand, string>;
  /** The route glyphs, copied from the hidden icons by label. */
  glyphs: Map<string, MarkerGlyph>;
  routeLayer: Leaflet.LayerGroup;
  /** Direction arrows, redrawn on every zoom so they stay evenly spaced on screen. */
  arrowLayer: Leaflet.LayerGroup;
  /** The lines and the stops the arrows were last placed from. */
  arrowSource: { lines: RouteLine[]; stops: MapStop[] };
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
  /** Band, glyph and heading the icon was built from; a new icon only when they change. */
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
 * @param route - The route the map shows.
 * @param route.mode - Its mode, which sets the glyph and the on-time window.
 * @param route.school - Whether it is a school service, which takes the school bus glyph.
 * @param op - The route's operator, for the popup's "Run by" line; null when unrecorded.
 */
function syncVehicles(
  state: MapState,
  vehicles: LiveVehicle[],
  { mode, school }: { mode: Mode; school: boolean },
  op: Operator | null,
): void {
  const { L, colours, glyphColours } = state;
  const { label: glyphLabel } = glyphFor(mode, school);
  const glyph = state.glyphs.get(glyphLabel) ?? null;
  const seen = new Set<string>();
  for (const veh of vehicles) {
    seen.add(veh.vehicleId);
    // One verdict for the ring, the label and the popup, on the same mode-aware
    // window as every figure on the page.
    const status = vehicleStatus(veh.delaySec, mode);
    const bearing = veh.bearing == null ? null : Math.round(veh.bearing);
    const iconKey = `${status.band}|${glyphLabel}|${bearing}`;
    /**
     * The marker's icon, built only for a new marker or a changed key.
     * @returns The icon.
     */
    const icon = (): Leaflet.DivIcon =>
      vehicleIcon(L, {
        ring: colours[status.band],
        glyphColour: glyphColours[status.band],
        glyph,
        bearing,
      });
    const slug = routeSlug(veh.routeId);
    const popup = vehiclePopupHtml({
      slug,
      routeId: veh.routeId,
      vehicleId: veh.vehicleId,
      label: veh.label,
      cars: veh.cars,
      tripId: veh.tripId,
      detail: status.detail,
      operator: op,
    });
    // Leaflet makes each marker a focusable button, and the icon's svg is hidden
    // from assistive tech, so the name has to be set on the element itself.
    const name = [
      `${glyphLabel} on route ${slug}`,
      vehicleName(veh.label, veh.vehicleId),
      veh.cars ? `${veh.cars} cars` : null,
      status.detail,
    ]
      .filter(Boolean)
      .join(", ");

    const entry = state.vehicles.get(veh.vehicleId);
    if (!entry) {
      // Vehicles and route arrows share the marker pane, where Leaflet stacks by
      // latitude; the offset keeps every vehicle above every arrow.
      const marker = L.marker([veh.lat, veh.lon], { icon: icon(), zIndexOffset: 1000 });
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
      marker.setIcon(icon());
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
 * Redraw the route polylines (in {@link ROUTE_LINE_HEX}) and their direction
 * arrows, clearing what was there before. Separated from the stop layer so direction-filter changes can
 * update one without touching the other.
 * @param state - Live map state (L, layer, colours).
 * @param routeLines - Per-variant coordinate sequences.
 * @param stops - Stops to keep arrows clear of.
 */
function drawRouteLayer(state: MapState, routeLines: RouteLine[], stops: MapStop[]): void {
  const { L, routeLayer } = state;
  routeLayer.clearLayers();
  for (const line of routeLines) {
    if (line.length < 2) continue;
    L.polyline(line, {
      color: ROUTE_LINE_HEX,
      weight: 4,
      opacity: 0.8,
      smoothFactor: 1.5,
    }).addTo(routeLayer);
  }
  state.arrowSource = { lines: routeLines, stops };
  drawArrowLayer(state);
}

/**
 * Place the direction arrows for the current zoom: one every
 * {@link ARROW_SPACING_PX} along each line, kept off the stop circles. Placed
 * in projected pixels at the map's zoom, which do not move on a pan, so only a
 * zoom needs a redraw. Each line starts its arrows a different distance in, so
 * the two directions drawn down one road alternate rather than stack.
 * @param state - Live map state.
 */
function drawArrowLayer(state: MapState): void {
  const { L, map, arrowLayer } = state;
  const { lines, stops } = state.arrowSource;
  arrowLayer.clearLayers();
  const zoom = map.getZoom();
  const avoid = stops.map((s) => map.project([s.lat, s.lon], zoom));
  const placed: ArrowPlacement[] = [];
  for (const [lineIdx, line] of lines.entries()) {
    const pixels = line.map((pt) => map.project(pt, zoom));
    const offset = ARROW_SPACING_PX * (0.5 + ((lineIdx * 0.37) % 0.5));
    placed.push(
      ...arrowPlacements(pixels, ARROW_SPACING_PX, offset, avoid, ARROW_STOP_CLEARANCE_PX),
    );
  }
  // A repeat is anything closer than 60% of the spacing, so two variants down
  // one road leave one arrow per spacing rather than one each.
  for (const a of dropRepeatArrows(placed, ARROW_SPACING_PX * 0.6)) {
    L.marker(map.unproject([a.x, a.y], zoom), {
      icon: arrowIcon(L, a.angle),
      interactive: false,
      keyboard: false,
    }).addTo(arrowLayer);
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
      .bindTooltip(escapeHtml(p.label))
      .addTo(offRouteLayer);
  }
}

/**
 * Redraw the stop circle markers into `layer`, clearing what was there before.
 * Updates `markerById` in-place so later `panToStop` calls can find markers by id.
 * @param state - Live map state.
 * @param stops - Stops to render.
 * @param mode - Route mode, for the delay colour band.
 * @param stopLinks - Whether stop names link to their pages.
 * @param stopDay - The day those links open on, or undefined for today.
 */
function drawStopLayer(
  state: MapState,
  stops: MapStop[],
  mode: Mode,
  stopLinks: boolean,
  stopDay: string | undefined,
): void {
  const { L, stopLayer, colours, markerById } = state;
  stopLayer.clearLayers();
  markerById.clear();
  // A readingless stop recedes on a route map, where it is one of many; on a
  // stop's own page it is the only thing on the map, so it keeps the full ring.
  const lone = stops.length === 1;
  for (const s of stops) {
    const hasData = s.avg_delay_sec != null;
    const marker = L.circleMarker(
      [s.lat, s.lon],
      hasData || lone
        ? {
            radius: 6,
            color: colours.ink,
            fillColor: hasData ? delayColour(s.avg_delay_sec, mode) : colours.surface,
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
    // which would contradict the "Avg off by" figure beside it.
    const net =
      s.avg_delay_sec == null ? UNKNOWN_VALUE : formatDelay(s.avg_delay_sec, { thresholdSec: 0 });
    const name = stopLinks
      ? `<a href="${escapeHtml(stopHref(s.stop_id, { day: stopDay }))}"><strong>${escapeHtml(s.name)}</strong></a>`
      : `<strong>${escapeHtml(s.name)}</strong>`;
    const popup =
      s.avg_abs_delay_sec != null
        ? `${name}<br>Early or late: ${net}<br>Avg off by: ${formatDuration(s.avg_abs_delay_sec)}`
        : `${name}<br>Early or late: ${net}`;
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
function setInitialViewport(state: MapState, stops: MapStop[], routeLines: RouteLine[]): void {
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
    map.setView(AUCKLAND_CENTRE, OVERVIEW_ZOOM);
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
 * @param root0.school - The route is a school service, whose vehicles take the school bus glyph.
 * @param root0.selectedStopId - When set, smoothly pan to this stop and open its popup.
 * @param root0.filterTripId - When set, only show the live vehicle for this trip.
 * @param root0.filterDirectionIds - Raw GTFS direction ids to restrict the displayed path.
 * @param root0.offRoute - Readings of the vehicle off its road path, in time order (trip map).
 * @param root0.stopLinks - Link each stop's popup name to its page.
 * @param root0.stopDay - The day those links open on, or undefined for today.
 * @param root0.className - Optional extra classes for the container div.
 * @returns Map container element.
 */
export default function StopMap({
  stops,
  routeLines = [],
  routeId,
  live = false,
  mode = "BUS",
  school = false,
  selectedStopId,
  filterTripId,
  filterDirectionIds,
  offRoute = NO_OFF_ROUTE,
  stopLinks = false,
  stopDay,
  className,
}: {
  stops: MapStop[];
  routeLines?: RouteLine[];
  routeId?: string;
  live?: boolean;
  mode?: Mode;
  school?: boolean;
  selectedStopId?: string;
  filterTripId?: string;
  filterDirectionIds?: number[];
  offRoute?: OffRoutePoint[];
  stopLinks?: boolean;
  stopDay?: string;
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);
  // The route glyphs rendered once, hidden, so a vehicle marker can copy their SVG.
  const glyphRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<MapState | null>(null);
  // Set once the async map setup has finished, so the vehicle poll can start.
  const [ready, setReady] = useState(false);
  // The last vehicle poll failed, so the positions shown (if any) are not current.
  const [vehiclesFailed, setVehiclesFailed] = useState(false);

  // Always-current prop values read by the async vehicle polling callback so it
  // never uses stale closures from the effect that set it up.
  const latestRef = useRef({
    stops,
    routeLines,
    routeId,
    live,
    mode,
    school,
    selectedStopId,
    filterTripId,
    filterDirectionIds,
    offRoute,
    stopLinks,
    stopDay,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      stops,
      routeLines,
      routeId,
      live,
      mode,
      school,
      selectedStopId,
      filterTripId,
      filterDirectionIds,
      offRoute,
      stopLinks,
      stopDay,
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
      const map = createBaseMap(L, divRef.current);

      const state: MapState = {
        L,
        map,
        colours,
        glyphColours: bandTextColours(),
        glyphs: readGlyphs(glyphRef.current),
        routeLayer: L.layerGroup().addTo(map),
        arrowLayer: L.layerGroup().addTo(map),
        arrowSource: { lines: [], stops: [] },
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
      drawStopLayer(state, s0, m0, latestRef.current.stopLinks, latestRef.current.stopDay);

      // No saved view: every visit frames the route afresh, so a zoom left on one
      // visit never carries into the next.
      setInitialViewport(state, s0, rl0);
      // Arrows were placed at the zoom before the fit; place them again for this
      // one, and after every zoom, so they stay evenly spaced on screen.
      drawArrowLayer(state);
      map.on("zoomend", () => drawArrowLayer(state));

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
    const state = stateRef.current;
    if (!state) return;
    drawRouteLayer(state, routeLines, stops);
    drawOffRouteLayer(state, offRoute);
    drawStopLayer(state, stops, mode, stopLinks, stopDay);
  }, [stops, routeLines, mode, offRoute, stopLinks, stopDay]);

  usePopupLinkRouting(divRef);

  // --- Effect 3: smooth-pan to the selected stop (no map rebuild) ---------------
  // A flyTo with a short duration keeps the context visible while centring.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !selectedStopId) return;
    const marker = state.markerById.get(selectedStopId);
    if (!marker) return;
    state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), STOP_FOCUS_ZOOM), {
      animate: !reducedMotion(),
      duration: 0.4,
    });
    marker.openPopup();
  }, [selectedStopId]);

  // --- Effect 4: poll live vehicles while the view covers now ------------------
  // A past day's map shows where vehicles are right now, not where they were, so
  // only a live view polls. Keyed on `live` and `routeId`, so a view that turns
  // live after mount starts polling, and one that stops being live clears its
  // vehicles.
  useEffect(() => {
    const state = stateRef.current;
    if (!ready || !state || !live || !routeId) return;

    /**
     * Fetch the route's vehicles and move the markers, reading current props.
     * @param signal - Aborted when the effect cleans up.
     */
    const poll = async (signal: AbortSignal): Promise<void> => {
      const {
        stops: pollStops,
        routeLines: pollLines,
        filterTripId: pollFTrip,
        filterDirectionIds: pollFDirs,
        mode: pollMode,
        school: pollSchool,
      } = latestRef.current;
      try {
        const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/vehicles`, {
          cache: "no-store",
          signal,
        });
        if (signal.aborted) return;
        if (!res.ok) {
          setVehiclesFailed(true);
          return;
        }
        const data = (await res.json()) as { vehicles: LiveVehicle[]; operator?: Operator | null };
        if (signal.aborted) return;
        setVehiclesFailed(false);

        const vehicles = vehiclesOnMap(data.vehicles, {
          tripId: pollFTrip,
          directionIds: pollFDirs,
          lines: pollLines,
          stops: pollStops,
        });
        syncVehicles(
          state,
          vehicles,
          { mode: pollMode, school: pollSchool },
          data.operator ?? null,
        );
      } catch {
        // An abort on cleanup is not a failure; anything else is.
        if (!signal.aborted) setVehiclesFailed(true);
      }
    };

    /** End any running glide, which would otherwise drag its marker behind a zoom. */
    const stopGlides = (): void => {
      for (const el of state.map.getContainer().querySelectorAll(".vehicle-gliding")) {
        el.classList.remove("vehicle-gliding");
      }
    };

    const stopPoll = startVisiblePoll(poll, MAP_POLL_MS);
    state.map.on("zoomstart", stopGlides);

    return () => {
      stopPoll();
      state.map.off("zoomstart", stopGlides);
      clearVehicles(state);
      setVehiclesFailed(false);
    };
  }, [ready, live, routeId]);

  /** Frame the route again after the reader has panned or zoomed away from it. */
  const recentre = (): void => {
    const state = stateRef.current;
    if (!state) return;
    setInitialViewport(state, latestRef.current.stops, latestRef.current.routeLines);
  };

  // `isolate` keeps Leaflet's high pane z-indexes (200-700) in their own stacking
  // context so they don't paint over the sticky header.
  return (
    <div className={cn("relative w-full", className)}>
      <div ref={divRef} className="isolate h-full w-full bg-at-bg" />
      <MapGlyphs ref={glyphRef} />
      {/* Clear of Leaflet's attribution in the corner below it. */}
      <button
        type="button"
        onClick={recentre}
        disabled={!ready}
        className="absolute right-2.5 bottom-7 z-10 flex min-h-11 items-center border border-at-border bg-at-surface px-3 py-2 text-sm font-semibold text-at-ink shadow-sm hover:bg-at-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-at-shore disabled:opacity-60"
      >
        Re-centre
      </button>
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
