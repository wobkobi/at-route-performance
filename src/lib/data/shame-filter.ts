// src/lib/data/shame-filter.ts
// The mode and school-service filter every shame, stop and cancellation read shares.
import { prisma } from "@/lib/db";
import { unstable_cache } from "@/lib/mem-cache";
import type { DelayDirection } from "@/lib/rankings";
import { isSchoolBus } from "@/lib/school-bus";

/** School-service code regex (mirrors `isSchoolBus`) for the Shame filter. */
export const SCHOOL_BUS_REGEX = "^S[0-9]{3}[A-Z]*$";

/** Which runs the Shame board considers - mirrors the home page's filters. */
export interface ShameFilter {
  /** Restrict to this mode; null/undefined means every mode. */
  mode?: "BUS" | "TRAIN" | "FERRY" | null;
  /** Include school services (default false, matching the home page default). */
  includeSchool?: boolean;
  /**
   * Keep only stops running late or early on average; null/undefined keeps both.
   * Only the worst-stop reads honour it: the trip and route boards take the same
   * filter object and ignore this field.
   */
  direction?: DelayDirection;
}

/**
 * Resolve the route ids whose events the worst-stop ranking should include,
 * mirroring the home page's mode + school filters. Returns null when no filter
 * applies (every mode, school included), so the caller can skip the `$in` match.
 * @param mode - Restrict to this mode, or null for every mode.
 * @param includeSchool - Whether to include `S###` school services.
 * @returns Included route ids, or null when no route filter is needed.
 */
export async function worstStopRouteIds(
  mode: "BUS" | "TRAIN" | "FERRY" | null,
  includeSchool: boolean,
): Promise<string[] | null> {
  if (!mode && includeSchool) return null;
  return unstable_cache(
    async () => {
      // Push mode filter to DB; school-bus detection needs name fields so stays in JS.
      const routes = await prisma.route.findMany({
        where: mode ? { mode } : undefined,
        select: { id: true, shortName: true, longName: true },
      });
      return routes
        .filter((r) => includeSchool || !isSchoolBus(r.shortName, r.longName))
        .map((r) => r.id);
    },
    ["worst-stop-route-ids", mode ?? "all", String(includeSchool)],
    { revalidate: 3600 },
  )();
}
