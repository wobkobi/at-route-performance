// src/lib/data/routes.ts
// Route identity: slugs to ids, lineage-aware id sets, the CRL successor gate and the directory.
import { MS_IN_DAY } from "@/lib/data/cache";
import { prisma, runCommand } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import {
  allSuccessorSlugs,
  directoryLineageRows,
  predecessorSlugs,
  successorSlug,
} from "@/lib/route-lineage";
import { routeSlug, routeVersion } from "@/lib/route-slug";

/**
 * Every AT route id sharing one slug - the same route across feed-version
 * republishes (see {@link routeSlug}) - newest version first, or empty when the
 * slug matches nothing. Cached hourly; route ids only change on the GTFS sync.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns Matching route ids, newest version first.
 */
async function routeIdsMatching(slug: string): Promise<string[]> {
  return unstable_cache(
    async () => {
      const routes = await prisma.route.findMany({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      return routes
        .map((r) => r.id)
        .filter((id) => routeSlug(id) === slug)
        .sort((a, b) => routeVersion(b) - routeVersion(a));
    },
    ["route-ids-matching", slug],
    { revalidate: 3600 },
  )();
}

/**
 * A route's own ids across feed-version republishes, newest first, without the
 * ids of any line it replaced. Falls back to the input when nothing matches, so
 * a full id still works and callers can always read `[0]`.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns The route's own ids, newest version first (or `[slug]` when none).
 */
export async function ownRouteIds(slug: string): Promise<string[]> {
  const ids = await routeIdsMatching(slug);
  return ids.length > 0 ? ids : [slug];
}

/**
 * A route's own ids (see {@link ownRouteIds}) followed by the ids of any line it
 * replaced (see {@link predecessorSlugs}). Lets route queries aggregate over all
 * versions (so history doesn't fragment when AT bumps the suffix) and across the
 * CRL rename (so a renamed line keeps its archive), and resolve a slug URL to a
 * concrete id.
 *
 * The requested slug's own ids always come first: callers read `[0]` as the
 * newest id for schedule and metadata lookups, which must never resolve to a
 * retired line.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns Matching route ids, newest version first (or `[slug]` when none).
 */
export async function routeIdsForSlug(slug: string): Promise<string[]> {
  const [own, ...predecessors] = await Promise.all([
    ownRouteIds(slug),
    ...predecessorSlugs(slug).map(routeIdsMatching),
  ]);
  return [...own, ...predecessors.flat()];
}

/** How far back {@link routeHasTraffic} looks for an arrival on a line's own ids. */
const TRAFFIC_LOOKBACK_MS = 7 * MS_IN_DAY;

/**
 * Whether a route has recorded any arrival on its own ids in the last week. A
 * single indexed point read (`routeId, scheduledAt`), cached for ten minutes so
 * the answer flips within that long of a line's first train.
 * @param slug - A version-stripped route slug.
 * @returns True once an arrival event exists for the route in the lookback.
 */
export async function routeHasTraffic(slug: string): Promise<boolean> {
  return unstable_cache(
    async () => {
      const ids = await ownRouteIds(slug);
      const since = new Date(Date.now() - TRAFFIC_LOOKBACK_MS);
      const hit = await prisma.arrivalEvent.findFirst({
        where: { routeId: { in: ids }, scheduledAt: { gte: since } },
        select: { id: true },
      });
      return hit !== null;
    },
    ["route-has-traffic", slug],
    { revalidate: 600 },
  )();
}

/**
 * Find the canonical version-stripped slug for a route, case-insensitively.
 * Returns the exact slug when it exists (fast path), or the slug of the first
 * case-insensitive match (for URLs typed in the wrong case), or null when no
 * route exists. Cached hourly per lowercased slug; route ids only change on
 * the GTFS static sync.
 * @param slug - A version-stripped route slug to look up.
 * @returns The canonical slug, or null when unknown.
 */
export async function findCanonicalRouteSlug(slug: string): Promise<string | null> {
  return unstable_cache(
    async () => {
      // Exact match first (indexed _id lookup); case-insensitive fallback for
      // user-typed paths like /route/nx1 > /route/NX1.
      const exact = await prisma.route.findFirst({
        where: { OR: [{ id: slug }, { id: { startsWith: `${slug}-` } }] },
        select: { id: true },
      });
      if (exact) return routeSlug(exact.id);
      const ci = await prisma.route.findFirst({
        where: {
          OR: [
            { id: { equals: slug, mode: "insensitive" } },
            { id: { startsWith: `${slug}-`, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      return ci ? routeSlug(ci.id) : null;
    },
    ["canonical-route-slug", slug.toLowerCase()],
    { revalidate: 3600 },
  )();
}

/**
 * The live slug a retired train line's URL should move to. Retired lines keep
 * their Route row forever (the GTFS sync only upserts), so a stale link resolves
 * rather than 404s - this is what turns it into a redirect instead. The
 * successor's own row lands in static GTFS days before its first train (AT
 * published `S-C-201` on 10 September for a 13 September start), so existence
 * alone would redirect early onto a line with nothing to show; the redirect
 * waits until the successor has carried traffic (see {@link routeHasTraffic}).
 * @param slug - A canonical route slug.
 * @returns The successor's canonical slug, or null while the retired line's own page should stand.
 */
export async function findSuccessorRouteSlug(slug: string): Promise<string | null> {
  const candidate = successorSlug(slug);
  if (candidate === null) return null;
  const found = await findCanonicalRouteSlug(candidate);
  if (found === null) return null;
  return (await routeHasTraffic(found)) ? found : null;
}

/** A route as listed in the directory. */
export interface DirectoryRoute {
  id: string;
  shortName: string | null;
  longName: string | null;
  mode: string;
  colour: string | null;
}

/** How stale a route's `lastSeenAt` may be before it counts as retired (the sync runs daily). */
const ROUTE_STALE_MS = 2 * MS_IN_DAY;

/**
 * Routes AT's most recent GTFS sync still published, for the route directory.
 *
 * Retired routes keep their row - they hold years of retained summaries, and
 * their URLs still redirect - so listing every row would show lines that no
 * longer run. Four train lines retire at once at the CRL cutover. A row with
 * no stamp was absent from the last sync, so once any stamp exists it counts
 * as retired too; only a database no sync has ever stamped lists every row.
 *
 * Around the cutover the feed carries a retired line and its successor at the
 * same time, so the list is then trimmed to whichever of the two is running
 * (see {@link directoryLineageRows}). That trim sits outside the hourly cache
 * because it turns on {@link routeHasTraffic}, which flips within ten minutes
 * of the successor's first train.
 * @returns Current routes, ordered by short name.
 */
export async function getDirectoryRoutes(): Promise<DirectoryRoute[]> {
  const rows = await unstable_cache(
    async () => {
      const newest = await prisma.route.findFirst({
        where: { lastSeenAt: { not: null } },
        orderBy: { lastSeenAt: "desc" },
        select: { lastSeenAt: true },
      });
      const cutoff = newest?.lastSeenAt
        ? new Date(newest.lastSeenAt.getTime() - ROUTE_STALE_MS)
        : null;
      return prisma.route.findMany({
        where: cutoff ? { lastSeenAt: { gte: cutoff } } : {},
        select: { id: true, shortName: true, longName: true, mode: true, colour: true },
        orderBy: { shortName: "asc" },
      });
    },
    ["directory-routes"],
    { revalidate: 3600 },
  )();
  const successors = allSuccessorSlugs();
  const traffic = await Promise.all(successors.map(routeHasTraffic));
  const running = new Set(successors.filter((_, i) => traffic[i]));
  return directoryLineageRows(rows, running);
}

/**
 * The two fields that name a line: its short name and its mode, off the newest
 * version of the route (see {@link routeIdsForSlug}).
 *
 * This is what a page title or a share card needs, and it is all they need, so
 * it is read on its own rather than off a full summary - a title has no use for
 * arrivals, and a summary would cost a seven-day aggregation and a window to
 * aggregate over, which is a clock read the prerendered head cannot make.
 * @param slug - A version-stripped route slug (or a full route id).
 * @returns The route's short name and mode, or null when the slug matches nothing.
 */
export async function getRouteLabel(
  slug: string,
): Promise<{ shortName: string | null; mode: string } | null> {
  // Never empty (it falls back to the slug), but read with one so the newest id
  // is a plain string for the cache key.
  const newest = (await routeIdsForSlug(slug))[0] ?? slug;
  return unstable_cache(
    async () =>
      prisma.route.findUnique({
        where: { id: newest },
        select: { shortName: true, mode: true },
      }),
    ["route-label", newest],
    { revalidate: 3600 },
  )();
}

/**
 * All routes as a `routeId > mode` map. Cached with a long TTL since routes
 * only change when GTFS is re-ingested. Used to resolve dominant mode per stop.
 * @returns Map from route id to its mode.
 */
export async function getRouteModeMap(): Promise<Map<string, "BUS" | "TRAIN" | "FERRY">> {
  const pairs = await unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({ select: { id: true, mode: true } });
      return rows.map((r) => [r.id, r.mode] as const);
    },
    ["route-mode-map"],
    { revalidate: 3600 },
  )();
  return new Map(pairs as [string, "BUS" | "TRAIN" | "FERRY"][]);
}

/**
 * Look up short names for a set of route ids. Returns a map of id to shortName,
 * falling back to the raw id when the route has no shortName set.
 * @param routeIds - Route ids to look up.
 * @returns Record mapping each id to its display name.
 */
export async function getRouteNames(routeIds: string[]): Promise<Record<string, string>> {
  if (routeIds.length === 0) return {};
  const all = await allRouteNames();
  const out: Record<string, string> = {};
  for (const id of routeIds) {
    const name = all[id];
    if (name !== undefined) out[id] = name;
  }
  return out;
}

/**
 * Every route's display name by id, under a single cache key.
 *
 * Caching the requested subset instead keyed on the set of ids asked for, so a
 * board showing a different set of routes per mode, sort, page and day almost
 * never met a warm entry and minted a new one each time - an unbounded number of
 * entries for a table that is only a few hundred rows whole. One key holds for a
 * day, as {@link getRouteModeMap} does over the same collection.
 * @returns Map from route id to its short name, falling back to the id.
 */
async function allRouteNames(): Promise<Record<string, string>> {
  return unstable_cache(
    async () => {
      const rows = await prisma.route.findMany({ select: { id: true, shortName: true } });
      return Object.fromEntries(rows.map((r) => [r.id, r.shortName ?? r.id]));
    },
    ["route-names-all"],
    { revalidate: 86400 },
  )();
}

/**
 * The slugs of the routes with the most arrivals over the last week, busiest
 * first. Read from `DailyRouteSummary`, which is already aggregated per route
 * per day, so this never scans `ArrivalEvent`.
 *
 * Used to pick which route pages are prerendered at build. Arrivals are the
 * right ranking for that: a route needs `MIN_BOARD_EVENTS` before any board
 * will list it, so the busiest routes are the ones the boards link to and
 * therefore the ones a reader's browser prefetches.
 *
 * Slugs rather than ids, because that is what a route URL carries - and two
 * feed versions of one route share a slug, so the list is deduplicated after
 * stripping and can come back shorter than `limit`.
 * @param limit - How many slugs to return.
 * @returns Version-stripped slugs, busiest first.
 */
export async function getBusiestRouteSlugs(limit: number): Promise<string[]> {
  return unstable_cache(
    async () => {
      const since = new Date(Date.now() - 7 * MS_IN_DAY);
      const result = (await runCommand(() =>
        prisma.$runCommandRaw({
          aggregate: "DailyRouteSummary",
          pipeline: [
            { $match: { date: { $gte: { $date: since.toISOString() } } } },
            { $group: { _id: "$routeId", events: { $sum: "$events" } } },
            { $sort: { events: -1 } },
            // Room for the slug fold below to collapse republished versions.
            { $limit: limit * 2 },
          ] as never,
          cursor: { batchSize: 1000 },
        }),
      )) as unknown as { cursor: { firstBatch: { _id: string }[] } };
      const slugs: string[] = [];
      for (const row of result.cursor.firstBatch) {
        const slug = routeSlug(row._id);
        if (!slugs.includes(slug)) slugs.push(slug);
        if (slugs.length === limit) break;
      }
      return slugs;
    },
    ["busiest-route-slugs", String(limit)],
    { revalidate: 86400 },
  )();
}
