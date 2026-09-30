// src/lib/data/operators.ts
// The stored operator list, as the nightly shapes sync last wrote it.

import { getRouteOperators } from "@/lib/data/routes";
import { readFallback } from "@/lib/db";
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

/** Route id to operator code, and the operator list the codes resolve against. */
export type OperatorDirectory = [routeOperators: Record<string, string>, operators: Operator[]];

/**
 * The route-to-operator map and the operator list, read together as every
 * operator view needs them. Either read failing leaves it empty, so a page
 * names operators by their bare codes (or not at all) rather than failing.
 * @returns The map and the list.
 */
export async function getOperatorDirectory(): Promise<OperatorDirectory> {
  return Promise.all([
    getRouteOperators().catch(readFallback<Record<string, string>>("route-operators", {})),
    getOperators().catch(readFallback<Operator[]>("operators", [])),
  ]);
}
