// src/app/shame/page.tsx
// /shame names the section, not a page of its own: the three boards under it are
// the whole of it, so a reader arriving here is sent to the trips board with
// every param they came with.

import { buildHref } from "@/lib/utils";
import { redirect } from "next/navigation";

/**
 * Send `/shame` to the trips board, keeping the query. Every param the boards
 * read (the window, day, period and filter) means the same thing there, so the
 * redirect carries the lot rather than naming them.
 * @param root0 - Page props.
 * @param root0.searchParams - The query to carry across.
 */
export default async function ShameSection({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const sp = (await searchParams) ?? {};
  const carried: Record<string, string> = {};
  for (const [key, raw] of Object.entries(sp)) {
    // A param repeated in the query arrives as an array; the boards read one value.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== "") carried[key] = value;
  }
  redirect(buildHref("/shame/trip", carried));
}
