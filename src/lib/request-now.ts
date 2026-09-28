// src/lib/request-now.ts
// The one place a rendering page is allowed to read the wall clock.
//
// Under Cache Components every render starts as a prerender of the page's static
// shell, and a prerender cannot know the time: `new Date()` there raises
// `blocking-prerender-current-time` and the shell is abandoned, which sends the
// boundary to the client instead of streaming it. Awaiting `connection()` first
// says the value belongs to this request, so the clock read is legal and
// everything after it renders at request time behind the shell that already
// flushed.
//
// So a day page resolves the clock once, through here, before it reaches any
// helper that would otherwise read it - which is what every `today`/`now`
// parameter on those helpers is for. One read per render also keeps a single
// render from straddling the 4am service-day boundary and describing two days.
import { nzServiceDayString } from "@/lib/time";

/**
 * The current instant, read at request time.
 * @returns Now, once the render is past its static shell.
 */
export async function requestNow(): Promise<Date> {
  // Imported here rather than at the top so this module stays loadable from the
  // pure helpers and their unit tests, which never reach this call.
  const { connection } = await import("next/server");
  await connection();
  return new Date();
}

/**
 * Today's service date (`YYYY-MM-DD` on the 4am boundary), read at request time.
 * @returns The current service day.
 */
export async function requestServiceDay(): Promise<string> {
  return nzServiceDayString(await requestNow());
}
