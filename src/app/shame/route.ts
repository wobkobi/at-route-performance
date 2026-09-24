// src/app/shame/route.ts
// /shame names the section, not a page of its own: the three boards under it are
// the whole of it, so a reader arriving here is sent to the trips board with the
// params those boards read.

import { SHAME_PARAMS } from "@/lib/shame-page";
import { buildHref } from "@/lib/utils";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Send `/shame` to the trips board, keeping the window, day, period and filter.
 * Only those: copying the whole query dragged the previous page's sort, search
 * and direction onto a board that does not read them, and from there through
 * every later window switch, since the window controls carry what they find.
 *
 * A route handler rather than a page, so the answer is a real 307. A page flushes
 * its prerendered shell before its component runs, so a redirect thrown there
 * travels in the payload as a client navigation instead: a 200 that a crawler can
 * index and a reader without JavaScript never follows.
 * @param request - The incoming request, read for its query.
 * @returns A redirect to the trips board carrying the boards' own params.
 */
export function GET(request: NextRequest): NextResponse {
  const sp = request.nextUrl.searchParams;
  const carried: Record<string, string> = {};
  for (const key of SHAME_PARAMS) {
    // A param repeated in the query yields its first value here; the boards read one.
    const value = sp.get(key);
    if (value !== null && value !== "") carried[key] = value;
  }
  // A relative Location, as the page's own redirect emitted, so the destination
  // never depends on reading the deployment's host and scheme back off the request.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: buildHref("/shame/trip", carried) },
  });
}
