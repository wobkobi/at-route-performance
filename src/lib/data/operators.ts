// src/lib/data/operators.ts
// The stored operator list, as the nightly shapes sync last wrote it.

import { AGENCIES_SETTING, parseStoredAgencies } from "@/lib/feed/gtfs-agencies";
import { getSetting } from "@/lib/feed/gtfs-settings";
import { unstable_cache } from "@/lib/mem-cache";
import type { Operator } from "@/lib/operators";

/**
 * Every operator AT has listed since the list was first stored, current or
 * not. Cached for an hour, as the route-to-operator map is. Empty until the
 * first sync, when every operator reads as its bare code.
 * @returns The operators, by name.
 */
export async function getOperators(): Promise<Operator[]> {
  return unstable_cache(
    async () => parseStoredAgencies(await getSetting(AGENCIES_SETTING)),
    ["operators"],
    { revalidate: 3600 },
  )();
}
