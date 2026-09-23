// src/app/rankings/page.tsx
// The week and month rankings live on the home page's Week and Month views; old
// links land there with their filters.

import { parseRangeWindow } from "@/lib/range-page";
import { buildHref } from "@/lib/utils";
import { permanentRedirect } from "next/navigation";

/**
 * Redirect `/rankings` to the home page on the same window, week when the query
 * names none. Every window is honoured, `day` included: this is a permanent
 * redirect, so a browser holds the destination it was given, and folding `day`
 * into the week view left an old bookmark pinned to a window its reader never
 * asked for.
 * @param root0 - Page props.
 * @param root0.searchParams - The rankings query (window, period, mode, school, dir).
 * @returns Never; always redirects.
 */
export default async function RankingsRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}): Promise<never> {
  const sp = (await searchParams) ?? {};
  const window = sp.window ? parseRangeWindow(sp.window) : "week";
  permanentRedirect(
    buildHref("/", {
      // The home day view is the bare path, so the param is left off for it.
      window: window === "day" ? undefined : window,
      period: sp.period,
      mode: sp.mode,
      school: sp.school,
      dir: sp.dir,
    }),
  );
}
