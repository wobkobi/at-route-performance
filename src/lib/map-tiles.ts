// src/lib/map-tiles.ts
// The basemap tile URL, with the CARTO key only where the key is allowed.

/** CARTO Positron raster tiles, without a key. */
const CARTO_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

/**
 * The CARTO tile URL for a page served from `host`. CARTO stamps "API KEY
 * REQUIRED" across every tile requested without `?key=`, so the key (free, from
 * carto.com/basemaps/apikey) is appended when set; it ships to the browser in
 * each tile URL, so it is restricted to the site's host in the CARTO dashboard.
 * A restricted key answers 403 - a blank map - from any other host, and every
 * Vercel deployment also answers on its own URL (the one the post-deploy smoke
 * visits), so on Vercel the key only goes out from the project's production
 * domain and other hosts get the watermarked tiles. Off Vercel, where there is
 * no production domain to compare, the key always goes out.
 * @param host - The page's host (`window.location.host`).
 * @param key - The CARTO key, when set.
 * @param productionHost - The Vercel project's production domain, when known.
 * @returns The Leaflet tile URL template.
 */
export function cartoTileUrl(
  host: string,
  key: string | undefined,
  productionHost: string | undefined,
): string {
  if (!key || (productionHost && host !== productionHost)) return CARTO_TILES;
  return `${CARTO_TILES}?key=${encodeURIComponent(key)}`;
}
