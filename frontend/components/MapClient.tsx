"use client";

import dynamic from "next/dynamic";
import type {LatLngExpression} from "leaflet";

// Dynamically import your MapView—and disable SSR—inside a client component
const MapViewNoSSR = dynamic<{routes: LatLngExpression[][]}>(() => import("./MapView"), {ssr: false});

export default function MapClient(props: {routes: LatLngExpression[][]}) {
  return <MapViewNoSSR {...props} />;
}
