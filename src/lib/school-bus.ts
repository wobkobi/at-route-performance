// src/lib/school-bus.ts

/** AT school services use a short name of `S` followed by three digits, e.g. `S123`. */
const SCHOOL_BUS_RE = /^S\d{3}$/i;

/**
 * Whether a route is a school service, by its short name (e.g. `S123`).
 * @param shortName - The route's short name (may be null).
 * @returns True for school-service routes.
 */
export function isSchoolBus(shortName: string | null | undefined): boolean {
  return !!shortName && SCHOOL_BUS_RE.test(shortName);
}
