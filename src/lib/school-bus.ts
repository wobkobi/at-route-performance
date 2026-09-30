// src/lib/school-bus.ts
// Recognise AT school-service routes by their `S###` code in a route name.

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

/** How much including school services added to each count in a summary. */
export interface SchoolDelta {
  events: number;
  cancelled: number;
  route_count: number;
}

/**
 * What school services add to a summary's counts: their routes, those routes'
 * arrivals, and the cancelled count's difference with them left out, which the
 * caller reads separately since cancellations leave no arrival row.
 * @param rows - The shown routes, school services included.
 * @param cancelled - The cancelled count with school services included.
 * @param cancelledWithout - The same count with them left out.
 * @returns The amounts added, each 0 or more.
 */
export function schoolDelta(
  rows: ReadonlyArray<{ shortName?: string | null; longName?: string | null; events: number }>,
  cancelled: number | null,
  cancelledWithout: number | null,
): SchoolDelta {
  const school = rows.filter((r) => isSchoolBus(r.shortName, r.longName));
  return {
    events: school.reduce((sum, r) => sum + r.events, 0),
    cancelled: Math.max(0, (cancelled ?? 0) - (cancelledWithout ?? 0)),
    route_count: school.length,
  };
}

/**
 * Which services the School buses filter keeps: every service but school ones
 * (the default), every service, or school ones alone.
 */
export type SchoolFilter = "exclude" | "include" | "only";

/** The filter's choices in menu order, with their labels. */
export const SCHOOL_FILTERS: ReadonlyArray<{ key: SchoolFilter; label: string }> = [
  { key: "exclude", label: "Leave out" },
  { key: "include", label: "Include" },
  { key: "only", label: "Only school buses" },
];

/**
 * Read the `school` query param. `1` is include, the value links carried when
 * the filter was a plain on/off switch; anything unreadable is the default.
 * @param value - The raw param.
 * @returns The filter.
 */
export function parseSchoolFilter(value: string | undefined): SchoolFilter {
  if (value === "1" || value === "include") return "include";
  if (value === "only") return "only";
  return "exclude";
}

/**
 * The `school` query param for a filter, or undefined for the default so the
 * param comes off.
 * @param filter - The filter.
 * @returns The param value.
 */
export function schoolFilterParam(filter: SchoolFilter): string | undefined {
  if (filter === "include") return "1";
  if (filter === "only") return "only";
  return undefined;
}

/**
 * Whether a service passes the filter.
 * @param filter - The filter.
 * @param school - Whether the service is a school one.
 * @returns True when the filter keeps it.
 */
export function schoolAllows(filter: SchoolFilter, school: boolean): boolean {
  if (filter === "include") return true;
  return filter === "only" ? school : !school;
}

/**
 * What a filter box shows for the choice, or null for the default, which shows
 * the plain label.
 * @param filter - The filter.
 * @returns The summary, or null.
 */
export function schoolFilterSummary(filter: SchoolFilter): string | null {
  if (filter === "include") return "Included";
  return filter === "only" ? "Only" : null;
}
