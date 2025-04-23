// components/MapClient.tsx
"use client";

import dynamic from "next/dynamic";
import type { MapViewProps } from "./MapView";

// tell next/dynamic exactly what the imported component's props are:
const MapView = dynamic<MapViewProps>(
  () => import("./MapView"),
  { ssr: false }
);

export default function MapClient(props: MapViewProps) {
  return <MapView {...props} />;
}
