// frontend/components/MapView.tsx
"use client";

import {useState, useRef, useLayoutEffect} from "react";
import {MapContainer, TileLayer, Polyline, Marker, Popup, useMap} from "react-leaflet";
import type {LatLngExpression, Map as LeafletMap} from "leaflet";

// helper to grab the map instance if you need it
function MapInitializer({onCreate}: {onCreate: (map: LeafletMap) => void}) {
  const map = useMap();
  onCreate(map);
  return null;
}

interface Props {
  routes: LatLngExpression[][];
}

export default function MapView({routes}: Props) {
  // default to the first point or a sensible fallback
  const center: LatLngExpression = routes[0]?.[0] ?? [-36.8485, 174.7633];

  // unique key on (real) mount so React actually unmounts/remounts
  const [mapKey] = useState(() => `leaflet-${Date.now()}`);

  // ref to the wrapper div that *will* contain the .leaflet-container
  const wrapperRef = useRef<HTMLDivElement>(null);
  // optional: grab the map instance
  const mapRef = useRef<LeafletMap | null>(null);

  useLayoutEffect(() => {
    // if there's an old leaflet container here, clear its _leaflet_id
    const old = wrapperRef.current?.querySelector(".leaflet-container");
    if (old && (old as any)._leaflet_id) {
      delete (old as any)._leaflet_id;
    }
  }, []);

  return (
    <div ref={wrapperRef} style={{flex: 1, height: "100%"}}>
      <MapContainer key={mapKey} center={center} zoom={12} style={{flex: 1, height: "100%"}}>
        <MapInitializer onCreate={(m) => (mapRef.current = m)} />

        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {routes.map((path, i) => (
          <Polyline key={i} positions={path} />
        ))}

        {routes.flat().map((pos, i) => (
          <Marker key={i} position={pos}>
            <Popup>{`Stop ${i + 1}`}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
