"use client";

import {useState} from "react";
import api from "../services/api";

interface Props {
  onCompute: (legs: [number, number][][]) => void;
}

export default function RoutePlanner({onCompute}: Props) {
  const [stops, setStops] = useState(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compute = async () => {
    setLoading(true);
    setError(null);

    try {
      const today = new Date().toISOString().split("T")[0];
      const nowHour = new Date().getHours();

      const legPaths: [number, number][][] = [];

      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i].trim();
        const b = stops[i + 1].trim();
        // 1) get trips at A and B
        const [ta, tb] = await Promise.all([api.get(`/stops/${a}/stopTrips`, {params: {date: today, start_hour: nowHour}}), api.get(`/stops/${b}/stopTrips`, {params: {date: today, start_hour: nowHour}})]);
        const tripsA = ta.data.data.map((x: any) => x.attributes.trip_id);
        const tripsB = tb.data.data.map((x: any) => x.attributes.trip_id);
        const common = tripsA.find((id: any) => tripsB.includes(id));
        if (!common) throw new Error(`No direct trip between ${a}→${b}`);

        // 2) get stoptimes for that trip
        const st = await api.get(`/trips/${common}/stopTimes`);
        const stopTimes: any[] = st.data.data.map((d: any) => d.attributes);

        // 3) slice between A and B
        const idxA = stopTimes.findIndex((s) => s.stop_id === a);
        const idxB = stopTimes.findIndex((s) => s.stop_id === b);
        const segment = stopTimes.slice(Math.min(idxA, idxB), Math.max(idxA, idxB) + 1);

        // 4) fetch lat/lon for each stop in segment
        const coords = await Promise.all(
          segment.map(async (s) => {
            const resp = await api.get(`/stops/${s.stop_id}`);
            const attr = resp.data.data.attributes;
            return [attr.stop_lat, attr.stop_lon] as [number, number];
          })
        );

        legPaths.push(coords);
      }

      onCompute(legPaths);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Error computing route");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="route-planner">
      {stops.map((v, i) => (
        <input
          key={i}
          placeholder={`Stop ${i + 1} ID`}
          value={v}
          onChange={(e) => {
            const a = [...stops];
            a[i] = e.target.value;
            setStops(a);
          }}
        />
      ))}
      <button onClick={compute} disabled={loading}>
        {loading ? "Calculating…" : "Compute Routes"}
      </button>
      {error && <div style={{color: "red"}}>{error}</div>}
    </div>
  );
}
