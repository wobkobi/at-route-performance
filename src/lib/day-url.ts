// src/lib/day-url.ts
// The two `?day` redirects every day page runs before rendering: clamp a day
// outside the archive onto the nearest real one, then drop the param when it
// names the current service day, so today always shows a clean URL while every
// other param is preserved. Both throw (Next navigation), so they must run
// before any rendering, and the clamp must run first.

import { clampServiceDate } from "@/lib/data-start";
import { resolveRequestedDay } from "@/lib/page-nav";
import { nzServiceDayString } from "@/lib/time";
import { redirect } from "next/navigation";

/**
 * Redirect a `?day` outside `[DATA_START_DAY, today]` onto the nearest real
 * day, so a shared link to 8 September lands on 11 September with the URL saying
 * so. Call it immediately BEFORE {@link dropTodayParam}, never after: a forward
 * clamp onto today drops `?day` here in one hop, where redirecting to
 * `?day=<today>` would cost a second hop on a path a shared link hits cold.
 * Throws the redirect when it fires (Next navigation), so call it before
 * rendering. A no-op when `?day` is absent or is not a real calendar date.
 * @param basePath - The page path (e.g. "/", "/shame", "/route/501").
 * @param sp - The raw search params.
 * @param sp.day - The current `?day` value, if any.
 * @param today - Today's service date (injectable for tests).
 */
export function clampDayParam(
  basePath: string,
  sp: { day?: string },
  today: string = nzServiceDayString(),
): void {
  const day = resolveRequestedDay(sp.day);
  if (day === null) return;
  const clamped = clampServiceDate(day, today);
  if (clamped === day) return;
  const entries = Object.entries(sp as Record<string, string | undefined>);
  const params = new URLSearchParams(
    entries.filter(([k, v]) => k !== "day" && v != null) as [string, string][],
  );
  // Landing on today drops the param entirely, which is what dropTodayParam
  // would do on the next request anyway.
  if (clamped !== today) params.set("day", clamped);
  const qs = params.toString();
  redirect(qs ? `${basePath}?${qs}` : basePath);
}

/**
 * The `?day` value a link should carry for a service date: the date itself, or
 * `undefined` for the current service day, whose param {@link dropTodayParam}
 * redirects away. Every link to a day page goes through this, so a board row
 * naming today does not cost its reader a 307 before the page renders.
 * @param date - The service date the link is for, or null/undefined for today's view.
 * @param today - Today's service date (injectable for tests).
 * @returns The `day` param, or undefined when it would name today.
 */
export function dayLinkParam(
  date: string | null | undefined,
  today: string = nzServiceDayString(),
): string | undefined {
  return date && date !== today ? date : undefined;
}

/**
 * When `?day` names the current service day it is redundant: redirect to the
 * same page without it (keeping every other param) so today shows a clean URL.
 * A no-op for any other day or when `?day` is absent. Throws the redirect when
 * it fires (Next navigation), so call it before rendering.
 * @param basePath - The page path (e.g. "/", "/shame", "/route/501").
 * @param sp - The raw search params.
 * @param sp.day - The current `?day` value, if any.
 */
export function dropTodayParam(basePath: string, sp: { day?: string }): void {
  if (!sp.day || sp.day !== nzServiceDayString()) return;
  const entries = Object.entries(sp as Record<string, string | undefined>);
  const params = new URLSearchParams(
    entries.filter(([k, v]) => k !== "day" && v != null) as [string, string][],
  );
  const qs = params.toString();
  redirect(qs ? `${basePath}?${qs}` : basePath);
}
