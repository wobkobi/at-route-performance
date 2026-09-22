// src/lib/map-tiles.ts
// The basemap tile URL, with the CARTO key only where the key is allowed.

/** CARTO Positron raster tiles, without a key. */
const CARTO_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

// Loopback hosts, optionally with a port. CARTO restricts a key to real
// hostnames, so these can never be allow-listed and a key sent from one only
// collects 403s.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The Vercel hosts the key may go out from: the production domain, the
 * branch's stable preview alias (at-route-performance-git-dev-...), and on a
 * preview build the deployment's own URL (at-route-performance-<hash>-...), so
 * any shared preview link draws clean tiles. A production build leaves its own
 * deployment URL out, so the post-deploy smoke, which visits that URL, never
 * depends on CARTO accepting it. The per-commit URLs change on every push, so
 * CARTO has to allow them by pattern rather than one by one.
 */
export const VERCEL_KEY_HOSTS = [
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" ? process.env.NEXT_PUBLIC_VERCEL_URL : undefined,
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
