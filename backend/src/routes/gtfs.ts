import {Router, Request, Response, NextFunction} from "express";
import * as atApi from "../services/aucklandTransportApi";

const router = Router();

// GET /api/gtfs/versions
router.get("/versions", async (_req, res, next) => {
  try {
    res.json(await atApi.getGtfsVersions());
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/stops?date=YYYY-MM-DD
router.get("/stops", async (req, res, next) => {
  try {
    const date = req.query.date as string | undefined;
    res.json(await atApi.getStops(date));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/stops/:id
router.get("/stops/:id", async (req, res, next) => {
  try {
    res.json(await atApi.getStopById(req.params.id));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/stops/:id/stopTrips?date=YYYY-MM-DD&start_hour=H[&hour_range=R]
router.get("/stops/:id/stopTrips", async (req, res, next) => {
  try {
    const {date, start_hour, hour_range} = req.query as any;
    res.json(await atApi.getStopTrips(req.params.id, date, Number(start_hour), hour_range ? Number(hour_range) : undefined));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/routes
router.get("/routes", async (_req, res, next) => {
  try {
    res.json(await atApi.getRoutes());
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/routes/:id
router.get("/routes/:id", async (req, res, next) => {
  try {
    res.json(await atApi.getRouteById(req.params.id));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/trips?route={route_id}
router.get("/trips", async (req, res, next) => {
  try {
    const route = req.query.route as string;
    res.json(await atApi.getTripsByRouteId(route));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/trips/:id
router.get("/trips/:id", async (req, res, next) => {
  try {
    res.json(await atApi.getTripById(req.params.id));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/trips/:id/stopTimes
router.get("/trips/:id/stopTimes", async (req, res, next) => {
  try {
    res.json(await atApi.getStopTimesByTripId(req.params.id));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/calendar?service={service_id}
router.get("/calendar", async (req, res, next) => {
  try {
    const service = req.query.service as string;
    res.json(await atApi.getCalendarByServiceId(service));
  } catch (e) {
    next(e);
  }
});

// GET /api/gtfs/calendarDates?service={service_id}
router.get("/calendarDates", async (req, res, next) => {
  try {
    const service = req.query.service as string;
    res.json(await atApi.getCalendarDatesByServiceId(service));
  } catch (e) {
    next(e);
  }
});

export default router;
