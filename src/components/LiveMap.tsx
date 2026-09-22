"use client";
// src/components/LiveMap.tsx
// The live page's network map: every vehicle on a run as a dot in its delay
// colour, redrawn from /api/live every two minutes. Dots are drawn on one canvas
// rather than as DOM markers, since a weekday peak puts well over a thousand
// vehicles on the map at once. The table under the map carries the same service
// for keyboard and screen-reader readers, so the dots are not focusable.

import { cn } from "@/lib/cn";
import type { LiveMapVehicle, LiveMode } from "@/lib/live-routes";
import { VERCEL_KEY_HOSTS, cartoTileUrl } from "@/lib/map-tiles";
import { liveRunHref } from "@/lib/vehicle-detail";
import { vehicleStatus } from "@/lib/vehicle-status";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState, type JSX } from "react";

/** How often to refresh while the tab is visible; the server caches the feed for as long. */
const POLL_MS = 120_000;

/** Central Auckland, for the view before the first poll lands. */
const AUCKLAND: [number, number] = [-36.8485, 174.7633];

/** The word a vehicle's popup names it by. */
const MODE_WORD: Record<LiveMode, string> = { BUS: "Bus", TRAIN: "Train", FERRY: "Ferry" };

/**
 * Escape HTML special characters in feed strings before they go into popup HTML.
 * @param s - Raw string.
 * @returns HTML-safe string.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Resolve an AT colour token from globals.css, since canvas paths take a colour
 * value rather than a class.
 * @param name - The custom property.
 * @returns Its computed value.
 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A vehicle's popup: its route and name, its delay in the words the route maps
 * use, and links to its run and its own page.
 * @param v - The vehicle.
 * @param detail - Its delay line.
 * @returns Popup HTML.
 */
function popupHtml(v: LiveMapVehicle, detail: string): string {
  const name = `${MODE_WORD[v.mode]} ${v.label ?? v.id}`;
  const cars = v.cars ? ` &middot; ${v.cars} cars` : "";
  const run = liveRunHref({ routeId: v.slug, tripId: v.tripId });
  return (
    `<strong>Route ${esc(v.slug)}</strong><br>${esc(name)}${cars}<br>${esc(detail)}<br>` +
    `<a href="${esc(run)}">Open this run</a> &middot; ` +
    `<a href="/vehicle/${encodeURIComponent(v.id)}">This vehicle</a>`
  );
}

/**
 * The network map.
 * @param props - Component props.
 * @param props.mode - Show one mode's vehicles, or null for every mode.
 * @param props.className - Height and size classes.
 * @returns The map container.
 */
export default function LiveMap({
  mode,
  className,
}: {
  mode: LiveMode | null;
  className?: string;
}): JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{
    L: typeof Leaflet;
    map: Leaflet.Map;
    layer: Leaflet.LayerGroup;
    renderer: Leaflet.Canvas;
  } | null>(null);
  // The last poll's vehicles, so a mode change redraws without refetching.
  const [vehicles, setVehicles] = useState<LiveMapVehicle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const framed = useRef(false);

  // Build the map once.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const L = (await import("leaflet")) as typeof import("leaflet");
      if (dead || !divRef.current) return;
      // Wheel zoom and one-finger drag off, as on the route maps, so the page
      // still scrolls past a map that fills a phone screen.
      const map = L.map(divRef.current, { scrollWheelZoom: false, dragging: !L.Browser.mobile });
      map.setView(AUCKLAND, 11);
      L.tileLayer(
        cartoTileUrl(window.location.host, process.env.NEXT_PUBLIC_CARTO_API_KEY, VERCEL_KEY_HOSTS),
        {
          maxZoom: 19,
          subdomains: "abcd",
          attribution: "© OpenStreetMap contributors © CARTO",
          referrerPolicy: "strict-origin-when-cross-origin",
        },
      ).addTo(map);
      // A bigger hit tolerance, so a tap near a 5px dot still opens it.
      const renderer = L.canvas({ tolerance: 6 });
      mapRef.current = { L, map, layer: L.layerGroup().addTo(map), renderer };
      setReady(true);
    })();
    return () => {
      dead = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
  }, []);

  // Poll while the tab is visible; a return to the tab polls straight away when
  // the last positions are a full poll old.
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    const ctrl = new AbortController();
    let lastPoll = 0;
    /** Fetch every vehicle on a run and hand them to the redraw. */
    const poll = async (): Promise<void> => {
      lastPoll = Date.now();
      try {
        const res = await fetch("/api/live", { cache: "no-store", signal: ctrl.signal });
        if (dead) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = (await res.json()) as { vehicles: LiveMapVehicle[] };
        if (dead) return;
        setFailed(false);
        setVehicles(data.vehicles);
      } catch {
        if (!dead) setFailed(true);
      }
    };
    /** Poll on returning to the tab, when the last positions are a full poll old. */
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && Date.now() - lastPoll >= POLL_MS) void poll();
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready]);

  // Redraw on each poll and on a mode change. An open popup closes with its
  // dot; a two-minute redraw is rare enough that keying dots by id is not worth it.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !vehicles) return;
    const { L, map, layer, renderer } = m;
    layer.clearLayers();
    const colour = {
      late: cssVar("--color-at-late"),
      early: cssVar("--color-at-early"),
      ontime: cssVar("--color-at-ontime"),
      unknown: cssVar("--color-at-muted"),
    };
    const shown = mode ? vehicles.filter((v) => v.mode === mode) : vehicles;
    for (const v of shown) {
      const status = vehicleStatus(v.delaySec, v.mode);
      L.circleMarker([v.lat, v.lon], {
        renderer,
        radius: v.mode === "BUS" ? 4 : 6,
        weight: 1,
        color: "#ffffff",
        fillColor: colour[status.band],
        fillOpacity: 0.9,
      })
        .bindPopup(popupHtml(v, status.detail))
        .addTo(layer);
    }
    // Frame the vehicles once; after that the reader's pan and zoom are kept.
    if (!framed.current && shown.length > 0) {
      framed.current = true;
      map.fitBounds(L.latLngBounds(shown.map((v) => [v.lat, v.lon])), { padding: [16, 16] });
    }
  }, [vehicles, mode]);

  return (
    <div className={cn("relative w-full", className)}>
      <div ref={divRef} className="isolate h-full w-full bg-at-bg" />
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
