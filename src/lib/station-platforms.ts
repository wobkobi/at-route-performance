// src/lib/station-platforms.ts
// Whether a station page should break its figures down per platform, and in
// what order. Collapsing a parent's platforms into one stop fixed the navigation
// but it averages real differences away: measured over one completed service day
// (23 September 2026), Te Waihorotiu's Stop C ran 19% on time at four minutes
// early while its Stop A ran 92% at 45 seconds late, and the station's single
// on-time figure says neither. The breakdown gives that back - but only where
// there is something to give back, so a station whose platforms agree is not made
// to carry a table restating its own summary several times over.

/** One platform's figures inside a parent station. */
export interface PlatformStats {
  /** The platform's own GTFS stop id. */
  stop_id: string;
  /** AT's label for it: "Bay 8", "Stop C", "Pier 2", or a bare platform number. */
  label: string;
  events: number;
  avg_delay_sec: number | null;
  avg_abs_delay_sec: number | null;
  on_time_pct: number | null;
  /** Every route that called here, by the name a rider uses for it. */
  routes: string[];
  /** The platform's mode, which decides the early tolerance behind its colour. */
  mode: string;
}

/** A platform row on the page, with what only it serves worked out. */
export interface PlatformRow extends PlatformStats {
  /** Routes that called at no other platform of this station, sorted. */
  only_routes: string[];
}

/**
 * Fewest arrivals a platform needs in the window before its figures are shown.
 * A bay with four arrivals reads 75% or 100% on nothing, and at a big
 * interchange there are always a few: Manukau had 12 bays with arrivals that
 * day and one of them had four.
 *
 * The exact value is not load-bearing - raising it from 10 to 50 moved the
 * number of stations with two measurable platforms only from 94 to 87 - so it is
 * set where it stops reading noise as a figure rather than tuned to an outcome.
 */
export const MIN_PLATFORM_EVENTS = 10;

/**
 * How far apart the best and worst platform's on-time share must sit, in
 * percentage points, before the platforms count as genuinely differing.
 *
 * Measured across the 94 stations with two or more measurable platforms: the
 * spread is 1 point at the tenth percentile, 16 at the median and 55 at the
 * ninetieth. So a tenth of the stations have platforms that agree to within a
 * point, where a table would be five rows of the same number, and half differ by
 * more than a sixth of the scale. A 10-point bound keeps 56 of the 94.
 */
export const PLATFORM_SPREAD_PCT = 10;

/**
 * What to call this station's platforms, taken from the labels themselves so a
 * heading uses AT's own word: "bay" at Manukau, "pier" at the Downtown Ferry
 * Terminal. A station whose platforms AT numbers without a word ("Newmarket
 * Train Station 1") falls back to "platform".
 *
 * AT's word for a bus pole is **"Stop"**, and that one is not used: the page this
 * heads is itself headed "Stop", so "By stop" on a stop page is the same word for
 * the whole place and for one pole of it, on one screen. The rows still carry
 * AT's labels unchanged ("Stop C"); only the noun above them gives way, since a
 * heading has to say which of the two it means.
 * @param rows - The platform rows being shown.
 * @returns The noun, lowercased and singular.
 */
export function platformNoun(rows: readonly { label: string }[]): string {
  const words = new Set(rows.map((r) => /^([A-Za-z]+)\s/.exec(r.label)?.[1]?.toLowerCase() ?? ""));
  const only = words.size === 1 ? ([...words][0] ?? "") : "";
  return only === "" || only === "stop" ? "platform" : only;
}

/**
 * Whether these platforms ran differently enough to count as disagreeing. Shared
 * by the gate below and by the page, so the sentence a reader is given names the
 * reason the table is actually there: 7 of the 63 stations that show one do so
 * only because a route leaves from a single platform, and telling those readers
 * the platforms ran differently would be untrue.
 * @param rows - Platforms already past the arrivals floor.
 * @returns True when the best and worst on-time share differ by at least
 *   {@link PLATFORM_SPREAD_PCT}.
 */
export function platformsDiffer(rows: readonly { on_time_pct: number | null }[]): boolean {
  const shares = rows.map((p) => p.on_time_pct).filter((v): v is number => v != null);
  return shares.length >= 2 && Math.max(...shares) - Math.min(...shares) >= PLATFORM_SPREAD_PCT;
}

/**
 * Decide whether a station's platforms earn a breakdown, and return the rows if
 * they do. Two things earn it, and they are different readers' reasons:
 *
 * - **The platforms differ** by at least {@link PLATFORM_SPREAD_PCT}, so the
 *   station's single figure is an average of unlike things.
 * - **A route calls at one platform only**, so someone who wants that route
 *   needs the bay rather than the station's average. 42 of the 94 stations have
 *   at least one, and at Manukau nearly every bay serves a single route.
 *
 * Either alone is enough; together they reach 63 of the 94, which leaves 31
 * stations whose platforms both agree and share their routes showing nothing,
 * as intended.
 * @param stats - Every platform of the station that recorded arrivals.
 * @returns The rows to show, worst off schedule first, or empty to show none.
 */
export function platformBreakdown(stats: readonly PlatformStats[]): PlatformRow[] {
  const kept = stats.filter((p) => p.events >= MIN_PLATFORM_EVENTS);
  if (kept.length < 2) return [];

  // A route counted once across the kept platforms calls at only one of them.
  const platformsPerRoute = new Map<string, number>();
  for (const p of kept) {
    for (const route of new Set(p.routes)) {
      platformsPerRoute.set(route, (platformsPerRoute.get(route) ?? 0) + 1);
    }
  }

  const rows: PlatformRow[] = kept.map((p) => ({
    ...p,
    only_routes: [...new Set(p.routes)]
      .filter((r) => platformsPerRoute.get(r) === 1)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  }));

  if (!platformsDiffer(kept) && !rows.some((r) => r.only_routes.length > 0)) return [];

  // Worst off schedule first, as every other board at a stop is ordered. A
  // platform with no average sorts last rather than as zero; ties fall back to
  // the busier platform, then the label, so the order cannot move per request.
  return rows.sort(
    (a, b) =>
      (b.avg_abs_delay_sec ?? -1) - (a.avg_abs_delay_sec ?? -1) ||
      b.events - a.events ||
      a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}
