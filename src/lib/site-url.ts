// src/lib/site-url.ts
// The site's own origin. Share cards, robots.txt and the sitemap all have to
// state absolute URLs rather than infer them from the request.

/**
 * The production host Vercel provides. Set on preview deployments too, so a
 * preview's cards and sitemap name production. Unset locally and on a plain build.
 */
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

/** Where the dev server answers, when no deployment host is set. */
const DEV_ORIGIN = "http://localhost:3000";

/**
 * The origin every absolute URL is built on: production's on Vercel, the dev
 * server's otherwise. Never null, because robots.txt and the sitemap have no
 * relative form, and an unset `metadataBase` makes every local build warn.
 * @returns The origin, without a trailing slash.
 */
export function siteOrigin(): string {
  return productionHost ? `https://${productionHost}` : DEV_ORIGIN;
}

/**
 * Whether this is the production deployment, as opposed to a preview or a local
 * run. Preview deployments answer on their own public URLs, so they need keeping
 * out of an index where they would compete with the real site.
 * @returns True on the production deployment only.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}
