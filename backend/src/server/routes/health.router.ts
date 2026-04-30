import { Router } from "express";

import { pool } from "../../db/connection.js";

export const healthRouter = Router();

// GET /health
healthRouter.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ data: { status: "ok", db: "connected" } });
  } catch {
    res.status(503).json({
      error: { code: "SERVICE_UNAVAILABLE", message: "Database connection failed." },
    });
  }
});
