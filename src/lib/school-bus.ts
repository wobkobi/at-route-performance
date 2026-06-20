// src/lib/school-bus.ts

/**
 * AT school services carry an `S` + three-digit code, optionally with a trailing
 * variant letter, e.g. `S046`, `S046D`, `S001N`. In the feed this code lives in
 * the route's long name (the short name is the plain number, e.g. `046`), so
 * callers should test both names.
 */
const SCHOOL_BUS_RE = /^S\d{3}[A-Z]*$/i;

/**
 * Whether a route is a school service, by any of its names. Pass both the short
 * and long name, since the `S###` code is usually in the long name.
 * @param names - Candidate names (e.g. short and long route names); nullables ignored.
 * @returns True when any name is a school-service code.
 */
export function isSchoolBus(...names: Array<string | null | undefined>): boolean {
  return names.some((n) => !!n && SCHOOL_BUS_RE.test(n));
}
