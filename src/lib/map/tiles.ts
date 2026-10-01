// src/lib/map/tiles.ts
// The basemap: its tile URL, with the CARTO key only where the key is allowed,
// and the map both live maps start from.

import { wheelZoomOnHover } from "@/lib/map/wheel";
import type * as Leaflet from "leaflet";

/** CARTO Positron raster tiles, without a key. */
const CARTO_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

// Loopback hosts, optionally with a port. CARTO restricts a key to real
// hostnames, so these can never be allow-listed and a key sent from one only
// collects 403s.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The Vercel hosts the key may go out from: the production domain, and the
 * branch's stable preview alias (at-route-performance-git-dev-...), so a shared
 * preview link draws clean tiles. Per-deployment URLs
 * (at-route-performance-<hash>-...) are left out: CARTO's allow-list takes one
 * whole-label wildcard, so the only pattern matching them is *.vercel.app,
 * which would let any Vercel site spend the key's quota.
 */
export const VERCEL_KEY_HOSTS = [
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
] as const;

/**
 * The CARTO tile URL for a page served from `host`. CARTO stamps "API KEY
 * REQUIRED" across every tile requested without `?key=`, so the key (free, from
 * carto.com/basemaps/apikey) is appended when set; it ships to the browser in
 * each tile URL, so it is restricted to the site's host in the CARTO dashboard.
 * A restricted key answers 403 - a blank map - from any other host, and every
 * Vercel deployment also answers on its own URL (the one the post-deploy smoke
 * visits), so on Vercel the key only goes out from the hosts in
 * {@link VERCEL_KEY_HOSTS} and other hosts get the watermarked tiles. Each of
 * those hosts must be on the key's allow-list in the CARTO dashboard.
 *
 * Off Vercel there is no production domain to compare, so the key goes out from
 * anywhere it could plausibly be accepted - but never from loopback, which
 * CARTO cannot allow-list. Without that guard a local `next start` with the key
 * set renders every map blank, and the smoke test reads those 403s as eight
 * failed pages.
 * @param host - The page's host (`window.location.host`).
 * @param key - The CARTO key, when set.
 * @param keyHosts - The hosts allowed to send the key; none known means off Vercel.
 * @returns The Leaflet tile URL template.
 */
export function cartoTileUrl(
  host: string,
  key: string | undefined,
  keyHosts: readonly (string | undefined)[],
): string {
  const known = keyHosts.filter((h): h is string => !!h);
  if (!key || LOOPBACK_HOST.test(host) || (known.length > 0 && !known.includes(host))) {
    return CARTO_TILES;
  }
  return `${CARTO_TILES}?key=${encodeURIComponent(key)}`;
}

/** Central Auckland, for a map's view before it has anything to frame. */
export const AUCKLAND_CENTRE: [number, number] = [-36.8485, 174.7633];

/** How often a live map refreshes its vehicles while the tab is visible; the server caches the feed for as long. */
export const MAP_POLL_MS = 120_000;

/**
 * A Leaflet map with the site's basemap, before any view or layers. The wheel
 * zooms only on a settled mouse (see {@link wheelZoomOnHover}); one-finger drag
 * stays on for touch, since every page caps its map below the screen's height, so
 * a swipe above or below it still scrolls the page. Zoom snaps to quarter steps,
 * so a fitted frame fills its box rather than rounding down a whole level.
 *
 * The site-wide Referrer-Policy is same-origin, which strips the Referer from
 * tile requests and fails a host-restricted CARTO key, so the tile layer sends
 * the origin only (no page path).
 * @param L - The Leaflet module, loaded by the caller on the client.
 * @param el - The map's container element.
 * @returns The map.
 */
export function createBaseMap(L: typeof Leaflet, el: HTMLElement): Leaflet.Map {
  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
  wheelZoomOnHover(map);
  L.tileLayer(
    cartoTileUrl(window.location.host, process.env.NEXT_PUBLIC_CARTO_API_KEY, VERCEL_KEY_HOSTS),
    {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: "© OpenStreetMap contributors © CARTO",
      referrerPolicy: "strict-origin-when-cross-origin",
    },
  ).addTo(map);
  return map;
}
