// src/lib/map/vehicle-marker.ts
// The live-vehicle marker and popup both maps draw: a white disc ringed in the
// delay colour, the route's glyph inside, a heading chevron over the ring, and
// one popup layout, so a bus reads the same on the live map and on a route map.

import { escapeHtml } from "@/lib/map/style";
import { operatorHref, type Operator } from "@/lib/operators";
import { routeHref, vehicleHref } from "@/lib/page/hrefs";
import { liveRunHref, vehicleName } from "@/lib/vehicle/detail";
import type * as Leaflet from "leaflet";

/** A glyph's SVG, copied from a rendered icon so the marker draws what ModeIcon draws. */
export interface MarkerGlyph {
  viewBox: string;
  /** The icon's inner markup (its paths). */
  body: string;
}

/**
 * Copy every glyph rendered in a hidden container, keyed by its `data-glyph`
 * label. React renders the icons from the same components as the rest of the
 * site, so the maps carry no hand-copied paths.
 * @param container - The hidden element holding the rendered icons.
 * @returns Each glyph by its label ("Bus", "School bus", "Train", "Ferry").
 */
export function readGlyphs(container: HTMLElement | null): Map<string, MarkerGlyph> {
  const out = new Map<string, MarkerGlyph>();
  for (const svg of container?.querySelectorAll<SVGSVGElement>("svg[data-glyph]") ?? []) {
    out.set(svg.dataset.glyph ?? "", {
      viewBox: svg.getAttribute("viewBox") ?? "0 0 512 512",
      body: svg.innerHTML,
    });
  }
  return out;
}

/**
 * The heading chevron, in the marker's 40x40 box: the route arrows' shape, its
 * tip on the ring's top edge. The map key draws the same path.
 */
export const VEHICLE_CHEVRON = "M20 0.75 L27.5 10 L20 7 L12.5 10 Z";

/** What a vehicle marker shows. */
export interface VehicleMarkerOptions {
  /** Ring and chevron colour: the band's bright mark colour. */
  ring: string;
  /** Glyph colour: the band's text colour, darker where the ring's is too pale for a glyph. */
  glyphColour: string;
  /** The route's glyph, or null to draw the ring alone. */
  glyph: MarkerGlyph | null;
  /** Compass heading in degrees (0 = north), or null when the feed gave none. */
  bearing: number | null;
}

/**
 * The marker's SVG. The glyph is nested as its own `<svg>` so its viewBox scales
 * it into the 20x20 middle of the disc whatever its shape, centred along its
 * shorter side. The chevron is drawn last with a white edge, so the ring cannot
 * hide it and it reads over any tile; no chevron means the feed gave no heading.
 * @param o - Marker options.
 * @returns The SVG markup.
 */
export function vehicleMarkerHtml(o: VehicleMarkerOptions): string {
  const glyph = o.glyph
    ? `<svg x="10" y="10" width="20" height="20" viewBox="${o.glyph.viewBox}" fill="${o.glyphColour}">${o.glyph.body}</svg>`
    : "";
  const arrow =
    o.bearing == null
      ? ""
      : `<g transform="rotate(${Math.round(o.bearing)} 20 20)">` +
        `<path d="${VEHICLE_CHEVRON}" fill="${o.ring}" stroke="#fff" ` +
        `stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/></g>`;
  return (
    `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">` +
    `<circle cx="20" cy="20" r="14" fill="#fff" stroke="${o.ring}" stroke-width="3"/>` +
    glyph +
    arrow +
    `</svg>`
  );
}

/**
 * A vehicle marker as a Leaflet `divIcon`. The tooltip anchor sits just past the
 * ring (radius 14 plus half the 3px stroke), so a label bound to the right starts
 * beside the disc rather than over it.
 * @param L - The Leaflet module.
 * @param o - Marker options.
 * @returns The icon.
 */
