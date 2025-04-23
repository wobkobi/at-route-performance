// components/MapView.tsx
"use client";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// … your icon setup …

export interface Stop {
  stop_id:   string;
  stop_name: string;
  stop_lat:  number;
  stop_lon:  number;
}

export interface MapViewProps {
  stops: Stop[];
}

export default function MapView({ stops }: MapViewProps) {
  // use a LatLngLiteral so TS knows it's {lat:number, lng:number}
  const center: L.LatLngLiteral = stops.length
    ? { lat: stops[0].stop_lat, lng: stops[0].stop_lon }
    : { lat: -36.8485,      lng: 174.7633 };

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ flex: 1, height: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {stops.map((s) => (
        <Marker
          key={s.stop_id}
          position={{ lat: s.stop_lat, lng: s.stop_lon }}
        >
          <Popup>
            <strong>{s.stop_name}</strong><br />
            ID: {s.stop_id}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
