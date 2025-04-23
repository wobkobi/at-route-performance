// app/page.tsx
import dynamic from "next/dynamic";

const MapClient = dynamic(() => import("../components/MapView"), {
  ssr: false,   // only render on the client
});

export default async function HomePage() {
  // fetch your stops from the backend
  const res = await fetch("http://localhost:4000/api/gtfs/stops?date=2025-04-23");
  const { data } = await res.json();

  // extract the attributes straight into our Stop shape
  const stops = data.map((r: any) => ({
    stop_id:   r.attributes.stop_id,
    stop_name: r.attributes.stop_name,
    stop_lat:  r.attributes.stop_lat,
    stop_lon:  r.attributes.stop_lon,
  }));

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <MapClient stops={stops} />
    </div>
  );
}
