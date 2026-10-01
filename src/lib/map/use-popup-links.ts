"use client";
// src/lib/map/use-popup-links.ts
// Route a map's popup links through the client router.
import { useRouter } from "next/navigation";
import { useEffect, type RefObject } from "react";

/**
 * Popup links are HTML that Leaflet writes outside React, so a plain click would
 * load the page afresh. A plain click on a same-site link goes through the router
 * instead; one with a modifier (new tab, new window) is left to the browser.
 * Listening in the capture phase keeps it working even if Leaflet stops a click
 * inside a popup from bubbling.
 * @param divRef - The map's container element.
 */
export function usePopupLinkRouting(divRef: RefObject<HTMLDivElement | null>): void {
  const router = useRouter();
  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    /**
     * Send a plain click on a same-site popup link through the router.
     * @param e - The click.
     */
    const onClick = (e: MouseEvent): void => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a") : null;
      if (!a || a.target || a.origin !== window.location.origin) return;
      e.preventDefault();
      router.push(`${a.pathname}${a.search}${a.hash}`);
    };
    div.addEventListener("click", onClick, true);
    return () => div.removeEventListener("click", onClick, true);
  }, [divRef, router]);
}
