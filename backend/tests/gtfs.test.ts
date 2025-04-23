// tests/gtfs.test.ts

import request from "supertest";
import {app} from "../src/app";

// 1) Mock the service module
jest.mock("../src/services/aucklandTransportApi");
import * as atApi from "../src/services/aucklandTransportApi";
const mockedApi = atApi as jest.Mocked<typeof atApi>;

describe("GET /api/gtfs", () => {
  const base = "/api/gtfs";

  beforeAll(() => {
    // Mock getGtfsVersions to return a JSON:API doc with a `data` array
    mockedApi.getGtfsVersions.mockResolvedValue({
      data: [
        {
          type: "versions",
          id: "2025-04-01",
          attributes: {
            /* … */
          },
        },
      ],
    } as any);

    // Mock getStops to return a JSON:API doc with a `data` array
    mockedApi.getStops.mockResolvedValue({
      data: [
        {
          type: "stops",
          id: "100-56c57897",
          attributes: {stop_id: "100-56c57897", stop_name: "Papatoetoe"},
        },
      ],
    } as any);

    // Mock getStopById to reject with a simulated 404 error
    mockedApi.getStopById.mockRejectedValue({
      response: {
        status: 404,
        data: {errors: [{status: "404", code: "not-found", title: "Not Found"}]},
      },
    });
  });

  it("should list GTFS versions", async () => {
    const res = await request(app).get(`${base}/versions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe("2025-04-01");
  });

  it("should list stops for a given date", async () => {
    const res = await request(app).get(`${base}/stops`).query({date: "2025-04-23"});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].attributes.stop_name).toBe("Papatoetoe");
  });

  it("should 404 on invalid stop ID", async () => {
    const res = await request(app).get(`${base}/stops/not-a-stop`);
    expect(res.status).toBe(404);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].code).toBe("not-found");
  });
});
