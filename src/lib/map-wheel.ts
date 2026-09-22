// src/lib/map-wheel.ts
// Wheel zoom for a map the mouse is resting on, without the scroll trap that
// Leaflet's always-on wheel zoom sets on a long page.
import type * as Leaflet from "leaflet";

/** How long after the last page-scroll wheel the map may take the wheel. */
const SCROLL_SETTLE_MS = 400;

/**
 * Turn wheel zoom on while the reader's mouse is over the map, and off again
 * when it leaves. It switches on only on a real mouse move with no wheel in the
 * last {@link SCROLL_SETTLE_MS}: a page being wheel-scrolled carries the map
 * under a still pointer (and browsers raise a synthetic move as it passes), so
 * without the settle a scroll past the map would stop and zoom it instead. The
 * map must be created with `scrollWheelZoom: false`; the listeners go when it
 * is removed, since its container div outlives it.
 * @param map - The Leaflet map.
 */
export function wheelZoomOnHover(map: Leaflet.Map): void {
  const el = map.getContainer();
  let lastWheel = 0;
  /** Remember a wheel that is still scrolling the page. */
  const onWheel = (): void => {
    if (!map.scrollWheelZoom.enabled()) lastWheel = performance.now();
  };
  /**
   * Take the wheel once the mouse moves over a settled map.
   * @param e - The pointer event; touch and pen are ignored.
   */
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse" || map.scrollWheelZoom.enabled()) return;
    if (performance.now() - lastWheel > SCROLL_SETTLE_MS) map.scrollWheelZoom.enable();
  };
  /** Hand the wheel back to the page. */
  const onLeave = (): void => {
    map.scrollWheelZoom.disable();
  };
  el.addEventListener("wheel", onWheel, { passive: true });
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  map.once("unload", () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
  });
}
