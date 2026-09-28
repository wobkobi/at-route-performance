# scripts/build-fare-zones.py
# Rebuild src/lib/fare-zones.json from AT's fare zone shapefile (at_fareZones.shp,
# NZTM / EPSG:2193). AT cuts each overlap out as its own polygon named after both
# zones ("City, Isthmus"), so each zone here is the union of every polygon that
# names it, which puts an overlap in both. Simplified to 15 m in NZTM metres
# before reprojecting to WGS84, and rounded to 5 decimals (about a metre).
#
# Usage: pip install pyshp shapely pyproj
#        python scripts/build-fare-zones.py path/to/at_fareZones.shp
import json
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import transform, unary_union

# AT's zone names to the keys lib/fare-zones.ts uses, in display order.
ORDER = [
    ("City", "city"),
    ("Isthmus", "isthmus"),
    ("Lower North Shore", "lower-north-shore"),
    ("East Coast / South Rodney", "east-coast-south-rodney"),
    ("Waitākere", "waitakere"),
    ("Northern Manukau", "northern-manukau"),
    ("Southern Manukau", "southern-manukau"),
    ("Waiheke", "waiheke"),
    ("Warkworth", "warkworth"),
    ("Aotea", "aotea"),
]
TOLERANCE_M = 15

reader = shapefile.Reader(sys.argv[1], encoding="utf-8")
pieces: dict[str, list] = {}
for rec in reader.iterShapeRecords():
    geom = shape(rec.shape.__geo_interface__).buffer(0)
    for name in rec.record["Name"].split(","):
        pieces.setdefault(name.strip(), []).append(geom)

unknown = set(pieces) - {name for name, _ in ORDER}
if unknown:
    sys.exit(f"Zones missing from ORDER: {sorted(unknown)}")

to_wgs84 = Transformer.from_crs(2193, 4326, always_xy=True)


def ring(coords):
    return [[round(lon, 5), round(lat, 5)] for lon, lat in coords]


out = []
for name, key in ORDER:
    merged = unary_union(pieces[name]).simplify(TOLERANCE_M, preserve_topology=True)
    wgs = transform(to_wgs84.transform, merged)
    if isinstance(wgs, MultiPolygon):
        polys = list(wgs.geoms)
    elif isinstance(wgs, Polygon):
        polys = [wgs]
    else:
        sys.exit(f"{name} simplified to a {wgs.geom_type}, not a polygon")
    out.append(
        {
            "key": key,
            "polygons": [
                [ring(p.exterior.coords), *(ring(h.coords) for h in p.interiors)]
                for p in polys
                if p.area > 0
            ],
        }
    )

with open("src/lib/fare-zones.json", "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"Wrote {len(out)} zones")
