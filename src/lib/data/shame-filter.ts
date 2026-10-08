// src/lib/data/shame-filter.ts
// The mode and school-service filter every shame, stop and cancellation read shares.
import { routeTable } from "@/lib/data/routes";
import type { Mode } from "@/lib/mode";
import type { DelayDirection } from "@/lib/rankings";
import { rowAllowedBySchool, type SchoolFilter } from "@/lib/school-bus";

/** School-service code regex (mirrors `isSchoolBus`) for the Shame filter. */
export const SCHOOL_BUS_REGEX = "^S[0-9]{3}[A-Z]*$";

/** Which runs the Shame board considers - mirrors the home page's filters. */
export interface ShameFilter {
  /** Restrict to this mode; null/undefined means every mode. */
  mode?: Mode | null;
  /** Which school services count (default "exclude", matching the home page default). */
  schools?: SchoolFilter;
  /**
   * Keep only stops running late or early on average; null/undefined keeps both.
   * Only the worst-stop reads honour it: the trip and route boards take the same
   * filter object and ignore this field.
   */
  direction?: DelayDirection;
}

/**
 * The `$match` stage applying the school filter to a pipeline that has joined
 * its Route as `$route`, or null when every service counts. A route is a school
 * one when either name carries the `S###` code; a missing Route has neither, so
 * it counts as an ordinary service.
 * @param schools - Which school services count.
 * @returns The stage, or null.
 */
export function schoolRouteMatch(schools: SchoolFilter): Record<string, unknown> | null {
  if (schools === "include") return null;
  const isSchool = {
    $or: [
      { $regexMatch: { input: { $ifNull: ["$route.shortName", ""] }, regex: SCHOOL_BUS_REGEX } },
      { $regexMatch: { input: { $ifNull: ["$route.longName", ""] }, regex: SCHOOL_BUS_REGEX } },
    ],
  };
  return { $match: { $expr: schools === "only" ? isSchool : { $not: isSchool } } };
}

/**
 * Resolve the route ids whose events the worst-stop ranking should include,
 * mirroring the home page's mode + school filters. Returns null when no filter
 * applies (every mode, school included), so the caller can skip the `$in` match.
 * Filtered in memory from the route table held in process, since the per-day board
 * reads call this inside their own cached callbacks.
 * @param mode - Restrict to this mode, or null for every mode.
 * @param schools - Which `S###` school services count.
 * @returns Included route ids, or null when no route filter is needed.
 */
export async function worstStopRouteIds(
  mode: Mode | null,
  schools: SchoolFilter,
): Promise<string[] | null> {
  if (!mode && schools === "include") return null;
  return (await routeTable())
    .filter((r) => (!mode || r.mode === mode) && rowAllowedBySchool(r, schools))
    .map((r) => r.id);
}
