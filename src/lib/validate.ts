// src/lib/validate.ts
// Zod schemas for validating and normalising API query parameters. An empty
// value (`?limit=`) reads as unset, so a link that clears a control falls back
// to the default instead of a 400.

import { MODES } from "@/lib/mode";
import { isRealDate, nzServiceDayRange, shiftDays, YMD_RE } from "@/lib/time/service-day";
import { z } from "zod";

/**
 * Treat empty query strings as unset so schema defaults apply.
 * @param v - Raw value.
 * @returns `undefined` for an empty string, otherwise the value unchanged.
 */
const emptyToUndefined = (v: unknown): unknown => (v === "" ? undefined : v);

/**
 * An on/off query flag: "1" is on, "0" or absent is off. Anything else, a bare
 * `?flag` included, fails validation rather than being guessed at.
 */
export const queryFlag = z
  .enum(["0", "1"])
  .optional()
  .transform((v) => v === "1");

/** The cleanup endpoint's flags. */
export const cleanupFlagsQuery = z.object({ force: queryFlag, dryRun: queryFlag });

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
  mode: z.preprocess(emptyToUndefined, z.enum(MODES).optional()),
});
export type TopRoutesQuery = z.infer<typeof topRoutesQuery>;

/** A service date (`YYYY-MM-DD`) that exists on the calendar. */
const serviceDateParam = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(YMD_RE, "expected a service date like 2026-09-21")
    .refine(isRealDate, "not a real calendar date")
    .optional(),
);

/** The longest window the route stats endpoint answers for, in service days. */
export const MAX_STATS_DAYS = 92;

/**
 * Query parameters for a single route's stats. `from` and `to` are NZ service
 * days, both included, so a window runs from `from`'s 4am to the 4am after
 * `to`; they come as a pair, `to` not before `from`, at most
 * {@link MAX_STATS_DAYS} apart. Without them the window is the last 7 days.
 * Parses to the resolved `range` (null for the default) and the stop order.
 */
export const routeStatsQuery = z
  .object({
    from: serviceDateParam,
    to: serviceDateParam,
    sort: z.preprocess(
      emptyToUndefined,
      z.enum(["events", "avg_delay", "on_time_rate"]).default("events"),
    ),
  })
  .superRefine(({ from, to }, ctx) => {
    if ((from === undefined) !== (to === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [from === undefined ? "from" : "to"],
        message: "from and to must be given together",
      });
    } else if (from && to && to < from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "to is before from" });
    } else if (from && to && to > shiftDays(from, MAX_STATS_DAYS - 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `the window is longer than ${MAX_STATS_DAYS} days`,
      });
    }
  })
  .transform(({ from, to, sort }) => ({
    range:
      from && to ? { start: nzServiceDayRange(from).start, end: nzServiceDayRange(to).end } : null,
    sort,
  }));

/** Query parameters for the stop directory: one page of it. */
export const stopsQuery = z.object({
  limit: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1000).default(200)),
  offset: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(0)),
});

/** Query parameters for the aggregate cron: one service date, or none for the catch-up. */
export const aggregateQuery = z.object({ date: serviceDateParam });

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
