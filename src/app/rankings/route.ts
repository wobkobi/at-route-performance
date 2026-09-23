// src/app/rankings/route.ts
// The week and month rankings live on the home page's Week and Month views; old
// links land there with their filters.

import { parseRangeWindow } from "@/lib/range-page";
import { buildHref } from "@/lib/utils";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirect `/rankings` to the home page on the same window, week when the query
 * names none. Every window is honoured, `day` included: this is a permanent
 * redirect, so a browser holds the destination it was given, and folding `day`
 * into the week view left an old bookmark pinned to a window its reader never
 * asked for.
 *
 * A route handler rather than a page, so the answer is a real 308. A page flushes
 * its prerendered shell before its component runs, so a redirect thrown there
 * travels in the payload as a client navigation instead: a 200 that a crawler can
 * index and a reader without JavaScript never follows.
 * @param request - The incoming request, read for its query.
 * @returns A permanent redirect to the home page on the matching window.
 */
export function GET(request: NextRequest): NextResponse {
  const sp = request.nextUrl.searchParams;
  const raw = sp.get("window");
  const window = raw ? parseRangeWindow(raw) : "week";
  const target = buildHref("/", {
    // The home day view is the bare path, so the param is left off for it.
    window: window === "day" ? undefined : window,
    period: sp.get("period"),
    mode: sp.get("mode"),
    school: sp.get("school"),
    dir: sp.get("dir"),
  });
  // A relative Location, as the page's own redirect emitted, so the destination
  // never depends on reading the deployment's host and scheme back off the request.
  return new NextResponse(null, { status: 308, headers: { Location: target } });
}
