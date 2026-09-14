// src/app/rankings/page.tsx
// The week and month rankings live on the home page's Week and Month views; old
// links land there with their filters.

import { buildHref } from "@/lib/utils";
import { permanentRedirect } from "next/navigation";

/**
 * Redirect `/rankings` to the home page on the same window, week by default.
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
  permanentRedirect(
    buildHref("/", {
      window: sp.window === "month" ? "month" : "week",
      period: sp.period,
      mode: sp.mode,
      school: sp.school,
      dir: sp.dir,
    }),
  );
}
