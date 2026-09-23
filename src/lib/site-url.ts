// src/lib/site-url.ts
// The site's own origin. Share cards, robots.txt and the sitemap all have to
// state absolute URLs rather than infer them from the request.

/** The production host Vercel provides. Unset locally and on a plain build. */
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

/** Where the dev server answers, when no deployment host is set. */
const DEV_ORIGIN = "http://localhost:3000";

/**
 * The production origin, or null when no deployment host is set.
 *
 * Null rather than a guess, because `metadataBase` reads it as "work it out from
 * the request": a preview deployment's cards then carry their own URL instead of
 * claiming production's.
 * @returns The origin, or null when it cannot be known.
 */
export function productionOrigin(): string | null {
  return productionHost ? `https://${productionHost}` : null;
}

/**
 * The origin to hand a crawler. Unlike {@link productionOrigin} this cannot
 * answer null, because robots.txt and the sitemap have no relative form.
 * @returns The origin, falling back to the dev server.
 */
export function crawlableOrigin(): string {
  return productionOrigin() ?? DEV_ORIGIN;
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
