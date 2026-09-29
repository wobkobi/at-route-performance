// src/lib/operators.ts
// The companies AT contracts to run its services, as listed in the GTFS
// `agency.txt`. A route carries its operator's code (`Route.agencyId`, from the
// route sync); this table turns that code into a name and a URL slug. The slugs
// are fixed here rather than derived from the name, so an operator AT renames
// keeps its page address.

/** One operator. */
export interface Operator {
  /** AT's agency code: "NZB", "RTH". */
  code: string;
  /** The name AT publishes. */
  name: string;
  /** The `/operator/[slug]` path segment. */
  slug: string;
}

/** Every operator in AT's agency list, in alphabetical order by name. */
export const OPERATORS: readonly Operator[] = [
  { code: "AM", name: "AT Metro", slug: "at-metro" },
  { code: "ATMB", name: "AT Metro Bus", slug: "at-metro-bus" },
  { code: "BAYES", name: "Bayes Coachlines", slug: "bayes-coachlines" },
  { code: "BFL", name: "Belaire Ferries", slug: "belaire-ferries" },
  { code: "EXPNZ", name: "Explore Group", slug: "explore-group" },
  { code: "FGL", name: "Fullers360", slug: "fullers360" },
  { code: "GBT", name: "Go Bus", slug: "go-bus" },
  { code: "HE", name: "Howick and Eastern", slug: "howick-and-eastern" },
  { code: "ID", name: "Island Direct", slug: "island-direct" },
  { code: "MEX", name: "Mahu City Express", slug: "mahu-city-express" },
  { code: "NZB", name: "New Zealand Bus", slug: "new-zealand-bus" },
  { code: "RTH", name: "Ritchies Transport", slug: "ritchies-transport" },
  { code: "SLPH", name: "SeaLink Pine Harbour", slug: "sealink-pine-harbour" },
  { code: "SLTG", name: "SeaLink Travel Group", slug: "sealink-travel-group" },
  { code: "TZG", name: "Tranzit Group", slug: "tranzit-group" },
  { code: "WBC", name: "Waiheke Bus Company", slug: "waiheke-bus-company" },
  { code: "WRC", name: "Waikato Regional Council", slug: "waikato-regional-council" },
];

const BY_CODE = new Map(OPERATORS.map((o) => [o.code, o]));
const BY_SLUG = new Map(OPERATORS.map((o) => [o.slug, o]));

/**
 * The operator behind an agency code. A code missing from the table (an
 * operator AT adds before this list catches up) still gets a usable entry: its
 * code as the name and the lower-cased code as the slug, which
 * {@link operatorBySlug} resolves the same way.
 * @param code - The route's `agencyId`.
 * @returns The operator, or null when the route has no code.
 */
export function operatorOf(code: string | null | undefined): Operator | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? { code, name: code, slug: code.toLowerCase() };
}

/**
 * The operator a page slug names.
 * @param slug - The `/operator/[slug]` segment.
 * @param knownCodes - Agency codes present in the data, so a code missing from
 *   {@link OPERATORS} can still be reached by its lower-cased fallback slug.
 * @returns The operator, or null when no operator has that slug.
 */
export function operatorBySlug(slug: string, knownCodes: Iterable<string> = []): Operator | null {
  const listed = BY_SLUG.get(slug);
  if (listed) return listed;
  for (const code of knownCodes) {
    if (!BY_CODE.has(code) && code.toLowerCase() === slug) return operatorOf(code);
  }
  return null;
}

/**
 * The page for an operator.
 * @param op - The operator.
 * @returns Its `/operator/[slug]` path.
 */
export function operatorHref(op: Operator): string {
  return `/operator/${op.slug}`;
}
