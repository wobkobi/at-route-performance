import axios from "axios";

const API_KEY = process.env.AT_API_KEY!;
const BASE_URL = "https://api.at.govt.nz/gtfs/v3";

const client = axios.create({
  baseURL: BASE_URL,
  headers: {"Ocp-Apim-Subscription-Key": API_KEY},
});

export async function getGtfsVersions() {
  const {data} = await client.get("/versions");
  return data;
}

export async function getStops(date?: string) {
  const params: any = {};
  if (date) params["filter[date]"] = date;
  const {data} = await client.get("/stops", {params});
  return data;
}

export async function getStopById(stopId: string) {
  const {data} = await client.get(`/stops/${stopId}`);
  return data;
}

export async function getStopTrips(stopId: string, date: string, startHour: number, hourRange?: number) {
  const params: any = {
    "filter[date]": date,
    "filter[start_hour]": startHour,
  };
  if (hourRange != null) params["filter[hour_range]"] = hourRange;
  const {data} = await client.get(`/stops/${stopId}/stoptrips`, {params});
  return data;
}

export async function getRoutes() {
  const {data} = await client.get("/routes");
  return data;
}

export async function getRouteById(routeId: string) {
  const {data} = await client.get(`/routes/${routeId}`);
  return data;
}

export async function getTripsByRouteId(routeId: string) {
  const {data} = await client.get("/trips", {
    params: {"filter[route]": routeId},
  });
  return data;
}

export async function getTripById(tripId: string) {
  const {data} = await client.get(`/trips/${tripId}`);
  return data;
}

export async function getStopTimesByTripId(tripId: string) {
  const {data} = await client.get(`/trips/${tripId}/stoptimes`);
  return data;
}

export async function getCalendarByServiceId(serviceId: string) {
  const {data} = await client.get("/calendar", {
    params: {"filter[service]": serviceId},
  });
  return data;
}

export async function getCalendarDatesByServiceId(serviceId: string) {
  const {data} = await client.get("/calendarDates", {
    params: {"filter[service]": serviceId},
  });
  return data;
}
