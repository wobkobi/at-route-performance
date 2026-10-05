// tests/lib/map/vehicle-marker.test.ts
// Unit tests for the live-vehicle marker and popup both maps share.
import { vehicleMarkerHtml, vehiclePopupHtml, type VehiclePopup } from "@/lib/map/vehicle-marker";
import { describe, expect, it } from "vitest";

describe("vehicleMarkerHtml", () => {
  const base = { ring: "#95c11f", glyphColour: "#5b7a12", glyph: null, bearing: null };

  it("draws the chevron only when the feed gives a heading", () => {
    expect(vehicleMarkerHtml(base)).not.toContain("rotate(");
    expect(vehicleMarkerHtml({ ...base, bearing: 87.6 })).toContain("rotate(88 20 20)");
  });

  it("rings in the band colour and fills the glyph in the darker one", () => {
    const html = vehicleMarkerHtml({
      ...base,
      glyph: { viewBox: "0 0 640 512", body: "<path d='M0 0'/>" },
    });
    expect(html).toContain('stroke="#95c11f"');
    expect(html).toContain('viewBox="0 0 640 512" fill="#5b7a12"><path');
  });

  it("haloes only the focused vehicle, in its ring colour", () => {
    expect(vehicleMarkerHtml(base)).not.toContain("fill-opacity");
    expect(vehicleMarkerHtml({ ...base, focus: true })).toContain(
      '<circle cx="20" cy="20" r="19.5" fill="#95c11f" fill-opacity="0.3"/>',
    );
  });
});

describe("vehiclePopupHtml", () => {
  const v: VehiclePopup = {
    slug: "70",
    routeId: "70-202",
    vehicleId: "12345",
    label: null,
    cars: null,
    tripId: "trip-1",
    detail: "3m late",
    operator: null,
  };

  it("names the route, the vehicle and its delay, then links its trip and itself", () => {
    const html = vehiclePopupHtml(v);
    expect(html).toContain("<strong>Route 70</strong>");
    expect(html).toContain("Vehicle 12345");
    expect(html).toContain("3m late");
    expect(html).toContain(">Open this trip</a> &middot; <a");
    expect(html).toContain('href="/vehicle/12345">This vehicle</a>');
  });

  it("drops the trip link without a trip, and escapes feed text", () => {
    const html = vehiclePopupHtml({ ...v, tripId: null, label: "<b>AMP</b>", cars: 6 });
    expect(html).not.toContain("Open this trip");
    expect(html).toContain("&lt;b&gt;AMP&lt;/b&gt; &middot; 6 cars");
  });
});
