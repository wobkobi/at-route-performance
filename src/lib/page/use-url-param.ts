"use client";
// src/lib/page/use-url-param.ts
// Keep query params in step with a control's client state, so Back and
// Forward restore what a reader chose without that choice costing a round trip.
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Write client state into the query string: every `owned` param is cleared,
 * then `values` are set, so a param left out of `values` is removed. The rest
 * of the query stays as the page left it. `replaceState` changes the current
 * history entry without a navigation or a refetch, and that entry is the one
 * Back returns to. The URL's own params are read at write time; the effect also
 * re-runs after a navigation the component survives (a filter link on the same
 * page), whose href was built on the server and cannot know the state.
 * @param owned - The params this state controls.
 * @param values - The ones to set now, by name.
 */
export function useUrlParams(owned: readonly string[], values: Record<string, string>): void {
  const searchParams = useSearchParams();
  // Serialised so a fresh object with the same contents does not re-run the effect.
  const ownedKey = owned.join("&");
  const wanted = JSON.stringify(values);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ownedKey.split("&")) params.delete(key);
    for (const [k, v] of Object.entries(JSON.parse(wanted) as Record<string, string>)) {
      params.set(k, v);
    }
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [ownedKey, wanted, searchParams]);
}

/**
 * Write one piece of client state into the query string as `key`, or remove
 * the param when the value is null. See {@link useUrlParams}.
 * @param key - The query param to keep.
 * @param value - Its value, or null to leave it out.
 */
export function useUrlParam(key: string, value: string | null): void {
  useUrlParams([key], value === null ? {} : { [key]: value });
}
