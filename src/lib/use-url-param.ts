"use client";
// src/lib/use-url-param.ts
// Keep one query param in step with a control's client state, so Back and
// Forward restore what a reader chose without that choice costing a round trip.
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Write a piece of client state into the query string as `key`, or remove the
 * param when the value is null. `replaceState` changes the current history
 * entry without a navigation or a refetch, and that entry is the one Back
 * returns to. The URL's own params are read at write time, so the rest of the
 * query stays as the page left it; the effect also re-runs after a navigation
 * the component survives (a filter link on the same page), whose href was built
 * on the server and cannot know the value.
 * @param key - The query param to keep.
 * @param value - Its value, or null to leave it out.
 */
export function useUrlParam(key: string, value: string | null): void {
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [key, value, searchParams]);
}
