"use client";
// src/components/map/LiveMap.tsx
// The live page's network map: every vehicle on a run as a dot in its delay
// colour, redrawn from /api/live every two minutes, over the road paths the
// routes follow. Dots are drawn on one canvas rather than as DOM markers, since
// a weekday peak puts well over a thousand vehicles on the map at once. Zoomed
// in to street level, where a screen holds a few dozen, they become markers with
// the mode's icon inside. The table under the map carries the same service for
// keyboard and screen-reader readers, so the dots are not focusable.

import { LocateArrow } from "@/components/icons";
import { modeGlyph } from "@/components/ModeIcon";
import { cn } from "@/lib/cn";
import type { LiveMapVehicle } from "@/lib/live-routes";
import { coreBounds } from "@/lib/map/frame";
import { nearbyFrame } from "@/lib/map/near-frame";
import { shiftPixels } from "@/lib/map/shared-roads";
import { bandColours, cssVar, escapeHtml } from "@/lib/map/style";
import { AUCKLAND_CENTRE, MAP_POLL_MS, createBaseMap } from "@/lib/map/tiles";
import { usePopupLinkRouting } from "@/lib/map/use-popup-links";
import { MODES, MODE_NAME, type Mode } from "@/lib/mode";
import type { ReadingBand } from "@/lib/on-time";
import { operatorHref, operatorOf, type Operator } from "@/lib/operators";
import { routeHref, vehicleHref } from "@/lib/page/hrefs";
import { PALETTE } from "@/lib/palette";
import { liveRunHref } from "@/lib/vehicle/detail";
import { vehicleStatus } from "@/lib/vehicle/status";
import { startVisiblePoll } from "@/lib/visible-poll";
import type { NetworkLine } from "@/types/api";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState, type JSX } from "react";

/**
 * Roughly the region AT serves, Wellsford to Pukekohe and out to Great Barrier.
 * A reader outside it has no vehicle nearby, so the map stays on the network
 * rather than flying to an empty patch of sea or another city.
 */
const AUCKLAND_BOUNDS: [[number, number], [number, number]] = [
  [-37.45, 174.1],
  [-35.85, 175.6],
];

/** Closest a located reader is framed, so a dot beside them does not fill the screen. */
const NEAR_MAX_ZOOM = 17;

/** The zoom the map opens at, where road paths draw at their base weight. */
const BASE_ZOOM = 11;

/**
 * From this zoom the dots carry their mode's icon. That makes them DOM markers,
 * so only the vehicles in view are drawn: at street level a screen holds a few
 * dozen, where the whole region's thousand would stall the page.
 */
const ICON_ZOOM = 15;

/**
 * A road path's stroke at a zoom. Rail and ferry lines are few and long, so they
 * carry more weight than the bus roads, which overlap and stay hairlines at the
 * whole-region view. Zoomed in, the roads spread apart, so every path thickens
 * by a third of its base weight per level and firms up, capped at street level;
 * zoomed out past the opening view they stay at base.
 * @param mode - The route's mode.
 * @param zoom - The map's zoom.
 * @param hover - Whether the pointer is on the path, which draws it bold.
 * @returns Stroke weight and opacity.
 */
function lineStyle(mode: Mode, zoom: number, hover = false): { weight: number; opacity: number } {
  const levels = Math.min(Math.max(zoom - BASE_ZOOM, 0), 6);
  const weight = (mode === "BUS" ? 1.5 : 2.5) * (1 + levels / 3);
  return hover ? { weight: weight + 2, opacity: 0.9 } : { weight, opacity: 0.4 + levels * 0.05 };
}

/**
 * A vehicle's popup: its route and name, its delay in the words the route maps
 * use, its operator, and links to its run and its own page.
 * @param v - The vehicle.
 * @param detail - Its delay line.
 * @param operators - The stored operators the feed's vehicles carry.
 * @returns Popup HTML.
 */
