// src/lib/day-url.ts
/**
 * @description Redirect away a redundant `?day` param when it names the current
 * service day, so today always shows a clean URL while every other param is
 * preserved. The redirect throws (Next navigation), so it must run before any
 * rendering; it is a no-op for past days or when `?day` is absent.
 */
import { nzServiceDayString } from "@/lib/time";
import { redirect } from "next/navigation";

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
