import { Router } from "express";
import { pingDatabase } from "../config/db.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const dbOk = await pingDatabase();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    database: dbOk ? "connected" : "unreachable",
    timestamp: new Date().toISOString(),
  });
});
