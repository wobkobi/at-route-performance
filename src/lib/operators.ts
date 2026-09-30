// src/lib/operators.ts
// The companies AT contracts to run its services. A route carries its
// operator's code (`Route.agencyId`, from the route sync); the operator list
// itself comes from AT's GTFS `agency.txt`, stored by the nightly shapes sync
// (src/lib/feed/gtfs-agencies.ts). These helpers turn a code into a name and a
// URL slug against that list, and stay free of the database so the maps can use
// them.

/** One operator. */
export interface Operator {
  /** AT's agency code: "NZB", "RTH". */
  code: string;
  /** The name AT publishes, without a trailing "Ltd". */
  name: string;
  /** The `/operator/[slug]` path segment, fixed when the operator is first seen. */
  slug: string;
  /** Whether AT's latest agency list still names it. */
  current: boolean;
}

/**
 * The operator behind an agency code. A code missing from the list (an
 * operator AT adds before the next sync stores it) still gets a usable entry:
 * its code as the name and the lower-cased code as the slug, which
 * {@link operatorBySlug} resolves the same way.
 * @param code - The route's `agencyId`.
 * @param operators - The stored operator list.
 * @returns The operator, or null when the route has no code.
 */
export function operatorOf(
  code: string | null | undefined,
  operators: readonly Operator[],
): Operator | null {
  if (!code) return null;
  return (
    operators.find((o) => o.code === code) ?? {
      code,
      name: code,
      slug: code.toLowerCase(),
      current: true,
    }
  );
}

/**
 * The operator a page slug names.
 * @param slug - The `/operator/[slug]` segment.
 * @param operators - The stored operator list.
 * @param knownCodes - Agency codes present in the data, so a code missing from
 *   the list can still be reached by its lower-cased fallback slug.
 * @returns The operator, or null when no operator has that slug.
 */
export function operatorBySlug(
  slug: string,
  operators: readonly Operator[],
  knownCodes: Iterable<string> = [],
): Operator | null {
  const listed = operators.find((o) => o.slug === slug);
  if (listed) return listed;
  for (const code of knownCodes) {
    if (!operators.some((o) => o.code === code) && code.toLowerCase() === slug) {
      return operatorOf(code, operators);
    }
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
