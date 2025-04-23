// backend/src/app.ts

import "dotenv/config";
import express, {Request, Response, NextFunction} from "express";
import axios from "axios";

import gtfsRouter from "./routes/gtfs";

export const app = express();

app.use(express.json());
app.use("/api/gtfs", gtfsRouter);

// Error handler: forwards upstream HTTP errors or falls back to 500
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // If this error came from Axios and has a status, forward it & its body:
  if (err.response && typeof err.response.status === "number") {
    return res.status(err.response.status).json(err.response.data);
  }
  // Otherwise log and return generic 500
  console.error(err);
  res.status(500).json({error: "Internal Server Error"});
});
