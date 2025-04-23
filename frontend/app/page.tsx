import MapClient from "../components/MapClient";
import type {LatLngExpression} from "leaflet";

export default function HomePage() {
  // example dummy data; replace with your real fetched routes
  const exampleRoutes: LatLngExpression[][] = [
    [
      [-36.8485, 174.7633],
      [-36.85, 174.765],
      [-36.852, 174.769],
    ],
  ];

  return (
    <main style={{height: "100vh"}}>
      {/* This is a Server Component importing a Client Component */}
      <MapClient routes={exampleRoutes} />
    </main>
  );
}