export function vehicleIcon(L: typeof Leaflet, o: VehicleMarkerOptions): Leaflet.DivIcon {
  return L.divIcon({
    className: "vehicle-marker",
    html: vehicleMarkerHtml(o),
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    tooltipAnchor: [16, 0],
  });
}

/** What a filled vehicle dot shows. */
export interface VehicleDotOptions {
  /** Disc colour: the band's bright mark colour. */
  fill: string;
  /** The route's glyph, or null for a plain disc. */
  glyph: MarkerGlyph | null;
  /** The glyph's colour: white, or ink on a fill too pale for white to read on. */
  glyphFill: string;
  /** Width of the dot in pixels, white edge included. */
  size: number;
}

/**
 * The live map's mid-zoom vehicle: a disc filled in the delay colour with a white
 * edge and the route's glyph inside, bigger than the zoomed-out canvas dot so
 * the glyph reads, smaller than the street-level marker so a suburb's worth fit.
 * @param L - The Leaflet module.
 * @param o - Dot options.
 * @returns The icon.
 */
export function vehicleDotIcon(L: typeof Leaflet, o: VehicleDotOptions): Leaflet.DivIcon {
  const half = o.size / 2;
  // The glyph fills a little over half the disc, centred, so it clears the edge.
  const g = Math.round(o.size * 0.55);
  const at = (o.size - g) / 2;
  const glyph = o.glyph
    ? `<svg x="${at}" y="${at}" width="${g}" height="${g}" viewBox="${o.glyph.viewBox}" fill="${o.glyphFill}">${o.glyph.body}</svg>`
    : "";
  return L.divIcon({
    className: "vehicle-marker",
    html:
      `<svg viewBox="0 0 ${o.size} ${o.size}" width="${o.size}" height="${o.size}" aria-hidden="true">` +
      `<circle cx="${half}" cy="${half}" r="${half - 1}" fill="${o.fill}" stroke="#fff" stroke-width="1.5"/>` +
      glyph +
      `</svg>`,
    iconSize: [o.size, o.size],
    iconAnchor: [half, half],
  });
}

/** What a vehicle's popup names. */
export interface VehiclePopup {
  /** Version-stripped route slug. */
  slug: string;
  /** The route id the trip runs under, for the trip link. */
  routeId: string;
  vehicleId: string;
  /** Fleet label, if known. */
  label: string | null;
  /** Carriages, for a train. */
  cars: number | null;
  /** The trip it is on, or null when the feed gave none. */
  tripId: string | null;
  /** Its delay line, from the vehicle's status. */
  detail: string;
  /** The route's operator, or null when unrecorded. */
  operator: Operator | null;
}

/**
 * A vehicle's popup, one layout on every map: its route, its name, its delay,
 * its operator, then links to its trip and its own page. The same popup serves
 * the route, trip and vehicle pages, so a link may point back at the page it is
 * on; that costs a line, not a wrong turn.
 * @param v - The vehicle.
 * @returns Popup HTML.
 */
export function vehiclePopupHtml(v: VehiclePopup): string {
  const cars = v.cars ? ` &middot; ${v.cars} cars` : "";
  const runBy = v.operator
    ? `<br>Run by <a href="${escapeHtml(operatorHref(v.operator))}">${escapeHtml(v.operator.name)}</a>`
    : "";
  const links = [
    v.tripId
      ? `<a href="${escapeHtml(liveRunHref({ routeId: v.routeId, tripId: v.tripId }))}">Open this trip</a>`
      : null,
    `<a href="${escapeHtml(vehicleHref(v.vehicleId))}">This vehicle</a>`,
  ].filter(Boolean);
  return (
    `<a href="${escapeHtml(routeHref(v.slug))}"><strong>Route ${escapeHtml(v.slug)}</strong></a>` +
    `<br>${escapeHtml(vehicleName(v.label, v.vehicleId))}${cars}` +
    `<br>${escapeHtml(v.detail)}` +
    runBy +
    `<br>${links.join(" &middot; ")}`
  );
}
