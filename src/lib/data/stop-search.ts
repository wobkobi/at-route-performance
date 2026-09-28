// src/lib/data/stop-search.ts
// Find stops by name or AT stop code, for the compare page's picker. Returns
// canonical ids, so a station's platforms come back as the one station the
// stop page and the worst-stop boards already treat it as.

import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import { STATION_PREFIX, isLegacyStationId, stationId, stationName } from "@/lib/station";

/** One stop a search found, by the id its page is keyed on. */
export interface StopMatch {
  /** Canonical id: a `station:` id for a station's platforms, else the stop id. */
  id: string;
  /** Display name: the station's name for a station, else the stop's. */
  name: string;
  /** AT's stop code, for a single stop; null for a station, which has several. */
  code: string | null;
}

/** Raw rows read per search, before platforms fold into their station. */
const SCAN_LIMIT = 80;

/**
 * Stops whose name contains `q` (any case) or whose AT stop code is `q`,
 * folded to one row per station. Codes are what riders read off the pole, so an
 * exact code comes first. Cached for a day: stop names change with the GTFS
 * sync, not by the hour.
 *
 * Two kinds of row need folding beyond what {@link stationId} does alone. A
 * station's own parent row ("Waitemata Train Station", code 133) carries no
 * parent fields, so it is spotted by having platforms that point at it. And
 * platform rows from older feeds, stored before the parent fields were, fold to
 * a name-keyed station id; that one is dropped when the parent-keyed station of
 * the same name is already in the list, so a station shows once.
 * @param q - The search text; under two characters finds nothing.
 * @param limit - Most matches to return.
 * @returns The matches, exact code first, then by name.
 */
export async function searchStops(q: string, limit = 12): Promise<StopMatch[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  return unstable_cache(
    async () => {
      const rows = await prisma.stop.findMany({
        where: {
          OR: [{ code: text }, { name: { contains: text, mode: "insensitive" } }],
        },
        select: { id: true, name: true, code: true, parentStation: true, platformCode: true },
        take: SCAN_LIMIT,
      });
      const loose = rows.filter((r) => !r.parentStation).map((r) => r.id);
      const parents = new Set(
        loose.length === 0
          ? []
          : (
              await prisma.stop.findMany({
                where: { parentStation: { in: loose } },
                select: { parentStation: true },
                distinct: ["parentStation"],
              })
            ).map((p) => p.parentStation),
      );
      const byId = new Map<string, StopMatch & { exact: boolean }>();
      for (const r of rows) {
        const parts = { parentStation: r.parentStation, platformCode: r.platformCode };
        const id = parents.has(r.id) ? `${STATION_PREFIX}${r.id}` : stationId(r.id, r.name, parts);
        const station = id !== r.id;
        const prev = byId.get(id);
        const exact = r.code === text;
        if (prev) {
          prev.exact ||= exact;
          continue;
        }
        byId.set(id, {
          id,
          name: station ? stationName(r.name, parts) : r.name,
          code: station ? null : r.code,
          exact,
        });
      }
      const keyedNames = new Set(
        [...byId.values()]
          .filter((m) => m.id.startsWith(STATION_PREFIX) && !isLegacyStationId(m.id))
          .map((m) => m.name.toLowerCase()),
      );
      return [...byId.values()]
        .filter((m) => !isLegacyStationId(m.id) || !keyedNames.has(m.name.toLowerCase()))
        .sort((a, b) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name, "en-NZ"))
        .slice(0, limit)
        .map((m) => ({ id: m.id, name: m.name, code: m.code }));
    },
    ["stop-search-v2", text.toLowerCase(), String(limit)],
    { revalidate: 86400 },
  )();
}
