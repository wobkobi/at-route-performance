// src/app/shame/page.tsx
// /shame names the section, not a page of its own: the three boards under it are
// the whole of it, so a reader arriving here is sent to the trips board with the
// params those boards read.

import { SHAME_PARAMS } from "@/lib/shame-page";
import { buildHref } from "@/lib/utils";
import { redirect } from "next/navigation";

/**
 * Send `/shame` to the trips board, keeping the window, day, period and filter.
 * Only those: copying the whole query dragged the previous page's sort, search
 * and direction onto a board that does not read them, and from there through
 * every later window switch, since the window controls carry what they find.
 * @param root0 - Page props.
 * @param root0.searchParams - The query to pick the boards' params out of.
 */
export default async function ShameSection({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const sp = (await searchParams) ?? {};
  const carried: Record<string, string> = {};
  for (const key of SHAME_PARAMS) {
    // A param repeated in the query arrives as an array; the boards read one value.
    const raw = sp[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== "") carried[key] = value;
  }
  redirect(buildHref("/shame/trip", carried));
}