function popupHtml(v: LiveMapVehicle, detail: string, operators: readonly Operator[]): string {
  const name = `${MODE_NAME[v.mode]} ${v.label ?? v.id}`;
  const cars = v.cars ? ` &middot; ${v.cars} cars` : "";
  const run = liveRunHref({ routeId: v.slug, tripId: v.tripId });
  const op = operatorOf(v.operatorCode, operators);
  const runBy = op
    ? `Run by <a href="${escapeHtml(operatorHref(op))}">${escapeHtml(op.name)}</a><br>`
    : "";
  return (
    `<a href="${escapeHtml(routeHref(v.slug))}"><strong>Route ${escapeHtml(v.slug)}</strong></a><br>` +
    `${escapeHtml(name)}${cars}<br>${escapeHtml(detail)}<br>${runBy}` +
    `<a href="${escapeHtml(run)}">Open this run</a> &middot; ` +
    `<a href="${escapeHtml(vehicleHref(v.id))}">This vehicle</a>`
  );
}

/**
 * A tapped road's popup: every route drawn within reach of the tap, nearest
 * first, each with its colour, name and how many of the dots are on it, so a
 * reader can pick one route out of a shared road.
 * @param hits - The routes under the tap.
 * @param vehicles - The last poll's vehicles, or null before the first lands.
 * @returns Popup HTML.
 */
function linePopupHtml(
  hits: readonly NetworkLine[],
  vehicles: readonly LiveMapVehicle[] | null,
): string {
  const rows = hits.map((line) => {
    const running = vehicles?.filter((v) => v.slug === line.slug).length ?? 0;
    const count = vehicles === null ? "" : ` &middot; ${running === 0 ? "none" : running} on a run`;
    // A square of the line's own colour, so a reader can match the row to the road.
    const swatch = `<span style="display:inline-block;width:0.6rem;height:0.6rem;margin-right:0.35rem;background:${escapeHtml(line.colour)}"></span>`;
    return (
      `${swatch}<a href="${escapeHtml(routeHref(line.slug))}"><strong>Route ${escapeHtml(line.slug)}</strong></a>` +
      (line.name ? ` ${escapeHtml(line.name)}` : "") +
      count
    );
  });
  const heading = hits.length > 1 ? `${hits.length} routes here<br>` : "";
  return heading + rows.join("<br>");
}

/**
 * The network map.
 * @param props - Component props.
 * @param props.mode - Show one mode's vehicles, or null for every mode.
 * @param props.bands - The delay bands whose dots are drawn.
 * @param props.showLines - Whether the route lines are drawn under the dots.
 * @param props.className - Height and size classes.
 * @returns The map container.
 */
