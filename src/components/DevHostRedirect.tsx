"use client";
// src/components/DevHostRedirect.tsx
// Moves a development page from localhost onto at.localhost, the dev host the
// CARTO key allows (CARTO refuses localhost and IPs), so dev maps load without
// the "API KEY REQUIRED" watermark. Browsers resolve *.localhost to loopback on
// their own; Node does not, which is why the dev server cannot bind to it.

import { useEffect } from "react";

/** The dev hostname allowed on the CARTO key's Referer list. */
const DEV_HOST = "at.localhost";

/**
 * Swap the hostname on a localhost page, keeping port, path, query and hash.
 * 127.0.0.1 is left alone, since the smoke test serves from it.
 * @returns Nothing visible.
 */
export function DevHostRedirect(): null {
  useEffect(() => {
    if (window.location.hostname !== "localhost") return;
    const url = new URL(window.location.href);
    url.hostname = DEV_HOST;
    window.location.replace(url);
  }, []);
  return null;
}
