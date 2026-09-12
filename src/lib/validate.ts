// src/lib/validate.ts
// Zod schemas for validating and normalising API query parameters. An empty
// value (`?limit=`) reads as unset, so a link that clears a control falls back
// to the default instead of a 400.

import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { z } from "zod";

/**
 * Treat empty query strings as unset so schema defaults apply.
 * @param v - Raw value.
 * @returns `undefined` for an empty string, otherwise the value unchanged.
 */
const emptyToUndefined = (v: unknown): unknown => (v === "" ? undefined : v);

/** Query parameters for the top-routes listing. */
export const topRoutesQuery = z.object({
  week: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "expected an ISO week like 2025-W32")
      .optional(),
  ),
  limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(500).default(50)),
  metric: z.preprocess(
    emptyToUndefined,
    z.enum(["on_time_rate", "avg_delay"]).default("on_time_rate"),
  ),
  thresholdSec: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(3600).default(ON_TIME_LATE_SEC),
  ),
  mode: z.preprocess(emptyToUndefined, z.enum(["BUS", "TRAIN", "FERRY"]).optional()),
});
export type TopRoutesQuery = z.infer<typeof topRoutesQuery>;

/** Query parameters for a single route's stats. */
export const routeStatsQuery = z.object({
  from: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  to: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  thresholdSec: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(3600).default(ON_TIME_LATE_SEC),
  ),
  sort: z.preprocess(
    emptyToUndefined,
    z.enum(["events", "avg_delay", "on_time_rate"]).default("events"),
  ),
});

/** One validation failure as the API reports it: the offending field and why. */
export interface QueryIssue {
  path: string;
  message: string;
}

/**
 * The 400 body for a failed query parse: field and message only. Zod's own
 * issue objects carry the received input and internal codes, which belong in
 * neither a public response nor a log.
 * @param issues - The parse's issues.
 * @returns The issues with just their path and message.
 */
export function queryIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): QueryIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
export type RouteStatsQuery = z.infer<typeof routeStatsQuery>;