export default function LiveMap({
  mode,
  bands,
  showLines,
  className,
}: {
  mode: Mode | null;
  bands: ReadonlySet<ReadingBand>;
  showLines: boolean;
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);
  // The mode icons rendered once, hidden, so a marker can copy their SVG.
  const glyphRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{
    L: typeof Leaflet;
    map: Leaflet.Map;
    layer: Leaflet.LayerGroup;
    renderer: Leaflet.Canvas;
    lineLayer: Leaflet.LayerGroup;
    hereLayer: Leaflet.LayerGroup;
  } | null>(null);
  // The last poll's vehicles, so a mode change redraws without refetching.
  const [vehicles, setVehicles] = useState<LiveMapVehicle[] | null>(null);
  // Set with each poll's vehicles, before they render, so the popups read the same poll's names.
  const operatorsRef = useRef<Operator[]>([]);
  // The same vehicles for a road path's popup, which is built on open outside React.
  const vehiclesRef = useRef<LiveMapVehicle[] | null>(null);
  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);
  // The routes' road paths: fetched once, since they are the same for every
  // reader and only change when the GTFS shapes sync runs.
  const [lines, setLines] = useState<NetworkLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  // Why the last locate did not move the map, if it did not.
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const framed = useRef(false);

  // Build the map once.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");
      if (dead || !divRef.current) return;
      const map = createBaseMap(L, divRef.current);
      map.setView(AUCKLAND_CENTRE, BASE_ZOOM);
      // One canvas for the dots and the road paths both. A canvas only hears
      // clicks on its own element, so paths on a second canvas under the dots'
      // could never be tapped; here the paths are sent to the back of the draw
      // order instead, and a tap where a dot sits on its road opens the dot.
      // The hit tolerance lets a tap near a 5px dot or a hairline road land, and
      // the padding keeps a pan from tearing the lines at the drawn edge.
      const renderer = L.canvas({ tolerance: 6, padding: 0.3 });
      mapRef.current = {
        L,
        map,
        layer: L.layerGroup().addTo(map),
        renderer,
        lineLayer: L.layerGroup().addTo(map),
        hereLayer: L.layerGroup().addTo(map),
      };
      setReady(true);
    })();
    return () => {
      dead = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
  }, []);

  usePopupLinkRouting(divRef);

  // Poll while the tab is visible.
  useEffect(() => {
    if (!ready) return;
    /**
     * Fetch every vehicle on a trip and hand them to the redraw.
     * @param signal - Aborted when the effect cleans up.
     */
    const poll = async (signal: AbortSignal): Promise<void> => {
      try {
        const res = await fetch("/api/live", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = (await res.json()) as {
          vehicles: LiveMapVehicle[];
          operators?: Operator[];
        };
        if (signal.aborted) return;
        setFailed(false);
        operatorsRef.current = data.operators ?? [];
        setVehicles(data.vehicles);
      } catch {
        if (!signal.aborted) setFailed(true);
      }
    };
    return startVisiblePoll(poll, MAP_POLL_MS);
  }, [ready]);

  // The road paths, fetched once the map exists. A failure costs the underlay
  // and nothing else, so it is not reported: the dots draw without it.
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/network-lines", { signal: ctrl.signal });
        if (dead || !res.ok) return;
        const data = (await res.json()) as { lines: NetworkLine[] };
        if (!dead) setLines(data.lines);
      } catch {
        // Leave the map to its dots.
      }
    })();
    return () => {
      dead = true;
      ctrl.abort();
    };
  }, [ready]);

  // Draw the road paths, and redraw them on a mode change so the lines match the
  // dots. Rebuilt rather than filtered in place: it is one pass over a few
  // hundred paths, against holding a layer per route to toggle.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !lines) return;
    const { L, map, lineLayer, renderer } = m;
    lineLayer.clearLayers();
    if (!showLines) return;
    // One polyline per stretch, keyed back to its route so a hover lights the
    // whole route and a tap can name it.
    const drawn: {
      path: Leaflet.Polyline;
      line: NetworkLine;
      slot: number;
      at: Leaflet.LatLng[];
    }[] = [];
    /**
     * Set every stretch at its lane for the current zoom. Lanes are counted in
     * line widths, so they are placed in pixels: spaced a bus line's width plus a
     * pixel apart, they stay side by side however far in the reader is.
     */
    const place = (): void => {
      const zoom = map.getZoom();
      const spacing = lineStyle("BUS", zoom).weight + 1;
      for (const d of drawn) {
        d.path.setStyle(lineStyle(d.line.mode, zoom));
        if (d.slot === 0) continue;
        const px = d.at.map((ll): [number, number] => {
          const p = map.project(ll, zoom);
          return [p.x, p.y];
        });
        d.path.setLatLngs(
          shiftPixels(px, d.slot * spacing).map(([x, y]) => map.unproject([x, y], zoom)),
        );
      }
    };
    /**
     * Light every stretch of one route, or put them back.
     * @param slug - The route.
     * @param on - Whether the pointer is on it.
     */
    const light = (slug: string, on: boolean): void => {
      const zoom = map.getZoom();
      for (const d of drawn) {
        if (d.line.slug === slug) d.path.setStyle(lineStyle(d.line.mode, zoom, on));
      }
    };
    /**
     * Open a popup naming every route drawn within reach of a tap, since a
     * shared road hides all but the top line from the canvas's own hit test.
     * @param e - The tap on a line.
     */
    const pick = (e: Leaflet.LeafletMouseEvent): void => {
      const reach = 6 + lineStyle("BUS", map.getZoom()).weight;
      const nearest = new Map<string, number>();
      for (const d of drawn) {
        const pts = d.path.getLatLngs() as Leaflet.LatLng[];
        let best = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = map.latLngToLayerPoint(pts[i] as Leaflet.LatLng);
          const b = map.latLngToLayerPoint(pts[i + 1] as Leaflet.LatLng);
          best = Math.min(best, L.LineUtil.pointToSegmentDistance(e.layerPoint, a, b));
        }
        if (best <= reach && best < (nearest.get(d.line.slug) ?? Infinity)) {
          nearest.set(d.line.slug, best);
        }
      }
      const hits = [...nearest]
        .sort((a, b) => a[1] - b[1])
        .map(([slug]) => lines.find((l) => l.slug === slug))
        .filter((l): l is NetworkLine => l !== undefined);
      if (hits.length === 0) return;
      // Built on the tap, so the counts read the latest poll.
      L.popup()
        .setLatLng(e.latlng)
        .setContent(linePopupHtml(hits, vehiclesRef.current))
        .openOn(map);
    };
    // Walked from the top of the draw order down, since each path is sent to the
    // back as it lands: the list comes buses first, and they must end up lowest.
    for (const line of [...lines].reverse()) {
      if (mode && line.mode !== mode) continue;
      for (const run of line.runs) {
        const at: Leaflet.LatLng[] = [];
        for (let i = 0; i + 1 < run.path.length; i += 2) {
          const lat = run.path[i];
          const lon = run.path[i + 1];
          if (lat === undefined || lon === undefined) continue;
          at.push(L.latLng(lat, lon));
        }
        if (at.length < 2) continue;
        const path = L.polyline(at, { renderer, color: line.colour });
        path.on("click", pick);
        path.on("mouseover", () => light(line.slug, true));
        path.on("mouseout", () => light(line.slug, false));
        path.addTo(lineLayer).bringToBack();
        drawn.push({ path, line, slot: run.slot, at });
      }
    }
    place();
    map.on("zoomend", place);
    return () => {
      map.off("zoomend", place);
    };
  }, [lines, mode, ready, showLines]);

  // Redraw on each poll, on a mode change and on a toggle. An open popup closes
  // with its dot; a two-minute redraw is rare enough that keying dots by id is
  // not worth it.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !vehicles) return;
    const { L, map, layer, renderer } = m;
    const colour = bandColours();
    const glyph = Object.fromEntries(
      MODES.map((md) => [
        md,
        glyphRef.current?.querySelector(`[data-mode="${md}"]`)?.outerHTML ?? "",
      ]),
    ) as Record<Mode, string>;
    const shown = vehicles.filter((v) => (!mode || v.mode === mode) && v.stored);
    const drawn = shown
      .map((v) => ({ v, status: vehicleStatus(v.delaySec, v.mode) }))
      .filter(({ status }) => bands.has(status.band));

    // Zoomed out, every dot goes on the canvas once and stays through pans. Zoomed
    // in, markers are added as vehicles come into view and never taken off until
    // the zoom drops back: clearing on each move would shut a popup the moment
    // Leaflet pans the map to fit it.
    let drawnAs: "dots" | "icons" | null = null;
    const placed = new Set<string>();
    /** Draw the dots, or the in-view markers, for the current zoom. */
    const draw = (): void => {
      const icons = map.getZoom() >= ICON_ZOOM;
      if (!icons && drawnAs === "dots") return;
      if ((icons ? "icons" : "dots") !== drawnAs) {
        layer.clearLayers();
        placed.clear();
        drawnAs = icons ? "icons" : "dots";
      }
      const view = map.getBounds().pad(0.25);
      for (const { v, status } of drawn) {
        if (!icons) {
          L.circleMarker([v.lat, v.lon], {
            renderer,
            radius: v.mode === "BUS" ? 4 : 6,
            weight: 1,
            color: PALETTE.surface,
            fillColor: colour[status.band],
            fillOpacity: 0.9,
          })
            .bindPopup(popupHtml(v, status.detail, operatorsRef.current))
            .addTo(layer);
          continue;
        }
        if (placed.has(v.id) || !view.contains([v.lat, v.lon])) continue;
        placed.add(v.id);
        const size = v.mode === "BUS" ? 30 : 34;
        const html =
          `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;` +
          `box-sizing:border-box;border-radius:9999px;border:2px solid #fff;color:#fff;` +
          `font-size:${Math.round(size * 0.55)}px;box-shadow:0 1px 3px rgb(0 0 0 / 0.4);` +
          `background:${colour[status.band]}">${glyph[v.mode]}</span>`;
        L.marker([v.lat, v.lon], {
          icon: L.divIcon({ className: "", html, iconSize: [size, size] }),
          keyboard: false,
        })
          .bindPopup(popupHtml(v, status.detail, operatorsRef.current))
          .addTo(layer);
      }
    };
    draw();
    map.on("moveend", draw);

    // Frame the vehicles once, on the core rather than every outlier (see
    // coreBounds); after that the reader's pan and zoom are kept. Every band
    // counts, so a toggle never decides where the map opens.
    const core = coreBounds(shown.map((v) => [v.lat, v.lon] as const));
    if (!framed.current && core) {
      framed.current = true;
      map.fitBounds(L.latLngBounds(core), { padding: [16, 16] });
    }
    return () => {
      map.off("moveend", draw);
    };
  }, [vehicles, mode, bands]);

  /**
   * Ask for the reader's position and fly to it, marking where they are with a
   * dot and a ring for how sure the browser is. Asked on the press rather than on
   * load: a prompt nobody asked for gets refused, and iOS only shows it after a tap.
   */
  const locate = (): void => {
    const m = mapRef.current;
    if (!m) return;
    if (!("geolocation" in navigator)) {
      setLocateNote("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setLocateNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { L, map, hereLayer } = m;
        const here = L.latLng(pos.coords.latitude, pos.coords.longitude);
        if (!L.latLngBounds(AUCKLAND_BOUNDS).contains(here)) {
          setLocateNote("You look to be outside Auckland, so there is nothing nearby to show.");
          return;
        }
        hereLayer.clearLayers();
        // Ink, which no vehicle dot uses: the on-time blue would pass for a bus.
        const ink = cssVar("--color-at-ink");
        L.circle(here, {
          radius: pos.coords.accuracy,
          color: ink,
          weight: 1,
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(hereLayer);
        L.circleMarker(here, {
          radius: 7,
          weight: 3,
          color: PALETTE.surface,
          fillColor: ink,
          fillOpacity: 1,
          interactive: false,
        }).addTo(hereLayer);
        // The reader chose this view, so the first poll must not frame it away.
        framed.current = true;
        // Centred on the reader and wide enough for the nearest few vehicles (see
        // nearbyFrame). Short, so the zoom reads as a move rather than a flight.
        const shown = (vehiclesRef.current ?? []).filter((v) => !mode || v.mode === mode);
        const frame = nearbyFrame(
          [here.lat, here.lng],
          pos.coords.accuracy,
          shown.map((v) => [v.lat, v.lon] as const),
        );
        map.flyToBounds(frame, { padding: [24, 24], maxZoom: NEAR_MAX_ZOOM, duration: 0.8 });
      },
      (err) => {
        setLocating(false);
        setLocateNote(
          err.code === err.PERMISSION_DENIED
            ? "Location is turned off for this site. Allow it in your browser's settings to zoom to where you are."
            : "Your location could not be found. Try again in a moment.",
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div ref={divRef} className="isolate h-full w-full bg-at-bg" />
      <div ref={glyphRef} hidden>
        {MODES.map((md) => {
          const { Icon } = modeGlyph(md);
          return <Icon key={md} data-mode={md} />;
        })}
      </div>
      {/* Clear of Leaflet's attribution in the corner below it. */}
      <button
        type="button"
        onClick={locate}
        disabled={!ready || locating}
        className="absolute right-2.5 bottom-7 z-10 flex items-center gap-1.5 border border-at-border bg-at-surface px-3 py-2 text-sm font-semibold text-at-ink shadow-sm hover:bg-at-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-at-shore disabled:opacity-60"
      >
        <LocateArrow className="text-at-shore" />
        {locating ? "Finding you…" : "Near me"}
      </button>
      {locateNote && (
        <p
          role="status"
          className="absolute right-2.5 bottom-19 z-10 max-w-64 border border-at-border bg-at-surface px-2 py-1 text-xs text-at-ink"
        >
          {locateNote}
        </p>
      )}
      {failed && (
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
